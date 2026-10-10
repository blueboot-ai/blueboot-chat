import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

// The embed's scroll lock, shared rather than reimplemented — see
// lockPageScroll() below for the three faults that made the launcher's own
// version worth deleting.
import { isMobileViewport, lockBodyScroll, unlockBodyScroll } from '../../embed/body-scroll-lock.functions';

export type LauncherPanelMode = 'compact' | 'full';

/**
 * Fallback for --bbc-z when placing the panel, and nothing more.
 *
 * Every zIndex this service writes is `cssVar('--bbc-z', DEFAULT_Z)` — it
 * reads the value the host element carries rather than deciding one, so the
 * widget's zindex parameter reaches the placed panel the same way it reaches
 * everything else. This constant only applies if the property is missing
 * entirely, which it should not be: LauncherComponent writes it onto the
 * host, and launcher.component.css declares it on :host as well.
 *
 * It read 2147483647 here, in three separate places, written inline onto the
 * panel every time it was docked or dragged — so a host that had lowered the
 * widget with the parameter got the maximum back the moment the panel moved.
 * That is exactly the kind of hidden second opinion this file should not be
 * having about the page's stacking order.
 *
 * Kept in step with LauncherComponent.DEFAULT_Z and the --bbc-z on :host in
 * launcher.component.css; the comment there carries why the value is 1.
 */
export const DEFAULT_Z = 1;

/** The launcher button's current on-screen box — left/top/right/bottom/
 *  width/height, all in viewport pixels. Computed and owned exclusively by
 *  LauncherPositionService; nothing else derives its own copy of this. */
export type LauncherBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type LauncherPositionOptions = {
  zone: NgZone;
  hostEl: HTMLElement;
  launcherEl: HTMLButtonElement;
  wrapperEl: HTMLDivElement;
  getChatEl: () => HTMLElement | undefined;

  isUiReady: () => boolean;
  getConfiguredMode: () => LauncherPanelMode;
  getPanelMode: () => LauncherPanelMode;
  setPanelMode: (mode: LauncherPanelMode) => void;

  isDraggable: () => boolean;
  isOpenOnHoverEnabled: () => boolean;
  getHoverOpenDelayMs: () => number;

  isVideoEnabled: () => boolean;
  setVideoHover: (on: boolean) => void;
  replayVideo: () => void;

  setOpenFlag: (open: boolean) => void;
  wasOpenBefore: () => boolean;
  persistOpenStateNow: () => void;
};

export type LauncherPositionController = {
  open: (openedByClick?: boolean) => void;
  close: () => void;
  toggle: (openedByClick?: boolean) => void;
  updateDock: () => void;
  /**
   * Re-place the panel against the button without re-docking the button.
   *
   * Exposed for the resize grip, which changes --bbc-compact-width/-height and
   * needs the panel re-read against them. Deliberately not updateDock(): that
   * one may move the button, and a visitor dragging the panel's corner has not
   * asked for the button to go anywhere.
   */
  refreshPanel: () => void;
  destroy: () => void;
};

@Injectable({ providedIn: 'root' })
export class LauncherPositionService {
  // Single shared holder of the launcher's current position. `providedIn:
  // 'root'` already makes this one instance app-wide, so LauncherComponent
  // (which calls setup() and drives this on every dock) and ChatComponent
  // (the panel content rendered inside the wrapper setup() positions) get
  // the exact same object by injecting this service — neither keeps its
  // own copy of where the launcher is.
  private readonly launcherBoxSubject = new BehaviorSubject<LauncherBox | null>(null);
  readonly launcherBox$: Observable<LauncherBox | null> = this.launcherBoxSubject.asObservable();

  get currentLauncherBox(): LauncherBox | null {
    return this.launcherBoxSubject.value;
  }

  private static readonly DEFAULT_LAUNCHER_SIZE_PX = 64;

  /**
   * Sets the button's own size as `--bbc-launcher-size`, the custom property
   * launcher.component.css uses for its width and height — and, separately, as
   * `--bbc-launcher-size-px`, the plain number dockLauncherToWindow() falls
   * back to. Was previously written directly by LauncherComponent onto its host
   * element — moved here so every piece of state this service's position math
   * depends on is written and owned in one place.
   */
  setLauncherSize(hostEl: HTMLElement, px: number | undefined): void {
    const n = px ?? LauncherPositionService.DEFAULT_LAUNCHER_SIZE_PX;

    // A clamp, not a flat px, and this fixes a real bug rather than being
    // decoration.
    //
    // launcher.component.css shrinks the button below 600px with exactly this
    // expression — but only as a DEFAULT, and its own comment says why that is
    // not enough: the value written here is an INLINE style on the host, and an
    // inline style beats a stylesheet rule. So every app that had configured a
    // launcherSize kept its desktop-sized button on a phone, which is the one
    // case the media query was written for.
    //
    // Expressed in CSS rather than measured in JS so it follows a rotation or a
    // resized window on its own — there is no listener to forget.
    //
    // The floor is min(48px, n), not a flat 48px: an app that deliberately
    // configured a SMALL button (say 40px) would otherwise be grown to 48 on
    // every screen, because CSS clamp() returns the minimum when the maximum is
    // below it. With the min() the configured size is never exceeded in either
    // direction — n is the ceiling, and the floor never rises above it.
    hostEl.style.setProperty(
        '--bbc-launcher-size',
        `clamp(min(48px, ${n}px), 15vw, ${n}px)`,
    );

    // The same number, plainly, for JavaScript.
    //
    // Custom properties hand back their SPECIFIED value, not a computed one —
    // getPropertyValue('--bbc-launcher-size') now returns the literal string
    // "clamp(min(48px, 64px), 15vw, 64px)", and pxNum() parses that to NaN and
    // falls back to 0. That path is the `launcher.offsetWidth || …` fallback in
    // dockLauncherToWindow(), which runs when the button has not been laid out
    // yet — and a zero-width button box would place the panel against nothing.
    hostEl.style.setProperty('--bbc-launcher-size-px', `${n}px`);
  }

  /**
   * Sets the panel's size/offset CSS custom properties
   * (--bbc-compact-width/-height/-side-offset/-gap) from an app's
   * widgetParams. Same rationale as setLauncherSize(): this used to be
   * written directly by LauncherComponent onto its host element.
   */
  applyPanelCssVars(hostEl: HTMLElement, wp: any): void {
    const style = hostEl.style;

    if (wp?.compactWidth) style.setProperty('--bbc-compact-width', `${wp.compactWidth}px`);
    if (wp?.compactHeight) style.setProperty('--bbc-compact-height', `${wp.compactHeight}px`);

    // Clamped: the admin form's "Side offset (px)" / "Gap (px)" fields take
    // any number with no validation. This value is also the button's own
    // distance from the window edge (dockLauncherToWindow() reads the same
    // custom property) and feeds directly into the panel's offset from the
    // button, so an accidental large value (e.g. 500 typed where 16 was
    // meant) doesn't just look wrong — it pushes both the button and the
    // panel far from the corner, which at a typical window width looks
    // like they jumped to the middle of the screen. Capped at 25px — well
    // past any legitimate value for either field — so a fat-fingered
    // config value can't break the layout outright.
    if (wp?.sideOffset != null) {
      style.setProperty('--bbc-side-offset', `${this.clamp(Number(wp.sideOffset) || 0, 0, 25)}px`);
    }
    if (wp?.gap != null) {
      style.setProperty('--bbc-gap', `${this.clamp(Number(wp.gap) || 0, 0, 25)}px`);
    }
  }

  cssVar(name: string, fallback: string | number, hostEl?: HTMLElement): string {
    const fromHost = hostEl
      ? getComputedStyle(hostEl).getPropertyValue(name).trim()
      : '';

    return fromHost || getComputedStyle(document.documentElement).getPropertyValue(name).trim() || String(fallback);
  }

  pxNum(v: any): number {
    return parseFloat(String(v).replace('px', '')) || 0;
  }

  clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  visualViewport(): VisualViewport | undefined {
    return (window as any).visualViewport as VisualViewport | undefined;
  }

  viewportWidth(): number {
    const v = this.visualViewport();
    return v ? Math.round(v.width) : window.innerWidth;
  }

  /**
   * The LAYOUT viewport — what `position: fixed` is measured against.
   *
   * Not the same as viewportWidth()/viewportHeight() above, which report the
   * *visual* viewport: that shrinks with browser zoom and with the on-screen
   * keyboard. Clamping a fixed element's right/bottom against the visual
   * viewport confines it to a box smaller than the window — at 150% zoom, two
   * thirds of it — so it cannot be dragged to the edge and pins early.
   *
   * documentElement.clientWidth/Height excludes scrollbars, which is what fixed
   * positioning uses, so the two agree at any zoom level.
   */
  layoutViewportWidth(): number {
    return document.documentElement?.clientWidth || window.innerWidth;
  }

  layoutViewportHeight(): number {
    return document.documentElement?.clientHeight || window.innerHeight;
  }

  viewportHeight(): number {
    const v = this.visualViewport();
    return v ? Math.round(v.height) : window.innerHeight;
  }

  /**
   * Hold the page still behind an open panel.
   *
   * THE EMBED'S LOCK, not a second implementation. This used to set
   * `overflow: hidden` on html and body, which has three faults the embed had
   * already found and fixed:
   *
   *   · it does not work on iOS Safari, which scrolls the body regardless —
   *     the embed takes the body out of flow at a negative offset instead
   *   · it wrote `''` on release rather than restoring, so a host page that
   *     had its own inline `overflow` lost it permanently to a widget
   *   · it was not reference-counted, so a launcher and an embed on one page
   *     unlocked each other, and the second one to close left the page frozen
   *
   * `holders` in body-scroll-lock.functions.ts is shared across both surfaces,
   * which is exactly what makes the third one go away.
   *
   * overscroll-behavior stays here: it belongs to this wrapper, not to the
   * body, and stops a scroll that reaches the end of the conversation from
   * carrying on into the page underneath.
   */
  lockPageScroll(lock: boolean, wrapper: HTMLElement): void {
    wrapper.style.overscrollBehavior = lock ? 'contain' : '';

    // PER LAUNCHER, and the state has to live per launcher too — this service
    // is providedIn:'root', so a field on it would be shared by every launcher
    // on the page. It is kept on the wrapper element instead, which is the one
    // thing there is exactly one of per launcher.
    //
    // Why a flag at all: `holders` in body-scroll-lock.functions.ts counts
    // holders, and positionPanel() runs on every resize while a panel is open.
    // Without this, one launcher would take a dozen holds and release one.
    const held = wrapper.dataset['bbcScrollHeld'] === '1';

    if (lock) {
      if (!held) {
        wrapper.dataset['bbcScrollHeld'] = '1';
        lockBodyScroll();
      }
      return;
    }

    if (held) {
      delete wrapper.dataset['bbcScrollHeld'];
      unlockBodyScroll();
    }
  }

  /**
   * The host's own z-index while a panel is covering the screen.
   *
   * High enough to clear anything a page realistically declares, and NOT
   * 2147483647: the maximum is the claim that nothing may ever cover the
   * widget, which is the claim this codebase deliberately gave up (see the
   * --bbc-z comment in launcher.component.css). This is the weaker and truer
   * one — while the conversation IS the screen, it outranks the page's own
   * furniture; the moment it closes, the widget drops back to whatever level
   * the host gave it.
   */
  private static readonly FULLSCREEN_Z = 2147483000;

  /**
   * Where the host's previous z-index is remembered: on the host itself.
   *
   * NOT a field on this service. It is providedIn:'root' — one instance for
   * every launcher on the page — so a field here would be written by whichever
   * panel opened first and read by whichever closed last. Two launchers, both
   * opened full-screen, and the second to close would never be restored: its
   * host would keep 2147483000 for ever, and its little closed button would sit
   * above everything on the page.
   *
   * A data attribute on the element the value belongs to cannot be mixed up
   * that way, and it disappears with the element.
   */
  private static readonly Z_BEFORE_ATTR = 'bbcZBefore';

  /**
   * Enter or leave the screen-covering state.
   *
   * TWO THINGS AT ONCE, because they are the same fact: the panel owns the
   * viewport, so the button must not be pressable under it and the page must
   * not paint over it.
   *
   * The z-index is the part that is easy to get wrong. The launcher's host is
   * `position: fixed; inset: 0` with a z-index, which makes it a STACKING
   * CONTEXT: everything inside is capped at that level relative to the page.
   * The default is 1 — deliberately — so a host's sticky navbar at 10 paints
   * straight over a panel that is supposed to be covering the screen. Raising
   * the host, not the wrapper, is what actually works; raising the wrapper
   * would only reorder it against its siblings inside a context that is still
   * pinned at 1.
   *
   * Restored rather than cleared: the host may carry a level the customer
   * asked for through `zindex=`, and `''` would throw that away. The previous
   * value is remembered on the way in and written back on the way out.
   */
  setFullscreen(hostEl: HTMLElement, launcherEl: HTMLElement, on: boolean): void {
    const ATTR = LauncherPositionService.Z_BEFORE_ATTR;

    if (on) {
      if (hostEl.dataset[ATTR] === undefined) {
        hostEl.dataset[ATTR] = hostEl.style.zIndex || '';
      }
      hostEl.style.zIndex = String(LauncherPositionService.FULLSCREEN_Z);

      // Hidden, not merely covered. visibility keeps the button's box, so
      // getLauncherBox() still reports where it will be when it returns —
      // display:none would collapse it to nothing and the panel's own geometry
      // reads that box.
      //
      // Both values are SAVED, not assumed. The button carries inline styles
      // from ngAfterViewInit (pointer-events: auto, which is what lets it be
      // pressed inside a host that is pointer-events: none), and clearing them
      // would quietly hand that job to a stylesheet rule that happens to agree
      // today.
      if (launcherEl.dataset['bbcVisBefore'] === undefined) {
        launcherEl.dataset['bbcVisBefore'] = launcherEl.style.visibility || '';
      }

      // visibility alone. A hidden box is not hit-tested, so pointer-events
      // would be guarding something that cannot be reached anyway — and the
      // button carries an inline pointer-events from ngAfterViewInit that is
      // then one more thing to save and put back.
      launcherEl.style.visibility = 'hidden';
      return;
    }

    if (hostEl.dataset[ATTR] !== undefined) {
      hostEl.style.zIndex = hostEl.dataset[ATTR] as string;
      delete hostEl.dataset[ATTR];
    }

    if (launcherEl.dataset['bbcVisBefore'] !== undefined) {
      launcherEl.style.visibility = launcherEl.dataset['bbcVisBefore'] as string;
      delete launcherEl.dataset['bbcVisBefore'];
    }
  }

  setup(options: LauncherPositionOptions): LauncherPositionController {
    const {
      zone,
      hostEl,
      launcherEl: launcher,
      wrapperEl: wrapper,
    } = options;

    const disposers: Array<() => void> = [];
    let openTouchTimer: any = null;
    let hoverTimer: any = null;
    let raf = 0;

    const listen = (
      target: EventTarget | undefined | null,
      type: string,
      handler: EventListenerOrEventListenerObject,
      opts?: AddEventListenerOptions | boolean,
    ) => {
      if (!target) return;

      target.addEventListener(type, handler, opts);
      disposers.push(() => target.removeEventListener(type, handler, opts as any));
    };

    const cssVar = (n: string, fallback: string | number) => this.cssVar(n, fallback, hostEl);
    const pxNum = (v: any) => this.pxNum(v);
    const clamp = (v: number, min: number, max: number) => this.clamp(v, min, max);

    // The LAYOUT viewport, not the visual one — same metric
    // dockLauncherToWindow() and the drag bounds already use for the
    // button's own left/top/right/bottom. box.left/box.top (read by
    // positionPanel() below) are computed against this same metric, so the
    // panel's own math has to agree with it too: mixing this with the
    // visual viewport (viewportWidth()/viewportHeight(), which shrinks
    // under browser zoom or the on-screen keyboard) made "vw() - box.left"
    // and similar arithmetic combine two different coordinate systems,
    // which is what could land the panel far from the button — including
    // toward the middle of the screen — at any zoom level other than 100%.
    const vw = () => this.layoutViewportWidth();
    const vh = () => this.layoutViewportHeight();

    const PANEL_OFFSET = 12;
    const GAP = () => pxNum(cssVar('--bbc-gap', 12));
    const getLauncherRect = () => launcher.getBoundingClientRect();

    const startOpenTouch = () => {
      if (openTouchTimer) return;

      openTouchTimer = setInterval(() => {
        if (!wrapper.hasAttribute('hidden')) {
          options.setOpenFlag(true);
        }
      }, 60_000);
    };

    const stopOpenTouch = () => {
      if (!openTouchTimer) return;

      clearInterval(openTouchTimer);
      openTouchTimer = null;
    };

    const cancelHoverOpen = () => {
      if (!hoverTimer) return;

      clearTimeout(hoverTimer);
      hoverTimer = null;
    };

    // The box dockLauncherToWindow() last computed and wrote onto the
    // button, kept so the panel can reuse those exact numbers rather than
    // reading the DOM back a moment later (see getLauncherBox()). Local to
    // this setup() call as a hot-path cache; the service-level
    // launcherBoxSubject (published below) is the actual shared state other
    // consumers — the chat panel included — should read.
    let lastAutoDock: LauncherBox | null = null;

    /**
     * Docks the round launcher button to the browser window's bottom-right
     * corner — via plain `right`/`bottom` CSS, which is inherently relative
     * to that corner of the window on its own. No `left`/`top` pixel math
     * against window.innerWidth/innerHeight: expressing this as a distance
     * from the right/bottom edges is exactly "calculated relative to the
     * right lower corner of the browser window," and the browser keeps it
     * correct through any resize with nothing further required here.
     *
     * Never runs mid-drag or after one: a real drag already sets its own
     * right/bottom via moveDrag(), and this would otherwise snap the button
     * straight back to the corner the instant the window resizes, undoing
     * a manual move — the corner is only the default until someone moves it.
     */
    const dockLauncherToWindow = (): LauncherBox | null => {
      if (pointerIsDown || dragging) return null;
      if (launcher.dataset['bbcMoved'] === '1') return null;

      const offset = pxNum(cssVar('--bbc-side-offset', 16));

      launcher.style.position = 'fixed';

      // The offset plus whatever the device reserves at that edge.
      //
      // A flat 16px puts the button under the home indicator on an iPhone and
      // behind Safari's bottom toolbar — it is on screen, and a visitor still
      // cannot press it. The widget has to handle that itself: it ships to
      // sites that know nothing about it, so "the host page will leave room" is
      // not available to us.
      //
      // env() rather than a measurement: it is live, so it follows a rotation
      // and the toolbar retracting without a listener, and it resolves to 0 on
      // every device that reserves nothing — which makes this inert on desktop
      // rather than conditional.
      launcher.style.right = `calc(${offset}px + env(safe-area-inset-right, 0px))`;
      launcher.style.bottom = `calc(${offset}px + env(safe-area-inset-bottom, 0px))`;
      launcher.style.left = '';
      launcher.style.top = '';

      // MEASURED, not recomputed from the offset.
      //
      // left/top used to be derived arithmetically, which was exact while the
      // offset was the whole story. It is not any more: the right/bottom above
      // add env(safe-area-inset-*), a value only the browser knows.
      // positionPanel()'s wide branch anchors the panel to box.right/box.top,
      // so a recomputed box would place it an inset away from its own button.
      //
      // All six come from the one rect — mixing a measured left with a
      // guessed width is how a box ends up describing nothing that exists.
      // The size fallback stays for the pre-paint case, where the rect is all
      // zeroes and positionPanel() retries on the next frame anyway.
      const rect = launcher.getBoundingClientRect();
      const w = rect.width || pxNum(cssVar('--bbc-launcher-size-px', 64));
      const h = rect.height || pxNum(cssVar('--bbc-launcher-size-px', 64));
      const left = Math.max(0, Math.round(rect.left));
      const top = Math.max(0, Math.round(rect.top));

      lastAutoDock = { left, top, right: left + w, bottom: top + h, width: w, height: h };
      return lastAutoDock;
    };

    /**
     * The launcher's own position — the single place this is decided.
     *
     * Docks it to the window by default (see dockLauncherToWindow()); once
     * it has been manually moved (or is mid-drag), its real DOM position is
     * the only source of truth, so this falls back to reading it live via
     * getBoundingClientRect(). Either way, the launcher — not the panel —
     * is the party that determines this box.
     *
     * Only call this where the button is actually allowed to move (window
     * resize, first paint). Opening/closing the panel must never call this
     * — see readLauncherBox() below.
     */
    const getLauncherBox = (): LauncherBox => {
      const docked = dockLauncherToWindow();
      const box = docked ?? (() => {
        const r = getLauncherRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      })();

      // Published on the shared service instance — this is what makes the
      // position available to anything else that injects
      // LauncherPositionService, the chat panel included, without having
      // to be handed it explicitly through inputs or events.
      this.launcherBoxSubject.next(box);

      return box;
    };

    /**
     * Reads the button's current on-screen box without re-docking it —
     * i.e. without touching launcher.style.right/bottom at all. Opening or
     * closing the chat panel must only ever position the *panel* against
     * where the button already is; it must never recompute or reassign the
     * button's own position. dockLauncherToWindow() (via getLauncherBox())
     * is reserved for the cases that can legitimately move the button: the
     * window resizing, or the very first paint.
     */
    const readLauncherBox = (): LauncherBox => {
      const r = getLauncherRect();
      const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      this.launcherBoxSubject.next(box);
      return box;
    };

    const DOCK_RETRY_FRAMES = 5;

    /**
     * Positions the chat panel against a launcher box passed in explicitly
     * — the panel never computes or fetches its own position. The launcher
     * is the responsible party: updateDock() below calls getLauncherBox()
     * once and hands the result here as a parameter.
     */
    const positionPanel = (box: LauncherBox, retriesLeft = DOCK_RETRY_FRAMES) => {
      if (wrapper.hasAttribute('hidden')) return;

      // Defensive only — getLauncherBox()'s default path no longer depends
      // on the browser having painted the button yet, but the
      // dragged/manually-moved fallback still reads the live DOM, so keep a
      // short retry rather than positioning off a bad rect.
      if (!box.width || !box.height) {
        if (retriesLeft > 0) {
          // Re-read only — never re-dock here. This retry exists purely for
          // the case where the button hadn't painted yet; it must not be
          // the thing that moves it.
          requestAnimationFrame(() => positionPanel(readLauncherBox(), retriesLeft - 1));
        }
        return;
      }

      const panelW = cssVar('--bbc-compact-width', '360px');
      const panelHPx = pxNum(cssVar('--bbc-compact-height', '480px'));

      // isMobileViewport(), not `vw() <= 600`. Both mean "phone", but vw() is
      // documentElement.clientWidth, which EXCLUDES a classic scrollbar, while
      // the stylesheets' @media includes it. Between 601 and ~616px the two
      // disagreed: the panel went full-screen and the body locked while the
      // header still showed its desktop controls. body-scroll-lock.functions
      // owns the definition and says so — this now uses it.
      const isNarrow = isMobileViewport();

      // A phone gets the full screen, whatever mode the panel was left in.
      //
      // openChat() forces 'full' below the breakpoint, but a panel opened on a
      // desktop in compact mode and then narrowed — a rotated tablet, a dragged
      // window — arrived here still 'compact'. That used to be recoverable
      // because the header's expand button could grow it; that button is hidden
      // on phones now, so without this the visitor is left with a card they
      // cannot do anything about.
      if (isNarrow && options.getPanelMode() === 'compact') {
        options.setPanelMode('full');
      }

      if (options.getPanelMode() === 'compact') {
        wrapper.classList.remove('bbc-full');

        // Derived from the button's actual box, not a constant offset —
        // this must track the button whether it's sitting at the default
        // corner or has been dragged somewhere else on screen. `box` is
        // always the button's real getBoundingClientRect() (fresh on every
        // call: dockLauncherToWindow() when it's docked, a live re-read via
        // readLauncherBox() once it's been moved — see moveDrag()'s
        // scheduleDock() call on every drag frame), so "distance from the
        // window's right edge to the button's right edge" and "...bottom
        // edge to the button's top edge" both stay correct in either case.
        // At the default corner this reduces to exactly the old constant
        // formula (box.right = vw() - offset, box.top = vh() - offset -
        // box.height), so nothing changes for the common, undragged case.
        const right = (vw() - box.right) + GAP();
        const bottom = (vh() - box.top) + GAP();

        // Height and the effective bottom clamp are expressed as CSS
        // calc() against real viewport units (vh), not resolved to a
        // fixed pixel number here — so the browser keeps this correct on
        // every resize by itself, with no resize listener needed to
        // recompute it. min()/max() are plain CSS, evaluated live.
        const minTop = 8;
        const height = `min(${panelHPx}px, calc(100vh - ${bottom}px - ${minTop}px))`;

        Object.assign(wrapper.style as any, {
          position: 'fixed',
          right: `${right}px`,
          bottom: `${bottom}px`,
          left: '',
          top: '',
          width: panelW,
          height,
          maxWidth: 'none',
          zIndex: cssVar('--bbc-z', DEFAULT_Z),
          background: '#fff',
        });

        // Leaving full mode (the visitor pressed restore) puts the button and
        // the host's z-index back.
        this.setFullscreen(hostEl, launcher, false);
        this.lockPageScroll(false, wrapper);
        return;
      }

      wrapper.classList.add('bbc-full');

      // ── Full, and on a phone that means the whole screen ──────────────────
      //
      // Full mode used to stop `button height + 12px` short of the bottom so
      // the launcher button stayed tappable underneath. On a phone that gap was
      // the difference between a conversation and a screen: a strip of the host
      // page showing through at the bottom, and a panel that never quite
      // committed. The embed has covered the viewport on this breakpoint for a
      // long time (embed.component.css) and this brings the launcher alongside
      // it — "on a phone the panel is not a window, it is the screen".
      //
      // The button goes with it. It is covered by the panel anyway at this
      // size, and a button that cannot be seen but can still be pressed is a
      // tap target hiding under a conversation. The way out is the close
      // control in the panel's own header, which is always rendered.
      //
      // Above 600px nothing changes: full mode keeps the bottom gap and the
      // button stays where it is.
      // The panel is open — positionPanel() returns at the top otherwise — so
      // hiding the button here always has something covering it.
      this.setFullscreen(hostEl, launcher, isNarrow);

      const bottomGap = isNarrow ? 0 : box.height + PANEL_OFFSET;

      Object.assign(wrapper.style as any, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: `${bottomGap}px`,
        width: 'auto',
        // Replaced by 100dvh below on a phone — `auto` there would be the
        // distance between top:0 and bottom:0, the LAYOUT viewport, which
        // includes the strip a mobile browser retracts its address bar from.
        height: 'auto',
        maxWidth: '100%',
        zIndex: cssVar('--bbc-z', DEFAULT_Z),
        background: '#fff',
      });

      if (isNarrow) {
        // Two writes, and the order matters for a reason that is NOT the
        // cascade: an inline style is a property map, not a list of
        // declarations. The second call REPLACES the first where dvh is
        // understood; where it is not, the value is unparsable and setProperty
        // is a no-op, so 100vh survives. Either way the element ends up with
        // one height and it is the best one available.
        //
        // dvh rather than vh because on mobile Safari and Chrome 100vh is the
        // viewport WITHOUT the retracting address bar — a panel sized to it is
        // taller than the screen, and its header scrolls out of reach.
        wrapper.style.setProperty('height', '100vh');
        wrapper.style.setProperty('height', '100dvh');
      }

      // Only on a phone. The lock takes the body out of flow at a negative
      // offset — right when the panel IS the screen, wrong on a desktop where
      // full mode still leaves the page visible through the gap at the bottom
      // and the visitor can reasonably keep using it. body-scroll-lock's own
      // header says the same: "Embed only, and mobile only".
      this.lockPageScroll(isNarrow, wrapper);
    };

    /**
     * The launcher computes its own position, then hands it to the panel
     * explicitly — this is the one place those two steps are wired
     * together. Callers throughout this file (open/close/toggle, resize,
     * scheduleDock, etc.) all go through this rather than positioning
     * either element independently.
     */
    const updateDock = () => {
      const box = getLauncherBox();
      positionPanel(box);
    };

    /**
     * Repositions the panel against the button's current box WITHOUT
     * re-docking the button — the button does not move just because the
     * panel opened, closed, or switched between compact/full. Use this for
     * every panel-only state change (open, toggle fullscreen); reserve
     * updateDock() for the cases that can legitimately move the button
     * itself (window resize, first paint).
     */
    const refreshPanel = () => {
      positionPanel(readLauncherBox());
    };

    // Syncs the header's own maximize/restore button to a given fullscreen
    // state without going through the `mode` @Input (which the launcher
    // never binds on <blue-search-base> — see the header of chat.component.ts).
    // The button reads/writes this attribute itself in
    // onToggleFullscreenClick(), so setting it here keeps the icon honest
    // whenever *this* file — not a real click — decides the panel opens in
    // full mode.
    const syncFullscreenToggleAttr = (on: boolean) => {
      const btn = options.getChatEl()?.shadowRoot?.querySelector('.widget-header__max');
      btn?.setAttribute('aria-pressed', String(on));
    };

    const openChat = (openedByClick = false) => {
      if (!options.isUiReady()) return;

      wrapper.removeAttribute('hidden');
      launcher.setAttribute('aria-expanded', 'true');

      // On a phone, full mode is the only mode: the header's expand/contract
      // toggle is hidden below this breakpoint, so there is nothing to tap and
      // nothing to tap it back to. positionPanel() enforces the same thing for
      // a panel that reaches a narrow viewport by being resized rather than
      // opened. Desktop keeps whatever mode is configured.
      const initialMode = isMobileViewport() ? 'full' : options.getConfiguredMode();
      options.setPanelMode(initialMode);
      syncFullscreenToggleAttr(initialMode === 'full');
      options.setOpenFlag(true);

      startOpenTouch();

      // Opening no longer touches the clip. It used to restart it with sound,
      // which made opening a conversation the only way to hear the video and
      // closing one the only way to stop it — two unrelated things on one
      // gesture. The sound follows the cursor now; see the hover handlers.

      options.getChatEl()?.dispatchEvent(
        new CustomEvent('bbc-opened', {
          bubbles: true,
          composed: true,
        }),
      );

      // refreshPanel, not updateDock — opening the chat must only place the
      // panel against the button; it must never re-dock (move) the button.
      requestAnimationFrame(refreshPanel);
    };

    const closeChat = () => {
      wrapper.setAttribute('hidden', '');
      launcher.setAttribute('aria-expanded', 'false');

      // Before the scroll unlock, and unconditionally: this is the one path
      // every close goes through, so it is where the button comes back and the
      // host's z-index is handed over to whatever the page gave it.
      this.setFullscreen(hostEl, launcher, false);
      this.lockPageScroll(false, wrapper);
      stopOpenTouch();

      options.setOpenFlag(false);
      // The clip is not stopped here. It follows the cursor, and closing the
      // panel does not move the cursor — a visitor who closes the widget with
      // the pointer still on the button is still looking at the button.

      options.getChatEl()?.dispatchEvent(
        new CustomEvent('bbc-closed', {
          bubbles: true,
          composed: true,
        }),
      );
    };

    const toggleChat = (openedByClick = false) => {
      if (!options.isUiReady()) return;

      // No clip-stopping rule here any more, and removing it was necessary
      // rather than tidy. It swallowed a press while the video was playing so
      // the press would stop the clip instead of closing the panel — correct
      // when opening was what started the video. Now HOVERING starts it, and a
      // finger on the button is by definition hovering: every click would have
      // been eaten as "stop the video" and the panel could never be closed
      // from its own button. Leaving the button stops the clip; that is what
      // the cursor is for.
      wrapper.hasAttribute('hidden') ? openChat(openedByClick) : closeChat();
    };

    // Double click: play the clip again.
    //
    // The launcher plays its video once and hands back to the icon, which
    // leaves no way to see it a second time — this is that way, and it asks
    // for the one thing the button is already showing.
    //
    // The two single clicks still fire and still do their own work: the panel
    // opens, and the second press stops the clip that opening started. The
    // replay lands after both and is what the visitor is left with. Deferring
    // the single click to find out whether a second one is coming would put a
    // quarter-second of nothing between pressing the button and the widget
    // opening, which is a worse trade than a clip that restarts.
    listen(launcher, 'dblclick', () => {
      if (!options.isVideoEnabled()) return;
      options.replayVideo();
    });

    const canHoverNow = () =>
      !!window.matchMedia &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    listen(launcher, 'mouseenter', () => {
      if (!canHoverNow()) return;
      if (!options.isOpenOnHoverEnabled()) return;
      if (!options.isUiReady()) return;
      if (!wrapper.hasAttribute('hidden')) return;

      cancelHoverOpen();

      hoverTimer = setTimeout(() => {
        if (!options.isOpenOnHoverEnabled()) return;
        if (!wrapper.hasAttribute('hidden')) return;

        openChat(false);
      }, options.getHoverOpenDelayMs());
    });

    listen(launcher, 'mouseleave', () => {
      cancelHoverOpen();
    });

    // The clip follows the cursor: it plays while the pointer is on the button.
    //
    // Separate listeners from the hover-to-open pair above, and deliberately
    // not folded into them: that one is gated on isOpenOnHoverEnabled(), a
    // setting about whether the panel opens by itself, and it returns early
    // when the panel is already open. Neither has anything to do with whether
    // a visitor looking at the clip should hear it.
    //
    // canHoverNow() still applies. On a touch screen there is no hover to
    // leave, so sound turned on by a tap would stay on with the cursor
    // nowhere near the button — and the browser blocks unmuted playback there
    // anyway.
    listen(launcher, 'mouseenter', () => {
      if (!canHoverNow()) return;
      options.setVideoHover(true);
    });

    listen(launcher, 'mouseleave', () => {
      // No canHoverNow() guard on the way out: whatever started the clip,
      // leaving the button must be able to stop it.
      options.setVideoHover(false);
    });

    listen(launcher, 'keydown', (event) => {
      const e = event as KeyboardEvent;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleChat(true);
      }
    });

    const MOVE_EPS = 6;

    let pointerIsDown = false;
    let dragging = false;

    let pressStartX = 0;
    let pressStartY = 0;

    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    const scheduleDock = () => {
      if (raf) cancelAnimationFrame(raf);

      raf = requestAnimationFrame(() => {
        raf = 0;

        if (!wrapper.hasAttribute('hidden')) {
          updateDock();
        }
      });
    };

    const beginDrag = (ev: PointerEvent) => {
      if (!options.isDraggable() || dragging) return;

      dragging = true;

      startX = ev.clientX;
      startY = ev.clientY;

      // Seeded from real geometry, not from getComputedStyle().right/bottom.
      // Those read `auto` whenever the inline `var(--bbc-side-offset)` fails to
      // resolve, and pxNum turns `auto` into 0 — after which `startBottom - dy`
      // is negative for any downward drag and clamps straight back, so the
      // button could be dragged up but never down. A rect is always numbers.
      const r0 = launcher.getBoundingClientRect();
      startRight = this.layoutViewportWidth() - r0.right;
      startBottom = this.layoutViewportHeight() - r0.bottom;

      launcher.style.left = '';
      launcher.style.top = '';
      launcher.style.transition = 'none';

      try {
        launcher.setPointerCapture(ev.pointerId);
      } catch {}

      document.documentElement.style.userSelect = 'none';
      (launcher.style as any).touchAction = 'none';
      launcher.style.cursor = 'grabbing';
    };

    const moveDrag = (ev: PointerEvent) => {
      if (!pointerIsDown) return;

      // Second line of defence for the same failure: for mouse input `buttons`
      // is 0 once every button is released, so a pointerIsDown that survived a
      // missed pointerup cannot drag anything.
      if (ev.pointerType === 'mouse' && ev.buttons === 0) {
        endDrag(ev);
        return;
      }

      const dxPress = ev.clientX - pressStartX;
      const dyPress = ev.clientY - pressStartY;
      const movedEnough = Math.abs(dxPress) > MOVE_EPS || Math.abs(dyPress) > MOVE_EPS;

      if (!dragging) {
        if (!options.isDraggable()) return;
        if (!movedEnough) return;

        cancelHoverOpen();
        beginDrag(ev);
      }

      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      const w = launcher.offsetWidth || 64;
      const h = launcher.offsetHeight || 64;

      let nextRight = startRight - dx;
      let nextBottom = startBottom - dy;

      // The only constraint is staying within the viewport the button is
      // positioned against — the full layout viewport, edge to edge. The old
      // bounds inset every side by --bbc-side-offset, which stopped the drag
      // short of the edges, and measured the visual viewport, which is smaller
      // still whenever the page is zoomed.
      const maxRight = Math.max(0, this.layoutViewportWidth() - w);
      const maxBottom = Math.max(0, this.layoutViewportHeight() - h);

      nextRight = clamp(nextRight, 0, maxRight);
      nextBottom = clamp(nextBottom, 0, maxBottom);

      launcher.style.right = `${nextRight}px`;
      launcher.style.bottom = `${nextBottom}px`;

      // Marks this button as manually placed, so dockLauncherToWindow()
      // (run on window resize) stops overriding it back to the corner —
      // per requirement, the corner is only the default "unless it is
      // manually moved".
      launcher.dataset['bbcMoved'] = '1';

      scheduleDock();
    };

    const endDrag = (ev: PointerEvent) => {
      pointerIsDown = false;

      if (!dragging) return;

      dragging = false;

      try {
        launcher.releasePointerCapture(ev.pointerId);
      } catch {}

      launcher.style.transition = '';
      document.documentElement.style.userSelect = '';
      launcher.style.cursor = options.isDraggable() ? 'grab' : 'pointer';
    };

    listen(launcher, 'pointerdown', (event) => {
      const e = event as PointerEvent;

      if ((e as any).button != null && (e as any).button !== 0) return;

      pointerIsDown = true;
      dragging = false;

      pressStartX = e.clientX;
      pressStartY = e.clientY;

      cancelHoverOpen();
    });

    listen(launcher, 'pointerup', (event) => {
      const e = event as PointerEvent;

      const dx = e.clientX - pressStartX;
      const dy = e.clientY - pressStartY;
      const movedEnough = Math.abs(dx) > MOVE_EPS || Math.abs(dy) > MOVE_EPS;

      // endDrag in a finally: it is what clears pointerIsDown, and toggleChat
      // runs the whole open path. If anything in there throws, the drag state
      // would stay armed and moveDrag would then fire on ordinary mouse
      // movement with no button held — the launcher follows the cursor and
      // looks frozen. Releasing the pointer must always release the drag.
      try {
        if (!dragging && !movedEnough) {
          toggleChat(true);
        }
      } finally {
        endDrag(e);
      }
    });

    listen(window, 'pointermove', (event) => moveDrag(event as PointerEvent), { passive: true } as any);
    listen(window, 'pointerup', (event) => endDrag(event as PointerEvent));
    listen(window, 'pointercancel', (event) => endDrag(event as PointerEvent));

    const applyDragCursor = () => {
      launcher.style.cursor = options.isDraggable() ? 'grab' : 'pointer';
      (launcher.style as any).touchAction = options.isDraggable() ? 'none' : 'auto';
    };

    applyDragCursor();

    const onToggle = (on: boolean) => {
      zone.run(() => {
        options.setPanelMode(on ? 'full' : 'compact');
        // refreshPanel, not updateDock — switching compact/full only
        // resizes the panel; the button stays exactly where it is.
        refreshPanel();
      });
    };

    const toggleHandler = (event: Event) => onToggle(!!(event as CustomEvent)?.detail?.on);

    listen(hostEl, 'bbc-toggle-fullscreen', toggleHandler as EventListener);
    listen(hostEl, 'bbc-close', () => closeChat());

    listen(wrapper, 'bbc-toggle-fullscreen', toggleHandler as EventListener);
    listen(wrapper, 'bbc-close', () => closeChat());

    const chatEl = options.getChatEl();
    listen(chatEl, 'bbc-toggle-fullscreen', toggleHandler as EventListener);
    listen(chatEl, 'bbc-close', () => closeChat());

    listen(window, 'resize', () => {
      dockLauncherToWindow();
      if (!wrapper.hasAttribute('hidden')) updateDock();
    });

    listen(this.visualViewport(), 'resize', () => {
      if (!wrapper.hasAttribute('hidden')) updateDock();
    });

    listen(this.visualViewport(), 'scroll', () => {
      if (!wrapper.hasAttribute('hidden')) updateDock();
    });

    listen(window, 'beforeunload', () => options.persistOpenStateNow());
    listen(window, 'pagehide', () => options.persistOpenStateNow());
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        options.persistOpenStateNow();
      }
    });

    listen((window as any), 'freeze', () => options.persistOpenStateNow());

    // No auto-reopen from a persisted "was open" flag: a page load or
    // refresh always starts fresh and closed, docked cleanly by the button's
    // real geometry rather than trusting stale state left over from a
    // previous page or session. setOpenFlag()/wasOpenBefore() still track
    // open/closed for whatever else wants to read it, but nothing here acts
    // on it to reopen automatically.
    const afterReady = () => {
      requestAnimationFrame(updateDock);
      setTimeout(updateDock, 0);
    };

    if (options.isUiReady()) afterReady();

    listen(window, 'pageshow', () => {
      if (options.isUiReady() && wrapper.hasAttribute('hidden')) {
        updateDock();
      }
    });

    return {
      open: openChat,
      close: closeChat,
      toggle: toggleChat,
      updateDock,
      refreshPanel,
      destroy: () => {
        stopOpenTouch();
        cancelHoverOpen();

        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }

        // The widget is going away; the page keeps its own z-index and gets
        // its scrolling back. Leaving either behind would outlive the element
        // that set it.
        this.setFullscreen(hostEl, launcher, false);
        this.lockPageScroll(false, wrapper);

        document.documentElement.style.userSelect = '';

        disposers.forEach(dispose => {
          try {
            dispose();
          } catch {}
        });

        disposers.length = 0;
      },
    };
  }
}
