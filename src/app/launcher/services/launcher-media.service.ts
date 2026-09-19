import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LauncherMediaService {
  private readonly mediaPlayedWindowKey = '__BB_LAUNCHER_MEDIA_PLAYED__';

  isIOS(): boolean {
    const ua = navigator.userAgent || '';
    const iOS = /iPhone|iPad|iPod/i.test(ua);
    const iPadOS = /Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1;

    return iOS || iPadOS;
  }

  get mediaAlreadyPlayedThisPage(): boolean {
    return !!(window as any)[this.mediaPlayedWindowKey];
  }

  set mediaAlreadyPlayedThisPage(v: boolean) {
    (window as any)[this.mediaPlayedWindowKey] = !!v;
  }

  /** Passes an already-resolved src through as-is (data:/blob: or absolute
   *  URL). There is no CDN assets base to resolve a relative path against any
   *  more — callers are expected to supply a usable src or nothing at all. */
  normalizeSrc(input: string | undefined): string {
    return (input || '').trim();
  }

  stopVideo(video?: HTMLVideoElement): void {
    if (!video) return;

    try {
      video.pause();
    } catch {}
  }

  /**
   * Forces a decoded, paintable frame onto a <video> that has never played.
   *
   * Named for where this was first needed — iOS Safari does not paint
   * anything for a <video> until playback has actually started at least
   * once, even after 'loadeddata'/'canplay' report a frame is available —
   * but the same is true of desktop Safari (same WebKit engine, same
   * quirk), and calling this on a browser that does not need it (Chrome,
   * Firefox) is harmless: play()+immediate pause() on an already-muted
   * video is silent and over in a frame or two. So this runs unconditionally
   * for every platform rather than being gated to iOS specifically — the
   * launcher used to only call this on iOS, which left the closed bubble's
   * video invisible on desktop Safari until the visitor opened the chat
   * (the click handler there calls .play() for real, which is what first
   * painted a frame).
   */
  primeVideoFrameOnce(video: HTMLVideoElement | undefined, onFallback?: () => void): void {
    if (!video) return;

    const tryPaint = () => {
      try {
        video.muted = true;
        video.setAttribute('muted', '');
        video.volume = 0;

        const p = video.play();

        if (p && typeof (p as any).then === 'function') {
          (p as any)
            .then(() => {
              requestAnimationFrame(() => {
                try {
                  video.pause();

                  try {
                    video.currentTime = 0;
                  } catch {}
                } catch {}
              });
            })
            .catch(() => {});
        }
      } catch {}
    };

    tryPaint();

    video.addEventListener('loadeddata', tryPaint, { once: true });
    video.addEventListener('canplay', tryPaint, { once: true });

    setTimeout(() => {
      const ready = video.readyState || 0;
      if (ready < 2 && onFallback) onFallback();
    }, 2000);
  }

  playVideoWithSoundOnce(video?: HTMLVideoElement): boolean {
    if (!video) return false;
    if (this.mediaAlreadyPlayedThisPage) return false;

    try {
      video.pause();
      video.currentTime = 0;
    } catch {}

    video.muted = false;
    video.volume = 1;

    const p = video.play();

    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch(() => {});
    }

    this.mediaAlreadyPlayedThisPage = true;

    return true;
  }
}
