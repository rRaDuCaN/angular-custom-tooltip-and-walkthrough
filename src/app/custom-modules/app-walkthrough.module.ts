import { MatButtonModule } from '@angular/material/button';
import {
  coerceBooleanProperty,
  coerceNumberProperty,
} from '@angular/cdk/coercion';
import { HttpClient } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  Component,
  Directive,
  ElementRef,
  Inject,
  Injectable,
  InjectionToken,
  Injector,
  Input,
  NgModule,
  OnDestroy,
} from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  switchMap,
  takeUntil,
  withLatestFrom,
} from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { Overlay, OverlayModule, ViewportRuler } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Directionality } from '@angular/cdk/bidi';
import {
  OverlayTipPosition,
  OverlayPositionBaseDirective,
} from '../directives/overlay-position-base.directive';
import { CustomResizeObserver } from '../services/CustomResizeObserver';

/** Hand holder tooltip properties */
type TutorialTooltipStep = Readonly<Record<'title' | 'exempt', string>>;
/** Generic type that is used to describe the structure of the tooltip steps coming from JSON files. (Serialization) */
type TooltipSteps<U extends string> = Readonly<Record<U, TutorialTooltipStep>>;

type HomePageTooltipSteps = TooltipSteps<
  | 'learnAngular'
  | 'cliDocumentation'
  | 'angularMaterial'
  | 'angularBlog'
  | 'addDependency'
>;

type PageTooltipSteps = HomePageTooltipSteps; // Can be added other steps as well

interface HandHoldersPositions {
  [key: string]: { position: OverlayTipPosition; step: number };
}
interface WatchEnableStepProps {
  /** Additional stuff that is required to run whenever current step changes */
  cb?: () => void;
  lastStepCleanup?: () => void;
}

interface AttachTutorialTipProps {
  step: number;
  lastStepCleanup: () => void;
}

interface ScrollEndListener {
  cleanup: () => void;
  emitOnScrollEnd: Subject<unknown>;
}

interface RepositionOverlayFnProps {
  prevScrollEndLstnrCleanup?: () => void;
}

interface CurrentGroup {
  [key: number]: string;
}

/** An enum which holds the names of the JSON files that have the tutorial tips for all described pages */
enum HandHoldersTutorial {
  HomePage = 'home-page',
  // more pages...
}

export type HandHoldersTutorialSource = keyof typeof HandHoldersTutorial;

/** The injection token for HandHolderStepComponent used to inject title & exempt properties into component */
const HAND_HOLDER_STEP_COMPONENT = new InjectionToken(
  'hand-holder-step-component'
);

/** Sets the full page overlay, class defined in global.scss */
const WALKTHROUGH_WRAPPER_OVERLAY = 'loader-backdrop';

/** Styles for hand holders, defined in global.scss */
const HOOKED_HAND_HOLDER = 'hooked-hand-holder';

/** Reverted back styles for hand holders, defined in global.scss */
const HOOKED_HAND_HOLDER_REVERTED = 'hooked-hand-holder-reverted';

const HAND_HOLDER_STEP_MAX_HEIGHT = 532;
const HAND_HOLDER_STEP_MAX_WIDTH = 350;

/**
 * An object of initial states for each page that has Tutorials embedded in.
 * If you intend to add a new page make sure to add that here.
 */
const ENABLED_TOUR_BTN_INITIALS: Record<HandHoldersTutorialSource, boolean> = {
  /**
   * Take the tour button for uploads is always set unless
   * the viewport width in not less than 1200px
   * */
  HomePage: true,
};

function throttleExecution(fn: () => void) {
  return (time?: number) => setTimeout(fn, time);
}

/**
 * Observes an HTML DOM element for scroll events (if the element is scrollable).
 * Every emission is throttled by 300ms so that it could fire at the end of a scroll.
 * @param el - the element to attach the event to.
 * @param throttleBy - a time delay to throttle the event emission (optional).
 *
 * #### USAGE
 * ```typescript
 * // Gets the body node from DOM
 * const _body = document.querySelector('body');
 * // Gets scroll end event observable & cleanup handler wrapped in a function
 * const _scrollEndHandlers = onScrollStop(_body);
 *
 * // ...somewhere in your code
 * // Gets cleanup & emitOnScrollEvent lazily
 * const { cleanup, emitOnScrollEvent } = _scrollEndHandlers();
 * ```
 */
function onScrollStop(
  el: HTMLElement,
  throttleBy: number = 300
): () => ScrollEndListener {
  let _timeoutId: any;
  const _observe = new Subject();
  const _lstnr: [string, EventListenerOrEventListenerObject] = [
    'scroll',
    () => {
      if (_timeoutId) clearTimeout(_timeoutId);

      // @ts-ignore
      _timeoutId = setTimeout(() => _observe.next(null), throttleBy);
    },
  ];
  el.addEventListener(..._lstnr);
  return (): ScrollEndListener => ({
    cleanup: () => {
      _observe.complete();
      clearTimeout(_timeoutId);
      el.removeEventListener(..._lstnr);
    },
    emitOnScrollEnd: _observe,
  });
}

/**
 * Gets the current coordinates of an element relative to the scrollable ancestor container.
 * Our scrollable container is main HTML5 element so bear that in mind when performing quite
 * a substantial changes at app level structure.
 *
 * @param elem - the element to get the DOMRect for.
 * @param scrollableContainer - the elem's scrollable ancestor container (could be body, main, or any other element).
 *
 * #### USAGE
 * ```html
 *
 * <!-- ...somewhere in your HTML file -->
 * <body>
 *      <!--...-->
 *      <div id="myDiv">
 *          Some really cool element
 *      </div>
 *      <!--...-->
 * </body>
 *
 * ```
 *
 * ```typescript
 *
 * const _body = document.querySelector('body');
 * const _myDiv = _body.querySelector('#myDiv');
 * const { left, top, height } = getElemRect(_myDiv, _body);
 * ```
 */
function getElemRect(
  elem: HTMLElement,
  scrollableContainer: HTMLElement
): { top: number; left: number; height: number } {
  const box = elem.getBoundingClientRect();

  const scrollTop = scrollableContainer.scrollTop;
  const scrollLeft = scrollableContainer.scrollLeft;

  const top = scrollTop + box.top;
  const left = scrollLeft + box.left;

  return { top: Math.round(top), left: Math.round(left), height: box.height };
}

/**
 * The main App Walkthrough lifecycle stores & states.
 */
@Injectable({ providedIn: 'root' })
export class AppWalkthroughStore implements OnDestroy {
  private _until$ = new Subject();

  /** The page to load tutorial tooltips for */
  private _handHolderTooltipsPage =
    new BehaviorSubject<HandHoldersTutorialSource>('HomePage');
  readonly handHolderTooltipsPage$ = this._handHolderTooltipsPage.pipe(
    takeUntil(this._until$)
  );
  /** The hand holder tooltips tha were loaded for the specific page */
  private _handHolderTooltips = new BehaviorSubject<PageTooltipSteps | null>(
    null
  );
  readonly handHolderTooltips$ = this._handHolderTooltips.pipe(
    takeUntil(this._until$)
  );

  /** Represents the current step of the tutorial progress */
  private _currentStep = new BehaviorSubject(0);
  readonly currentStep$ = this._currentStep.pipe(takeUntil(this._until$));

  /** Scroll stop propagation listener */
  emitOnScrollEnd$!: Observable<unknown>;
  /** Scroll stop propagation listener cleanup handler */
  private emitOnScrollEndCleanup!: () => void;

  private _currentGroup: CurrentGroup | null = null;
  readonly currentGroup = () => this._currentGroup;

  private _allSteps = 0;
  readonly allSteps = () => this._allSteps;

  // Stores the previous hand holder step position anchored to the element
  private _prevHandHolderPosition!: HandHoldersPositions;
  readonly prevHandHolderPosition = () => this._prevHandHolderPosition;

  main: HTMLElement;

  constructor(
    @Inject(DOCUMENT) public document: Document,
    public viewportRuler: ViewportRuler
  ) {
    this.main = this.document.querySelector('main') as HTMLElement;
    this._setupScrollStopLsnr();
  }

  /**
   * Attaches the emitOnScrollEnd to main element & it's cleanup
   */
  private _setupScrollStopLsnr() {
    const { emitOnScrollEnd, cleanup } = onScrollStop(this.main)();

    this.emitOnScrollEnd$ = emitOnScrollEnd;
    this.emitOnScrollEndCleanup = cleanup;
  }

  ///////////////////////////////////////////////////////////////////////////////
  //                                Setters                                    //
  ///////////////////////////////////////////////////////////////////////////////

  setHandHolderTooltipPage(page: string) {
    this._handHolderTooltipsPage.next(page as HandHoldersTutorialSource);
  }

  setHandHolderTooltips(tips: PageTooltipSteps) {
    this._handHolderTooltips.next(tips);
  }

  setCurrentGroup(group: CurrentGroup) {
    this._currentGroup = {
      ...this._currentGroup,
      ...group,
    };
  }

  setAllSteps(steps: number) {
    this._allSteps = steps;
  }

  setPrevHandHolderStepPos(pos: OverlayTipPosition, step: number, key: string) {
    if (this._currentStep.value === step)
      this._prevHandHolderPosition = {
        ...this._prevHandHolderPosition,
        [key]: {
          position: pos,
          step,
        },
      };
  }

  resetHandHoldersPos(newPos: HandHoldersPositions) {
    this._prevHandHolderPosition = newPos;
  }

  ////////////////////////////////////////////////////////////////////////////////

  // Other handlers

  incrementStep() {
    const _curr = this._currentStep.value;
    const _next = _curr + 1;
    this._currentStep.next(_next);
  }

  killTutorial() {
    // kill all linked observables
    this._until$.next(null);

    this._currentStep.next(0);
    this._handHolderTooltips.next(null);
  }

  ngOnDestroy(): void {
    this._allSteps = 0;
    this._currentGroup = null;
    this._until$.next(null);
    this._until$.complete();
    this.emitOnScrollEndCleanup();
  }
}

@Injectable({ providedIn: 'root' })
export class TakeTheTourStore implements OnDestroy {
  private _until$ = new Subject();
  /**
   * An observable which holds what page should enable Take The Tour button
   */
  private _enableTourBtn = new BehaviorSubject<
    Partial<Record<HandHoldersTutorialSource, boolean>>
  >(ENABLED_TOUR_BTN_INITIALS);
  readonly enableTourBtn$ = this._enableTourBtn.asObservable();
  /**
   * Disable Take the Tour button for viewports lt 1200px in width
   */
  readonly disableEntirelyTourBtn = this._resizeObserver.observe$.pipe(
    map(({ width }) => width >= 1200),
    distinctUntilChanged()
  );
  /** Emits on Take the Tour button click, kicks off the tutorial walkthrough */
  private _toggleTourBtn = new BehaviorSubject(false);
  readonly toggleTourBtn$ = this._toggleTourBtn.pipe(
    withLatestFrom(this._resizeObserver.observe$),
    // don't emit when the viewport size is lt 1200
    filter(([_, { width }]) => width >= 1200),
    map((res) => res[0]),
    distinctUntilChanged()
  );

  /** Pages that should be ommited when toggling Take the Tour button state, meaning these ones should always be true */
  private _alwaysEnabledIn = /(HomePage)/;

  constructor(private _resizeObserver: CustomResizeObserver) {}

  /**
   * Writes the state for every page baset on dataset's isPublished property.
   * Take a note that PublishedDatasetsStore wasn't used here because
   * DetailedAnalysis page is available for published & unpublished datasets.
   * @param published - aboolean which tells whether the dataset is published
   */
  private _enableTourBtnIfNeeded(published: boolean) {
    const _oldState = this._enableTourBtn.value;
    const _newState = Object.keys(_oldState).reduce((acc, curr) => {
      if (curr.match(this._alwaysEnabledIn))
        acc = {
          ...acc,
          [curr]: _oldState[curr as HandHoldersTutorialSource],
        };
      else acc = { ...acc, [curr]: published };

      return acc;
    }, {});

    // kicks off a new event
    this._enableTourBtn.next(_newState);
  }

  /**
   * Provides a more flexible way to toggle TakeTheTour button for a page.
   * @param tourPage - tour page the button to be toggled for
   * @param enable - the toggle sbutton state.
   */
  customTourBtnToggle(tourPage: HandHoldersTutorialSource, enable = false) {
    const _oldState = this._enableTourBtn.value;
    this._enableTourBtn.next({
      ..._oldState,
      [tourPage]: enable,
    });
  }

  toggleTourBtn() {
    this._enableTourBtnIfNeeded(true);
    this._toggleTourBtn.next(!this._toggleTourBtn.value);
  }

  resetTourBtn() {
    this.toggleTourBtn();
  }

  ngOnDestroy(): void {
    this._until$.next(null);
    this._until$.complete();
  }
}

/**
 * Loads needed tutorial steps.
 * If you're planning to add some new tutorial steps, update the types above and / or if required,
 * the json files from /assets/json/hand-holders.
 * If you want to add a tutorial walkthrough for a new page be sure to create a new json file for that page & update the types above
 * as well as ENABLED_TOUR_BTN_INITIALS. Also pay attention in other doc files here.
 * #### USAGE
 * ```html
 *  <div inAppWalkthroughHook></div>
 * ```
 */
@Directive({
  selector: '[appWalkthroughHook]',
})
export class AppWalkthroughDirective implements OnDestroy {
  private _until$ = new Subject();

  constructor(private _client: HttpClient, private _aths: AppWalkthroughStore) {
    this._loadTips();
  }

  private _loadTips() {
    // will be a json placeholder
    this._aths.handHolderTooltipsPage$
      .pipe(
        first((x) => !!x),
        switchMap((page) => this._loadTooltipsForGroup(page))
      )
      .subscribe({
        next: (res) => this._aths.setHandHolderTooltips(res),
      });
  }

  /**
   * Dynamically loads tutorial tips for the page
   * @param handholdersPage - the page to load tutorial steps for
   */
  private _loadTooltipsForGroup(
    handholdersPage: HandHoldersTutorialSource
  ): Observable<PageTooltipSteps> {
    const _fileName = `assets/holders/${HandHoldersTutorial[handholdersPage]}.steps.json`;
    return this._client.get<PageTooltipSteps>(_fileName);
  }

  ngOnDestroy(): void {
    this._until$.next(null);
    this._until$.complete();
  }
}

/**
 * Creates an overlay so that a tutorial tip could be attached.
 * Has the basic functionality for the overlay positioning.
 */
@Directive()
export class InAppWalkthroughOverlayDirective extends OverlayPositionBaseDirective {
  /** The hand holder's position */
  protected override _offset = 80;

  constructor(private _overlay: Overlay, dir: Directionality) {
    super(dir);
    dir.change.pipe(takeUntil(this._destroyed)).subscribe(() => {
      if (this._overlayRef) {
        this._updatePosition(this._overlayRef);
      }
    });
  }

  /** Creates the overlay with the applied configs */
  private _createOverlay(eRef: ElementRef<HTMLElement>) {
    const pos = this._overlay
      .position()
      .flexibleConnectedTo(eRef)
      .withFlexibleDimensions(false)
      .withViewportMargin(this._viewportMargin);

    const _newOverlayRef = this._overlay.create({
      positionStrategy: pos,
      hasBackdrop: true,
      backdropClass: WALKTHROUGH_WRAPPER_OVERLAY,
    });

    this._overlayRef = _newOverlayRef;

    this._updatePosition(_newOverlayRef);

    return _newOverlayRef;
  }

  /** Creates the overlay & attaches the tutorial tip to the overlay */
  protected attachTutorialTip(
    portal: ComponentPortal<HandHolderStepComponent>,
    elRef: ElementRef<HTMLElement>
  ) {
    this._createOverlay(elRef);

    this._overlayRef.attach(portal);
  }

  /** Detaches the overlay from the porta & disposes the overlay */
  protected disposeOverlay() {
    if (!this._overlayRef) return;
    if (this._overlayRef.hasAttached()) {
      this._overlayRef.detach();
    }

    this._overlayRef.dispose();
  }
}

/** Holds the shared functionality for hand holder directives */
@Directive()
export class HandHolderBaseDirective
  extends InAppWalkthroughOverlayDirective
  implements OnDestroy
{
  protected _until$ = new Subject();
  /** The hand holder for which to get tooltip data */
  protected _handHolder!: string;
  /** The order of the hand holder to show up */
  protected _handHolderStep!: number;
  /** Tells if it's the last hand holder */
  protected _isLastStep!: boolean;
  /** Enables the hand holder when current step & predefined step match */
  protected _enableStep!: boolean;
  /** The ancestor to bind the tutorial tip */
  protected _hookedEl: HTMLElement;
  /** The hooked element appears in group, the tutorial tip is set as value */
  protected _appearsInGroup!: string;
  protected _skipTipPoint!: boolean;

  private _main: HTMLElement;

  private _headerBounds!: DOMRect;

  constructor(
    protected _tutorialHookStore: AppWalkthroughStore,
    private _elRef: ElementRef,
    _overlay: Overlay,
    dir: Directionality
  ) {
    super(_overlay, dir);
    this._hookedEl = this._elRef.nativeElement;
    this._main = this._tutorialHookStore.main;
  }

  /**
   * Creates a new hand holder step portal ready to be attached to overlay
   */
  private _createHandHolderStep(value: any) {
    return new ComponentPortal(
      HandHolderStepComponent,
      null,
      Injector.create({
        providers: [
          {
            provide: HAND_HOLDER_STEP_COMPONENT,
            useValue: value,
          },
        ],
      })
    );
  }

  private _getTopViewportOffset() {
    const { height } = this._tutorialHookStore.viewportRuler.getViewportRect();

    // 30%
    return height * 0.3;
  }

  /**
   * If the hooked element is not visible in the view port, then scroll to it
   */
  private _scrollToHookedElement(
    option: 'fullway' | 'halfway' = 'fullway',
    offset = 0
  ) {
    // if (!this._headerBounds)
    //   this._headerBounds = this._tutorialHookStore.document
    //     .querySelector('#hdr')
    //     .getBoundingClientRect();

    const { top, height } = getElemRect(this._hookedEl, this._main);
    // header is not a part of the main container so remove that offset
    // const _newTop = top + offset - this._headerBounds.top;
    const _newTop = top + offset;
    if (option === 'fullway')
      this._main.scroll({
        behavior: 'smooth',
        top: _newTop - this._getTopViewportOffset(),
      });
    if (option === 'halfway')
      this._main.scroll({
        behavior: 'smooth',
        top: _newTop - height / 1.5,
      });
  }

  private _scrollVerticallyBy(amount: number) {
    this._main.scroll({
      behavior: 'smooth',
      top: amount,
    });
  }

  /** Dispatches a scroll event just in case it didn't scroll (happens when elements have the same coordinates) */
  private _dummyScroll() {
    this._main.dispatchEvent(new CustomEvent('scroll'));
  }

  private _positionIs(pos: OverlayTipPosition) {
    return this._tipPosition === pos;
  }

  private _anyPosition(regExp: RegExp) {
    return this._tipPosition.match(regExp);
  }

  /**
   * Stores the current position as prev in the store & overwrites it with a new position
   * according to the position strategy applied in _positionHandHolderStep method.
   * @param pos - new position to be written instead.
   */
  private _makePosition(pos: OverlayTipPosition) {
    if (!this._appearsInGroup)
      this._tutorialHookStore.setPrevHandHolderStepPos(
        this._tipPosition,
        this._handHolderStep,
        this._handHolder
      );
    this._tipPosition = pos;
  }

  /**
   * Checks if the tutorial step fits in between on of
   * the vertical viewport edge & either top or bottom hooked element's side
   * @param viewportHeight - viewport height
   * @param elHeight - hooked element height
   */
  private _isTipFitVertically(viewportHeight: number, elHeight: number) {
    return elHeight < viewportHeight - HAND_HOLDER_STEP_MAX_HEIGHT;
  }

  /**
   * The tutorial step positioning strategy to be applied according to the size of the view port.
   * Notice that the tutorial is not suitable for small viewports.
   */
  private _positionHandHolderStep() {
    const { width: _vieportWidth, height: _viewportHeight } =
      this._tutorialHookStore.viewportRuler.getViewportRect();
    const _halfViewportWidth = _vieportWidth / 2;
    const {
      x,
      y,
      width: _hookedElWidth,
      height: _hookedElHeight,
    } = this._hookedEl.getBoundingClientRect();
    // delta width < HAND_HOLDER_STEP_MAX_HEIGHT - tip doesn't fit in the remaining horisontal space
    const _deltaWidth = _vieportWidth - _hookedElWidth;

    // if the element occupies almost full viewport
    if (_deltaWidth < HAND_HOLDER_STEP_MAX_HEIGHT) {
      // whether the position of the tutorial step is above
      if (this._positionIs('above')) {
        // & _hooked element is positioned below HAND_HOLDER_STEP_MAX_HEIGHT relative to view port
        if (y >= HAND_HOLDER_STEP_MAX_HEIGHT) {
          // scroll it almost halfway
          this._scrollToHookedElement('halfway');
          return;
        } else if (Math.abs(y) >= 260 && this._main.scrollTop >= 260) {
          if (this._isTipFitVertically(_viewportHeight, _hookedElHeight)) {
            // minimum scroll unit is 100
            this._scrollVerticallyBy(this._main.scrollTop - 100);
          } else this._scrollVerticallyBy(this._main.scrollTop - 260);
          return;
        }
      } else if (this._positionIs('below')) {
        if (this._isTipFitVertically(_viewportHeight, _hookedElHeight)) {
          this._scrollToHookedElement();
          return;
        }
        this._scrollVerticallyBy(this._main.scrollTop + y);
        return;
      } else if (this._anyPosition(/(left|before|right|after)/)) {
        if (y >= HAND_HOLDER_STEP_MAX_HEIGHT) {
          this._makePosition('above');
          this._scrollToHookedElement('halfway');
          return;
        } else if (y <= -260 && this._main.scrollTop >= 260) {
          this._makePosition('above');
          // put an offset for smaller view ports
          this._scrollToHookedElement('fullway', -160);
          return;
        }
      }
    } else if (this._positionIs('above')) {
      if (this._isTipFitVertically(_viewportHeight, _hookedElHeight)) {
        if (y >= HAND_HOLDER_STEP_MAX_HEIGHT) {
          this._scrollToHookedElement();
        } else {
          this._makePosition('below');
        }
        return;
      }
    } else if (
      x < _halfViewportWidth &&
      x < HAND_HOLDER_STEP_MAX_WIDTH &&
      this._anyPosition(/(left|before)/)
    ) {
      this._makePosition('right');
      this._scrollToHookedElement();
      return;
    } else if (
      x > _halfViewportWidth &&
      x < _vieportWidth - HAND_HOLDER_STEP_MAX_WIDTH &&
      this._anyPosition(/(right|after)/)
    ) {
      this._makePosition('left');
      this._scrollToHookedElement();
      return;
    } else {
      this._scrollToHookedElement();
    }
  }

  /**
   * If hooked element is not visible in the view port, then it scrolls to it & attaches the
   * overlay with the hand holder tutorial tip.
   * @param o.attachTipCb - the callback handler that attaches the tutorial tip
   */
  private repositionOverlayIfNeeded({
    prevScrollEndLstnrCleanup,
  }: RepositionOverlayFnProps) {
    if (prevScrollEndLstnrCleanup) prevScrollEndLstnrCleanup();

    this._positionHandHolderStep();

    // trigger a scroll in case one was not in this._positionHandHolderStep()
    this._dummyScroll();
  }

  /**
   * Resets hand holder step position if it was altered on previous tour.
   */
  private _resetHandHolderPosition() {
    const _prevPos = this._tutorialHookStore.prevHandHolderPosition();

    if (!_prevPos) return;

    const _posKeys = Object.keys(_prevPos);

    if (!_posKeys.length) return;

    const _currPosTip = _prevPos[this._handHolder];

    if (!_currPosTip) return;

    if (!Object.keys(_currPosTip).length) return;

    if (this._handHolderStep === _currPosTip.step)
      this._tipPosition = _currPosTip.position;

    // clear the prev hand holder step position from store as the user might go to another page
    const _newPos = _posKeys.reduce(
      (acc, curr) =>
        curr === this._handHolder ? acc : { ...acc, [curr]: _prevPos[curr] },
      {} as HandHoldersPositions
    );
    this._tutorialHookStore.resetHandHoldersPos(_newPos);
  }

  /**
   * Attaches the tooltip to hand holder when enable step is true
   * @param vcr - the view container ref to inject the tooltip into
   */
  protected _attachTutorialTip({
    step,
    lastStepCleanup,
  }: AttachTutorialTipProps) {
    if (!this._handHolder) return;

    if (!lastStepCleanup) lastStepCleanup = () => {};

    this._tutorialHookStore.handHolderTooltips$
      .pipe(first((x) => !!x))
      .subscribe((tips) => {
        // @ts-ignore
        const { title, exempt } = tips[this._handHolder] as TutorialTooltipStep;

        const _handHolderStep = this._createHandHolderStep({
          title,
          exempt,
          position: !this._skipTipPoint ? this._tipPosition : '',
          isLast: this._isLastStep,
          // the step starts from 0, so add 1
          currStep: () => step + 1,
          numOfSteps: () => this._tutorialHookStore.allSteps(),
          resetPosition: () => this._resetHandHolderPosition(),
          disposeOfTutorialTooltip: () => this._disposeHandHolderTutorialTip(),
          lastStepCleanup,
        });

        // element ref is passed just in case if the overlay is undefined
        this.attachTutorialTip(_handHolderStep, this._elRef);
      });
  }

  /** Watches when to enable tooltip to hand holder */
  protected _watchEnableStep({ cb, lastStepCleanup }: WatchEnableStepProps) {
    const _unsubscribeScrollEndLstnr$ = new Subject();
    return this._tutorialHookStore.currentStep$.pipe(
      map((step) => {
        this.disposeOverlay();
        // sets the enableStep
        this._enableStep = this._handHolderStep === step;

        // Runs additional stuff
        if (cb) cb();

        // Unsubscribes from previous emitOnScrollEnd$ listener
        _unsubscribeScrollEndLstnr$.next(null);

        // Attaches the tip if that's the right step
        if (this._enableStep) {
          this.repositionOverlayIfNeeded({});

          this._tutorialHookStore.emitOnScrollEnd$
            .pipe(takeUntil(_unsubscribeScrollEndLstnr$))
            .subscribe(() => {
              this.disposeOverlay();
              this._attachTutorialTip({
                step,
                // @ts-ignore
                lastStepCleanup,
              });
            });
        }

        return () => {
          _unsubscribeScrollEndLstnr$.next(null);
          _unsubscribeScrollEndLstnr$.complete();
        };
      })
    );
  }

  /** Sets the tip position */
  protected _hookHolderPosition(position: OverlayTipPosition) {
    this._tipPosition = position;
  }

  protected _setLastStep() {
    if (this._isLastStep)
      // step starts from 0, but we need the sum of all steps
      this._tutorialHookStore.setAllSteps(this._handHolderStep + 1);
  }

  protected _isStep() {
    // null can't be & 0 is coerced to false
    return this._handHolderStep !== undefined;
  }

  private _disposeHandHolderTutorialTip() {
    // destroys the last element from the view, which should be tutorial tip
    this.disposeOverlay();
  }

  override ngOnDestroy(): void {
    this._disposeHandHolderTutorialTip();
    this._until$.next(null);
    this._until$.complete();
  }
}

/**
 * Sets the tutorial step, page that it is related to, whether it's the last step & tooltip position.
 * The first step starts from 0.
 * #### Usage
 * ```html
 * <div inAppWalkthroughHook>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="0" handHoldersGroupTipPosition="left"></div>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="1" handHoldersGroupTipPosition="before"></div>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="2" handHoldersGroupTipPosition="above"></div>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="3" handHoldersGroupTipPosition="below"></div>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="4" handHoldersGroupTipPosition="right"></div>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="5" handHoldersGroupTipPosition="after"></div>
 *  <div handHoldersGroup="related tooltip" handHoldersGroupStep="6" handHoldersGroupTipPosition="left" handHoldersGroupLastStep></div>
 * <div>
 * ```
 */
@Directive({
  selector: `
        [handHoldersGroup], 
        [handHoldersGroupStep],
        [handHoldersGroupLastStep],
        [handHoldersGroupTipPosition],
        [handHoldersGroupSkipTipPoint]
        `,
})
export class HandHoldersGroupDirective
  extends HandHolderBaseDirective
  implements AfterViewInit
{
  @Input() set handHoldersGroup(holder: string) {
    this._handHolder = holder;
  }

  @Input() set handHoldersGroupTipPosition(position: string) {
    this._hookHolderPosition(position as OverlayTipPosition);
  }

  @Input() set handHoldersGroupStep(step: any) {
    this._handHolderStep = coerceNumberProperty(step);

    if (step)
      this._tutorialHookStore.setCurrentGroup({
        [this._handHolderStep]: this._handHolder,
      });
  }

  @Input() set handHoldersGroupLastStep(val: any) {
    this._isLastStep = coerceBooleanProperty(val);

    this._setLastStep();
  }

  @Input() set handHoldersGroupSkipTipPoint(val: any) {
    this._skipTipPoint = coerceBooleanProperty(val);
  }

  constructor(
    _aths: AppWalkthroughStore,
    _overlay: Overlay,
    _eRef: ElementRef,
    _dir: Directionality,
    private _takeTheTour: TakeTheTourStore
  ) {
    super(_aths, _eRef, _overlay, _dir);
  }

  ngAfterViewInit(): void {
    const _destroyOnToggle$ = new Subject();
    this._takeTheTour.toggleTourBtn$.pipe(takeUntil(this._until$)).subscribe({
      next: (toggle) => {
        let _watchEnableStepCleanup: any;
        // trigger unsubscribe on every toggle
        _destroyOnToggle$.next(null);
        if (toggle)
          this._watchEnableStep({})
            .pipe(takeUntil(_destroyOnToggle$))
            .subscribe({
              next: (cleanupCb) => (_watchEnableStepCleanup = cleanupCb),
              complete: () => {
                if (_watchEnableStepCleanup) _watchEnableStepCleanup();
              },
            });
      },
      complete: () => {
        // emit once if it wasn't
        _destroyOnToggle$.next(null);
        // get rid of the subscription
        _destroyOnToggle$.complete();
      },
    });
  }
}

/**
 * Sets the tutorial tip, step, position, whether it's the last step or
 * if the tip is a group may be combined with HandHoldersGroup directive.
 * Note tha this is the main directive to be used for tutorial tips.
 * #### Usage
 * ```html
 * <div inAppWalkthroughHook>
 *      <div handHolderHook="some tutorial tip" handHolderHookStep="0" handHolderHookTipPosition="before"></div>
 *      <div handHolderHook="some tutorial tip" handHolderHookStep="1" handHolderHookTipPosition="left"></div>
 *      <div handHolderHook="some tutorial tip" handHolderHookStep="2" handHolderHookTipPosition="right"></div>
 *      <div handHolderHook="some tutorial tip" handHolderHookStep="3" handHolderHookTipPosition="after"></div>
 *      <div handHolderHook="some tutorial tip" handHolderHookStep="4" handHolderHookTipPosition="above"></div>
 * <!-- `handHolderHookDisable` - disables dynamically TakeTheTour button according to the provided proverb -->
 *      <div handHolderHook="some tutorial tip" handHolderHookStep="5" handHolderHookTipPosition="below" handHolderHookDisable="some proverb"></div>
 * <!-- There may be elements / components that are part of a group like the below example -->
 *      <div
 *         handHoldersGroup="other tutorial tip"
 *         handHoldersGroupStep="6"
 *         handHoldersGroupTipPosition="above"
 *         handHoldersGroupLastStep="true"
 *      >
 *         <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *          <div handHolderHook handHolderHookInGroup="other tutorial tip"></div>
 *      </div>
 * </div>
 * ```
 */
@Directive({
  selector: `
    [handHolderHook], 
    [handHolderHookEdge],  
    [handHolderHookStep], 
    [handHolderHookLastStep], 
    [handHolderHookTipPosition],
    [handHolderHookInGroup],
    [handHolderHookDisable],
    [handHolderHookSkipTipPoint]
    `,
})
export class HandHolderHookDirective
  extends HandHolderBaseDirective
  implements AfterViewInit
{
  /** Sets the tutorial tip to be used */
  @Input() set handHolderHook(hook: string) {
    this._handHolder = hook;
  }

  /** Sets the tutorial tip position 'left' | 'right' | 'above' | 'below' | 'before' | 'after' */
  @Input() set handHolderHookTipPosition(position: string) {
    this._hookHolderPosition(position as OverlayTipPosition);
  }

  /** Sets the tutorial tip step */
  @Input() set handHolderHookStep(step: any) {
    this._handHolderStep = coerceNumberProperty(step);
  }

  /** Used whether it's the last step */
  @Input() set handHolderHookLastStep(val: any) {
    this._isLastStep = coerceBooleanProperty(val);

    this._setLastStep();
  }

  /** Used whether this tutirial tip is part of a group */
  @Input() set handHolderHookInGroup(val: string) {
    if (val) this._appearsInGroup = val;
  }

  /** Disables in app walk through is there are any reasons for that,
   * for example if an element changes & the description for that element is meaningless.
   * */
  @Input() set handHolderHookDisable(val: any) {
    // do something here
  }

  /**
   * Removes pointer indicator from a hand holder tip position,
   * helpful when overlay strategy falis to osition the tip either above or below
   */
  @Input() set handHolderHookSkipTipPoint(val: any) {
    this._skipTipPoint = coerceBooleanProperty(val);
  }

  constructor(
    _appths: AppWalkthroughStore,
    _eRef: ElementRef,
    _overlay: Overlay,
    _dir: Directionality,
    private _takeTheTour: TakeTheTourStore
  ) {
    super(_appths, _eRef, _overlay, _dir);
  }

  ngAfterViewInit(): void {
    let cleanupHandler: any;
    this._takeTheTour.toggleTourBtn$.pipe(takeUntil(this._until$)).subscribe({
      next: (toggle) => {
        const { execute, triggerDestruction, cleanup, resetStyles } =
          this._handleHandHolders();
        if (toggle) {
          cleanupHandler = cleanup;
          // unsubscribe the previous observer
          triggerDestruction();
          // execute
          execute();
        } else {
          resetStyles();
        }
      },
      complete: () => {
        if (cleanupHandler) cleanupHandler();
      },
    });
  }

  /** Add dynamic styles to hooked handholders  when the step is enabled*/
  private _addDynamicStyles() {
    this._hookedEl.classList.remove(
      this._enableStep ? HOOKED_HAND_HOLDER_REVERTED : HOOKED_HAND_HOLDER
    );
    this._hookedEl.classList.add(
      this._enableStep ? HOOKED_HAND_HOLDER : HOOKED_HAND_HOLDER_REVERTED
    );
  }

  private _addDynamicStylesForGroups() {
    this._hookedEl.classList.add(HOOKED_HAND_HOLDER);
  }

  private _resetStylesToDefault() {
    this._hookedEl.classList.remove(HOOKED_HAND_HOLDER);
  }

  private _handleHandHolders() {
    const _triggerDestruction$ = new Subject();
    let _watchEnableStepCleanup;

    return {
      execute: () => {
        this._tutorialHookStore.currentStep$
          .pipe(takeUntil(_triggerDestruction$))
          .subscribe((step) => {
            if (!this._appearsInGroup) return;

            const _currGroup = this._tutorialHookStore.currentGroup();
            const _isInGroup =
              (_currGroup as CurrentGroup)[step] === this._appearsInGroup;

            if (_isInGroup) {
              this._addDynamicStylesForGroups();
            } else this._resetStylesToDefault();
          });

        if (this._isStep())
          this._watchEnableStep({
            cb: () => {
              this._addDynamicStyles();
            },
            lastStepCleanup: () => {
              // resets styles for the last hooked hand holder
              this._resetStylesToDefault();
            },
          })
            .pipe(takeUntil(_triggerDestruction$))
            .subscribe({
              next: (cleanupCb) => {
                _watchEnableStepCleanup = cleanupCb;
              },
              complete: () => {
                // if (_watchEnableStepCleanup) _watchEnableStepCleanup();
              },
            });
      },
      triggerDestruction: () => _triggerDestruction$.next(null),
      cleanup: () => {
        _triggerDestruction$.next(null);
        _triggerDestruction$.complete();
      },
      resetStyles: () => this._resetStylesToDefault(),
    };
  }
}

@Component({
  selector: 'hand-holder-step',
  templateUrl: './hand-holder-step.component.html',
  styleUrls: ['./hand-holder-step.component.scss'],
})
export class HandHolderStepComponent implements AfterViewInit {
  private _animationState = false;

  constructor(
    private _aths: AppWalkthroughStore,
    @Inject(HAND_HOLDER_STEP_COMPONENT) public props: any
  ) {}

  ngAfterViewInit(): void {
    // trigger the animation on the first tip appearance
    throttleExecution(() => this.showAnimation())();
  }

  private hideAnimation = () => (this._animationState = false);
  private showAnimation = () => (this._animationState = true);

  onSkip() {
    this.hideAnimation();

    const _lastStepCleanup = this.props.lastStepCleanup as () => void;

    this.props.resetPosition();

    // resolves immediately if _lastStepCleanup exists,
    // passes in the timeout a ready to execute cb
    const _stepCleanup = (() =>
      !!_lastStepCleanup ? _lastStepCleanup : () => {})();

    throttleExecution(() => {
      this.props.disposeOfTutorialTooltip();
      _stepCleanup();
      this._aths.killTutorial();
    })(230);
  }

  onNext() {
    this.props.resetPosition();

    if (this.props.isLast) {
      this.onSkip();
      return;
    }

    this.hideAnimation();

    throttleExecution(() => this._aths.incrementStep())(230);
    throttleExecution(() => this.showAnimation())(280);
  }

  get tipPosition(): string {
    return 'holder-tip-' + this.props.position;
  }

  get animationClass(): string {
    return this._animationState
      ? ' holder-tip-show-animation'
      : ' holder-tip-hide-animation';
  }
}

@NgModule({
  imports: [MatButtonModule, MatIconModule, OverlayModule],
  declarations: [
    HandHolderStepComponent,
    AppWalkthroughDirective,
    HandHoldersGroupDirective,
    HandHolderHookDirective,
  ],
  exports: [
    AppWalkthroughDirective,
    HandHoldersGroupDirective,
    HandHolderHookDirective,
  ],
})
export class AppWalkthroughModule {}
