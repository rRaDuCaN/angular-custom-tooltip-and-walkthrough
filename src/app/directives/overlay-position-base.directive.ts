import { Directionality } from '@angular/cdk/bidi';
import {
  OverlayRef,
  FlexibleConnectedPositionStrategy,
  ConnectedPosition,
  OriginConnectionPosition,
  OverlayConnectionPosition,
  HorizontalConnectionPos,
  VerticalConnectionPos,
} from '@angular/cdk/overlay';
import { Directive, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from 'src/environments/environment';

export type OverlayTipPosition =
  | 'left'
  | 'right'
  | 'above'
  | 'below'
  | 'before'
  | 'after';

function throwInvalidTutorialTipPosition() {
  return new Error(
    `The provided tutorial tip position is invalid. 
            Set either tipPosition to: 
            'left' | 'right' | 'above' | 'below' | 'before' | 'after'`
  );
}

/**
 * Creates an overlay so that a tutorial tip could be attached.
 * Has the basic functionality for the overlay positioning.
 */
@Directive()
export class OverlayPositionBaseDirective implements OnDestroy {
  protected _destroyed = new Subject();
  protected _overlayRef!: OverlayRef;
  protected _viewportMargin = 8;

  /** The hand holder's position, defaults to `below` so bear that in mind */
  protected _tipPosition: OverlayTipPosition = 'below';
  protected _offset = 80;

  constructor(private _dir: Directionality) {}

  /** Updates the position of the current tooltip. */
  protected _updatePosition(overlayRef: OverlayRef) {
    const position = overlayRef.getConfig()
      .positionStrategy as FlexibleConnectedPositionStrategy;
    const origin = this._getOrigin();
    const overlay = this._getOverlayPosition();

    position.withPositions([
      this._addOffset({ ...origin.main, ...overlay.main }),
      this._addOffset({ ...origin.fallback, ...overlay.fallback }),
    ]);
  }

  /** Adds the configured offset to a position. Used as a hook for child classes. */
  protected _addOffset(position: ConnectedPosition): ConnectedPosition {
    return position;
  }

  /**
   * Returns the origin position and a fallback position based on the user's position preference.
   * The fallback position is the inverse of the origin (e.g. `'below' -> 'above'`).
   */
  private _getOrigin(): {
    main: OriginConnectionPosition;
    fallback: OriginConnectionPosition;
  } {
    const isLtr = !this._dir || this._dir.value == 'ltr';
    const position = this._tipPosition;
    let originPosition: OriginConnectionPosition;

    if (position == 'above' || position == 'below') {
      originPosition = {
        originX: 'center',
        originY: position == 'above' ? 'top' : 'bottom',
      };
    } else if (
      position == 'before' ||
      (position == 'left' && isLtr) ||
      (position == 'right' && !isLtr)
    ) {
      originPosition = { originX: 'start', originY: 'center' };
    } else if (
      position == 'after' ||
      (position == 'right' && isLtr) ||
      (position == 'left' && !isLtr)
    ) {
      originPosition = { originX: 'end', originY: 'center' };
    } else if (!environment.production) {
      throw throwInvalidTutorialTipPosition();
    }

    const { x, y } = this._invertPosition(
      originPosition!.originX,
      originPosition!.originY
    );

    return {
      main: originPosition!,
      fallback: { originX: x, originY: y },
    };
  }

  /** Returns the overlay position and a fallback position based on the user's preference */
  private _getOverlayPosition(): {
    main: OverlayConnectionPosition;
    fallback: OverlayConnectionPosition;
  } {
    const isLtr = !this._dir || this._dir.value == 'ltr';
    const position = this._tipPosition;
    let overlayPosition: OverlayConnectionPosition;

    if (position == 'above') {
      overlayPosition = { overlayX: 'center', overlayY: 'bottom' };
    } else if (position == 'below') {
      overlayPosition = { overlayX: 'center', overlayY: 'top' };
    } else if (
      position == 'before' ||
      (position == 'left' && isLtr) ||
      (position == 'right' && !isLtr)
    ) {
      overlayPosition = { overlayX: 'end', overlayY: 'center' };
    } else if (
      position == 'after' ||
      (position == 'right' && isLtr) ||
      (position == 'left' && !isLtr)
    ) {
      overlayPosition = { overlayX: 'start', overlayY: 'center' };
    } else if (!environment.production) {
      throw throwInvalidTutorialTipPosition();
    }

    const { x, y } = this._invertPosition(
      overlayPosition!.overlayX,
      overlayPosition!.overlayY
    );

    return {
      main: overlayPosition!,
      fallback: { overlayX: x, overlayY: y },
    };
  }

  /** Inverts an overlay position. */
  private _invertPosition(
    x: HorizontalConnectionPos,
    y: VerticalConnectionPos
  ) {
    if (this._tipPosition === 'above' || this._tipPosition === 'below') {
      if (y === 'top') {
        y = 'bottom';
      } else if (y === 'bottom') {
        y = 'top';
      }
    } else {
      if (x === 'end') {
        x = 'start';
      } else if (x === 'start') {
        x = 'end';
      }
    }

    return { x, y };
  }

  ngOnDestroy(): void {
    this._destroyed.next(null);
    this._destroyed.complete();
  }
}
