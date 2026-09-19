import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

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
  hasMediaPlayed: () => boolean;
  playVideoWithSoundOnce: () => void;
  armPlayOnFirstClickInside: (wrapperEl: HTMLElement) => void;
  stopLauncherVideo: () => void;

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
   * Sets the button's own size, in pixels, as the `--bbc-launcher-size`
   * CSS custom property that both the launcher's inline template style and
   * dockLauncherToWindow() (via cssVar()) read. Was previously written
   * directly by LauncherComponent onto its host element — moved here so
   * every piece of state this service's position math depends on is
   * written and owned in one place.
   */
  setLauncherSize(hostEl: HTMLElement, px: number | undefined): void {
    const n = px ?? LauncherPositionService.DEFAULT_LAUNCHER_SIZE_PX;
    hostEl.style.setProperty('--bbc-launcher-size', `${n}px`);
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

  safeTop(): number {
    const v = this.visualViewport();
    const offsetTop = v ? Math.round(v.offsetTop) : 0;
    return offsetTop + 8;
  }

  safeBottom(): number {
    return 8;
  }

  lockPageScroll(lock: boolean, wrapper: HTMLElement): void {
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    document.body.style.overflow = lock ? 'hidden' : '';
    wrapper.style.overscrollBehavior = lock ? 'contain' : '';
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
    const safeTop = () => this.safeTop();
    const safeBottom = () => this.safeBottom();

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
      const w = launcher.offsetWidth || pxNum(cssVar('--bbc-launcher-size', 64));
      const h = launcher.offsetHeight || pxNum(cssVar('--bbc-launcher-size', 64));

      launcher.style.position = 'fixed';
      launcher.style.right = `${offset}px`;
      launcher.style.bottom = `${offset}px`;
      launcher.style.left = '';
      launcher.style.top = '';

      // left/top/right/bottom below are informational only (for consumers
      // of the shared LauncherBox, e.g. currentLauncherBox — kept as
      // absolute viewport coordinates, same convention as
      // getBoundingClientRect(), for consistency with the dragged
      // fallback branch below) — nothing here or in positionPanel()
      // positions anything off of them any more; the button's own
      // right/bottom CSS above is the actual, sole source of its position.
      const left = Math.max(0, this.layoutViewportWidth() - w - offset);
      const top = Math.max(0, this.layoutViewportHeight() - h - offset);

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
      const panelHStr = cssVar('--bbc-compact-height', '520px');
      const panelHPx = pxNum(panelHStr);
      const isNarrow = vw() <= 600;

      if (options.getPanelMode() === 'compact') {
        wrapper.classList.remove('bbc-full');

        if (isNarrow) {
          // A genuine compact card on mobile, not a fullscreen takeover:
          // anchored above the launcher button with side margins, and
          // capped to the same --bbc-compact-height used on desktop
          // (shrunk further if the viewport is too short to fit it) —
          // rather than stretching top: all the way to the safe-area top,
          // which is what made this read as fullscreen before.
          const side = pxNum(cssVar('--bbc-side-offset', 12));
          const bottomDock = Math.max(72, Math.round((box.height || 64) + side + 8));
          const panelHPx = pxNum(cssVar('--bbc-compact-height', '520px'));
          const minTop = safeTop() + 8;
          const height = `min(${panelHPx}px, calc(100vh - ${bottomDock + safeBottom()}px - ${minTop}px))`;

          // A size the visitor dragged to wins over the margin layout — but
          // only that. Without the flag this branch ignores the width entirely
          // (auto, between two fixed margins), which is right for a panel
          // nobody has sized and wrong the moment somebody has.
          //
          // Right-anchored rather than left, so it grows towards the middle of
          // the screen from the button's side, matching the desktop branch and
          // keeping the corner the grip is on the corner that moves.
          const sized = wrapper.classList.contains('bbc-sized');
          const width = sized
            ? `min(${pxNum(cssVar('--bbc-compact-width', '360px'))}px, calc(100vw - ${side * 2}px))`
            : 'auto';

          Object.assign(wrapper.style as any, {
            position: 'fixed',
            left: sized ? '' : `${side}px`,
            right: `${side}px`,
            top: '',
            bottom: `${bottomDock + safeBottom()}px`,
            width,
            height,
            maxWidth: 'none',
            zIndex: cssVar('--bbc-z', DEFAULT_Z),
            background: '#fff',
          });

          this.lockPageScroll(false, wrapper);
          return;
        }

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

        this.lockPageScroll(false, wrapper);
        return;
      }

      wrapper.classList.add('bbc-full');

      // Same principle as the compact branch above: expressed as a
      // constant offset from the button's own corner rather than a
      // vh()-derived pixel number, so resizes track the window for free.
      const bottomGap = box.height + PANEL_OFFSET;

      Object.assign(wrapper.style as any, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: `${bottomGap}px`,
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        zIndex: cssVar('--bbc-z', DEFAULT_Z),
        background: '#fff',
      });

      this.lockPageScroll(true, wrapper);
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
    // never binds on <blue-search> — see the header of chat.component.ts).
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

      // On mobile, open straight into full mode — the same view a click on
      // the header's maximize button produces — rather than the bounded
      // compact card, so a mobile visitor never has to tap maximize just to
      // get a usable chat panel. Desktop keeps whatever mode is configured.
      const initialMode = vw() <= 600 ? 'full' : options.getConfiguredMode();
      options.setPanelMode(initialMode);
      syncFullscreenToggleAttr(initialMode === 'full');
      options.setOpenFlag(true);

      startOpenTouch();

      if (options.isVideoEnabled() && !options.hasMediaPlayed()) {
        if (openedByClick) {
          options.playVideoWithSoundOnce();
        } else {
          options.armPlayOnFirstClickInside(wrapper);
        }
      }

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

      this.lockPageScroll(false, wrapper);
      stopOpenTouch();

      options.setOpenFlag(false);
      options.stopLauncherVideo();

      options.getChatEl()?.dispatchEvent(
        new CustomEvent('bbc-closed', {
          bubbles: true,
          composed: true,
        }),
      );
    };

    const toggleChat = (openedByClick = false) => {
      if (!options.isUiReady()) return;

      wrapper.hasAttribute('hidden')
        ? openChat(openedByClick)
        : closeChat();
    };

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
