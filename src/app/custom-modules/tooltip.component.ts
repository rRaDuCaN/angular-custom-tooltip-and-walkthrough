import {
  Component,
  Directive,
  ElementRef,
  Input,
  ChangeDetectionStrategy,
  ViewContainerRef,
  OnDestroy,
  AfterViewInit,
  Inject,
  NgZone,
  NgModule,
  ViewChild,
  TemplateRef,
  ViewEncapsulation,
  EmbeddedViewRef,
} from '@angular/core';
import { Overlay, OverlayConfig, OverlayModule } from '@angular/cdk/overlay';
import {
  ComponentPortal,
  PortalModule,
  TemplatePortal,
} from '@angular/cdk/portal';
import {
  normalizePassiveListenerOptions,
  Platform,
  PlatformModule,
} from '@angular/cdk/platform';
import { CommonModule, DOCUMENT } from '@angular/common';
import { take, takeUntil } from 'rxjs/operators';
import { coerceBooleanProperty } from '@angular/cdk/coercion';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { Directionality } from '@angular/cdk/bidi';
import {
  OverlayPositionBaseDirective,
  OverlayTipPosition,
} from '../directives/overlay-position-base.directive';
import { DomSanitizer } from '@angular/platform-browser';

type ListenerPattern = readonly [string, EventListenerOrEventListenerObject];

const _psvLstnrOptions = normalizePassiveListenerOptions({
  passive: true,
});

export function addListener(el: HTMLElement, lstnrs: ListenerPattern[]) {
  lstnrs.forEach((l) => el.addEventListener(...l, _psvLstnrOptions));
}

export function removeListener(el: HTMLElement, lstnrs: ListenerPattern[]) {
  lstnrs.forEach((l) => el.removeEventListener(...l, _psvLstnrOptions));
}

const LONGPRESS_DELAY = 500;

/**
 * Custom tooltip directive is a custom implementation of a tooltip for this app.
 *
 * #### USAGE MODE 1
 * ```html
 * <custom-tooltip #theTooltip>
 *      <p>Add any html in this tooltip & any text that is required.</p>
 *      <ul>
 *          <li>Any<li>
 *          <li>text</li>
 *          <li>you</li>
 *          <li>want</li>
 *      </ul>
 *      <div>Or something else</div>
 * </custom-tooltip>
 *
 * <any-html-tag
 *      [customTooltipPivot]="theTooltip"
 *      customTooltipWidth="350"
 * ></any-html-tag>
 * ```
 *
 * #### USAGE MODE 2
 * ```html
 * <any-html-tag
 *      customTooltip="Add here some tooltip"
 *      customTooltipWidth="300"
 * ></any-html-tag>
 * ```
 */
@Directive({
  selector: `
    [customTooltip], 
    [customTooltipTriggerOnClick], 
    [customTooltipBold], 
    [customTooltipColor], 
    [customTooltipWidth], 
    [customTooltipPivot],
    [customTooltipPosition]`,
})
export class TooltipDirective
  extends OverlayPositionBaseDirective
  implements AfterViewInit, OnDestroy
{
  /**
   * Whether to add a click event or not.
   */
  @Input()
  set customTooltipTriggerOnClick(val: any) {
    this._triggerOnClick = coerceBooleanProperty(val);
  }
  get customTooltipTriggerOnClick() {
    return this._triggerOnClick;
  }

  @Input() set customTooltipPosition(val: string) {
    if (val) this._tipPosition = val as OverlayTipPosition;
    // set as default
    else this._tipPosition = 'below';
  }

  /**
   * The text for the tooltip, it's important to use only customTooltip or customTooltipPivot
   */
  @Input() get customTooltip(): string {
    return this._message;
  }
  set customTooltip(val: string) {
    // leave the setter if undefined
    if (!val) return;

    this._message = val;
    // detach first the current tooltip
    if (this._overlayRef) {
      this.hide();
    }

    this._attachEvents();
    this._updateTooltipMessage();
  }
  /**
   * A styled complex html implementation of the tooltip.
   */
  @Input()
  set customTooltipPivot(val: TooltipComponent) {
    if (val instanceof TooltipComponent) {
      this._withProjectedHTML = val;
    }

    // detach first the current tooltip
    if (this._overlayRef) {
      this.hide();
    }

    this._attachEvents();
  }
  /** Defines the tooltip text color */
  @Input() customTooltipColor = 'inherit';
  /** Defines the tooltip border color, by default it's primary color */
  @Input() customTooltipBorderColor = '#008071';
  @Input() customTooltipBold = false;
  @Input() customTooltipWidth = 150;
  @Input() customTooltipTextSize = '12px';

  /**
   * The overlay for the tooltip
   */
  private _templatePortal!: TemplatePortal<any> | EmbeddedViewRef<any>;
  private _tipPortal!: ComponentPortal<TooltipComponent>;
  private _tipInstance!: TooltipComponent | null;
  private _withProjectedHTML!: TooltipComponent | null;
  private readonly _passiveListeners: ListenerPattern[] = [];
  private _pointerExitEventsInitialized = false;
  private _message!: string;
  private _viewInitialized = false;
  private _isTooltipVisible = false;
  private _triggerOnClick = false;

  /** Timer started at the last `touchstart` event. */
  private _touchstartTimeout: any;

  constructor(
    public eRef: ElementRef,
    public viewContainerRef: ViewContainerRef,
    private _overlay: Overlay,
    private _ngZone: NgZone,
    private _platform: Platform,
    @Inject(DOCUMENT) private _document: Document,
    dir: Directionality
  ) {
    super(dir);
  }

  private _doesPlatformSupportMouseEvents() {
    return !this._platform.IOS && !this._platform.ANDROID;
  }

  ngAfterViewInit(): void {
    this._viewInitialized = true;
    this._attachEvents();
  }

  private _addOverlay = (options: OverlayConfig) => {
    if (this._overlayRef) return this._overlayRef;

    const positionStrategy = this._overlay
      .position()
      .flexibleConnectedTo(this.eRef)
      .withFlexibleDimensions(false)
      .withViewportMargin(this._viewportMargin);

    this._overlayRef = this._overlay.create({
      positionStrategy,
      panelClass: 'custom-tooltip-animation',
      ...options,
    });

    // Update the position of the newly created overlay
    this._updatePosition(this._overlayRef);

    this._overlayRef
      .outsidePointerEvents()
      .pipe(takeUntil(this._destroyed))
      .subscribe(() => {
        this.hide();
      });

    this._overlayRef
      .keydownEvents()
      .pipe(takeUntil(this._destroyed))
      .subscribe((event) => {
        if (event.code === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this._ngZone.run(() => this.hide());
        }
      });

    return this._overlayRef;
  };

  private _attachEvents() {
    if (this._triggerOnClick) {
      this._enablePointer();
      this._toggleTooltipOnClickEvent();
    }
    // Won't fire when the tooltip is triggered on click
    else this._addEnterEventListeners();
  }

  private _toggleTooltipOnClickEvent() {
    if (
      (!this.customTooltip && !this._withProjectedHTML) ||
      this._viewInitialized ||
      this._passiveListeners.length
    )
      return;
    this._passiveListeners.push([
      'click',
      () => {
        if (this._isTooltipVisible) return;
        this.show();
      },
    ]);

    this._addExitEventListeners();
    this._addListeners(this._passiveListeners);
  }

  private _enablePointer() {
    const _element = this.eRef.nativeElement as HTMLElement;
    _element.style.cursor = 'pointer';
  }

  private _addEnterEventListeners() {
    // don't attach any event if the tooltip is not initialized
    // WARN: touch events are not taken into account, add them if there's a necesity
    if (
      (!this.customTooltip && !this._withProjectedHTML) ||
      this._viewInitialized ||
      this._passiveListeners.length
    )
      return;

    if (this._doesPlatformSupportMouseEvents() && !this._triggerOnClick) {
      this._passiveListeners.push([
        'mouseenter',
        () => {
          this._addExitEventListeners();
          this.show();
        },
      ]);
    } else {
      this._disableNativeGesturesIfNecessary();

      this._passiveListeners.push([
        'touchstart',
        () => {
          // Note that it's important that we don't `preventDefault` here,
          // because it can prevent click events from firing on the element.
          this._addExitEventListeners();
          clearTimeout(this._touchstartTimeout);
          // @ts-ignore
          this._touchstartTimeout = setTimeout(
            () => this.show(),
            LONGPRESS_DELAY
          );
        },
      ]);
    }
    this._addListeners(this._passiveListeners);
  }

  private _addExitEventListeners() {
    // WARN: Touch events are not handled
    if (this._pointerExitEventsInitialized) return;

    this._pointerExitEventsInitialized = true;

    if (this._doesPlatformSupportMouseEvents()) {
      /**
       * Does not add these events when trigger on click is enabled.
       * Instead a close button will be used. Just imagine it,
       * a tooltip enabled on click with a close button, how ridiculous it is.
       * This is because of a dumb law he had to comply with, but what kind of a person
       * with impaired vision would use this app with a screen reader ?
       * I mean common, ridiculousness.
       */
      if (this._triggerOnClick) {
        return;
      }

      this._passiveListeners.push(
        [
          'mouseleave',
          () => {
            this.hide();
          },
        ],
        [
          'wheel',
          (event) => {
            this._wheelListener(event as WheelEvent);
          },
        ]
      );
    } else {
      this._disableNativeGesturesIfNecessary();
      const touchendListener = () => {
        clearTimeout(this._touchstartTimeout);
        this.hide();
      };

      this._passiveListeners.push(
        ['touchend', touchendListener],
        ['touchcancel', touchendListener]
      );
    }

    this._addListeners(this._passiveListeners);
  }

  private _addListeners(lstnrs: ListenerPattern[]) {
    addListener(this.eRef.nativeElement, lstnrs);
  }

  /** Listener for the `wheel` event on the element. */
  private _wheelListener(event: WheelEvent) {
    const elementUnderPointer = this._document.elementFromPoint(
      event.clientX,
      event.clientY
    );
    const element = this.eRef.nativeElement;

    // On non-touch devices we depend on the `mouseleave` event to close the tooltip, but it
    // won't fire if the user scrolls away using the wheel without moving their cursor. We
    // work around it by finding the element under the user's cursor and closing the tooltip
    // if it's not the trigger.
    if (
      elementUnderPointer !== element &&
      !element.contains(elementUnderPointer)
    ) {
      this.hide();
    }
  }

  private _disableNativeGesturesIfNecessary() {
    const style = this.eRef.nativeElement.style;

    style.touchAction = 'none';
    (style as any).webkitTapHighlightColor = 'transparent';
  }

  /** Updates the tooltip message and repositions the overlay according to the new message length */
  private _updateTooltipMessage() {
    // Must wait for the message to be painted to the tooltip so that the overlay can properly
    // calculate the correct positioning based on the size of the text.
    if (this._tipInstance && this._message) {
      this._tipInstance.tooltip = this._message;

      this._ngZone.onMicrotaskEmpty
        .pipe(take(1), takeUntil(this._destroyed))
        .subscribe(() => {
          if (this._tipInstance) this._overlayRef!.updatePosition();
        });
    }
  }

  /**
   * Opens the tooltip using some event
   */
  show() {
    if (this._overlayRef?.hasAttached()) return;
    const overlayRef = this._addOverlay({
      // disables scrolling when the tooltip is enabled on click
      backdropClass: this._triggerOnClick ? 'custom-tooltip-backdrop' : '',
      hasBackdrop: this._triggerOnClick,
    });

    if (this.customTooltip) {
      // @ts-ignore
      this._withProjectedHTML = null;

      this._tipPortal =
        this._tipPortal || new ComponentPortal(TooltipComponent);

      this._tipInstance = this._overlayRef.attach(this._tipPortal).instance;

      this._tipInstance.tooltip = this.customTooltip;
      this._tipInstance.width = this.customTooltipWidth;
      this._tipInstance.borderColor = this.customTooltipBorderColor;
      this._tipInstance.appliedTextClass = this.customTooltipBold
        ? 'bold-text'
        : 'simple-text';
      this._tipInstance.textColor = this.customTooltipColor;
      this._tipInstance.textSize = this.customTooltipTextSize;
      this._tipInstance.shouldEnableCloseBtn = this._triggerOnClick;
      this._tipInstance.closeBtnCb = () => this.hide();
      this._tipInstance.tipPosition = this._tipPosition;

      this._isTooltipVisible = true;
    } else if (this._withProjectedHTML) {
      // @ts-ignore
      this._tipInstance = null;

      this._withProjectedHTML.width = this.customTooltipWidth;
      this._withProjectedHTML.borderColor = this.customTooltipBorderColor;
      this._withProjectedHTML.appliedTextClass = this.customTooltipBold
        ? 'bold-text'
        : 'simple-text';
      this._withProjectedHTML.textColor = this.customTooltipColor;
      this._withProjectedHTML.textSize = this.customTooltipTextSize;
      this._withProjectedHTML.shouldEnableCloseBtn = this._triggerOnClick;
      this._withProjectedHTML.closeBtnCb = () => this.hide();
      this._withProjectedHTML.tipPosition = this._tipPosition;

      this._templatePortal =
        this._templatePortal ||
        new TemplatePortal(
          this._withProjectedHTML.template,
          this.viewContainerRef
        );

      !this._overlayRef.hasAttached() &&
        overlayRef.attach(this._templatePortal);

      this._ngZone.onMicrotaskEmpty
        .pipe(take(1), takeUntil(this._destroyed))
        .subscribe(() => {
          this._overlayRef!.updatePosition();
        });

      this._isTooltipVisible = true;
    }
  }

  /**
   * hides the tooltip
   */
  hide() {
    this._isTooltipVisible = false;
    this._tipInstance = null;
    this._overlayRef?.detach();
  }

  /**
   * toggles the state of the tooltip, can be used to explicitly toggle the tooltip.
   */
  toggle() {
    this._isTooltipVisible ? this.hide() : this.show();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.hide();
    this._withProjectedHTML = null;

    const nativeElement = this.eRef.nativeElement;

    if (this._overlayRef) {
      this._overlayRef.dispose();
    }

    // Clean up the event listeners set in the constructor
    removeListener(nativeElement, this._passiveListeners);
    this._passiveListeners.length = 0;
  }
}

@Component({
  selector: 'custom-tooltip',
  templateUrl: './tooltip.component.html',
  styleUrls: ['./tooltip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class TooltipComponent {
  @Input()
  tooltip!: string;
  @Input() appliedTextClass = 'simple-text';
  @Input() textColor = 'inherit';
  @Input() borderColor = '#008071';
  @Input() width = 150;
  @Input() textSize = '12px';
  @Input() embeddedBodyId: any;
  @Input()
  tipPosition!: OverlayTipPosition;

  @ViewChild('templ', { static: true })
  template!: TemplateRef<HTMLDivElement>;

  shouldEnableCloseBtn = false;
  closeBtnCb!: () => void;

  constructor(private _mir: MatIconRegistry, private _ds: DomSanitizer) {
    this._mir.addSvgIcon('close', this._ds.bypassSecurityTrustResourceUrl('assets/img/cross.svg'));
  }

  parentBorder() {
    return `0.5px solid ${this.borderColor}`;
  }

  tipBorder() {
    return `border-left: 0.5px solid ${this.borderColor};
            border-top: 0.5px solid ${this.borderColor}`;
  }

  tipClass() {
    if (this.tipPosition.match(/(left|before)/)) return 'tip tip-left';
    else if (this.tipPosition.match(/(right|after)/)) return 'tip tip-right';
    else if (this.tipPosition === 'above') return 'tip tip-above';
    else if (this.tipPosition === 'below') return 'tip tip-below';
    else return 'tip tip-below';
  }

  // ngOnInit(): void {
  //     // this.cdRef.detectChanges();
  // }
}

@NgModule({
  imports: [
    CommonModule,
    OverlayModule,
    PlatformModule,
    PortalModule,
    MatButtonModule,
    MatIconModule,
  ],
  declarations: [TooltipComponent, TooltipDirective],
  exports: [TooltipDirective, TooltipComponent],
})
export class TooltipModule {}
