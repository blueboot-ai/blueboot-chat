import { Injectable, NgZone } from '@angular/core';

export type LauncherPanelMode = 'compact' | 'full';

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
  pushLangToChat: () => void;
};

export type LauncherPositionController = {
  open: (openedByClick?: boolean) => void;
  close: () => void;
  toggle: (openedByClick?: boolean) => void;
  updateDock: () => void;
  destroy: () => void;
};

@Injectable({ providedIn: 'root' })
export class LauncherPositionService {
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
    const vw = () => this.viewportWidth();
    const vh = () => this.viewportHeight();
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

    const updateDock = () => {
      if (wrapper.hasAttribute('hidden')) return;

      const r = getLauncherRect();
      const panelW = cssVar('--bbc-compact-width', '360px');
      const panelHStr = cssVar('--bbc-compact-height', '520px');
      const panelHPx = pxNum(panelHStr);
      const isNarrow = vw() <= 600;

      if (options.getPanelMode() === 'compact') {
        wrapper.classList.remove('bbc-full');

        if (isNarrow) {
          const side = pxNum(cssVar('--bbc-side-offset', 12));
          const bottomDock = Math.max(72, Math.round((r.height || 64) + side + 8));

          Object.assign(wrapper.style as any, {
            position: 'fixed',
            left: `${side}px`,
            right: `${side}px`,
            top: `${safeTop()}px`,
            bottom: `${bottomDock + safeBottom()}px`,
            width: 'auto',
            height: 'auto',
            maxWidth: 'none',
            zIndex: cssVar('--bbc-z', '2147483647'),
            background: '#fff',
          });

          this.lockPageScroll(false, wrapper);
          return;
        }

        const LIFT = pxNum(cssVar('--bbc-floating-lift', 32));
        const right = clamp(vw() - r.left + GAP(), 8, vw() - 8);
        const availBottomSpace = vh() - (r.top + r.height) + PANEL_OFFSET;

        let bottom = clamp(availBottomSpace + LIFT, 8, vh() - 8);

        const minTop = 8;
        const maxBottomForTop = vh() - panelHPx - minTop;

        if (bottom > maxBottomForTop) {
          bottom = Math.max(8, maxBottomForTop);
        }

        const maxAllowedH = Math.max(280, vh() - bottom - minTop);
        const finalH = Math.min(panelHPx, maxAllowedH);

        Object.assign(wrapper.style as any, {
          position: 'fixed',
          right: `${right}px`,
          bottom: `${bottom}px`,
          left: '',
          top: '',
          width: panelW,
          height: `${finalH}px`,
          maxWidth: 'none',
          zIndex: cssVar('--bbc-z', '2147483647'),
          background: '#fff',
        });

        this.lockPageScroll(false, wrapper);
        return;
      }

      wrapper.classList.add('bbc-full');

      const bottomGap = clamp(vh() - r.top, 64, vh());

      Object.assign(wrapper.style as any, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: `${bottomGap}px`,
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        zIndex: cssVar('--bbc-z', '2147483647'),
        background: '#fff',
      });

      this.lockPageScroll(true, wrapper);
    };

    const openChat = (openedByClick = false) => {
      if (!options.isUiReady()) return;

      wrapper.removeAttribute('hidden');
      launcher.setAttribute('aria-expanded', 'true');

      options.setPanelMode(options.getConfiguredMode());
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

      requestAnimationFrame(updateDock);
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

      const cs = getComputedStyle(launcher);
      startRight = pxNum(cs.right || '0');
      startBottom = pxNum(cs.bottom || '0');

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

      const minSide = pxNum(cssVar('--bbc-side-offset', 16));
      const w = launcher.offsetWidth || 64;
      const h = launcher.offsetHeight || 64;

      let nextRight = startRight - dx;
      let nextBottom = startBottom - dy;

      const maxRight = Math.max(minSide, vw() - w - minSide);
      const maxBottom = Math.max(minSide, vh() - h - minSide);

      nextRight = clamp(nextRight, minSide, maxRight);
      nextBottom = clamp(nextBottom, minSide, maxBottom);

      launcher.style.right = `${nextRight}px`;
      launcher.style.bottom = `${nextBottom}px`;

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

      if (!dragging && !movedEnough) {
        toggleChat(true);
      }

      endDrag(e);
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
        updateDock();
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

    const afterReady = () => {
      const tryOpen = () => {
        const shouldOpenNow = options.wasOpenBefore();

        if (shouldOpenNow) openChat(false);
        else updateDock();

        options.pushLangToChat();
      };

      requestAnimationFrame(tryOpen);
      setTimeout(tryOpen, 0);
    };

    if (options.isUiReady()) afterReady();

    listen(window, 'pageshow', () => {
      if (options.isUiReady() && options.wasOpenBefore()) {
        openChat(false);
      }
    });

    return {
      open: openChat,
      close: closeChat,
      toggle: toggleChat,
      updateDock,
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
