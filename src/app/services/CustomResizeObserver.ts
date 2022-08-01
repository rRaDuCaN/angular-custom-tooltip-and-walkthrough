import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';

/**
 * Provides a mean to watch for viewport size changes.
 * It is subtle & performant, but not suitable for SSR & IE11.
 * For other purposes use ViewportRuler.
 */
@Injectable({ providedIn: 'root' })
export class CustomResizeObserver implements OnDestroy {
    private _until$ = new Subject();
    private _observe = new BehaviorSubject({
        width: this._document.documentElement.clientWidth,
        height: this._document.documentElement.clientHeight,
    });
    readonly observe$ = this._observe.pipe(takeUntil(this._until$));
    private _resizeInstance: ResizeObserver;

    constructor(@Inject(DOCUMENT) private _document: Document) {
        this._resizeInstance = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            this._observe.next({ width, height });
        });

        this._resizeInstance.observe(this._document.documentElement);
    }

    ngOnDestroy(): void {
        this._until$.next(null);
        this._until$.complete();
        this._observe.complete();
        this._resizeInstance.disconnect();
    }
}
