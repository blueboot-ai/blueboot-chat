import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LauncherMediaService {
  readonly transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

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

  normalizeSrc(input: string | undefined, assetsBase: string, fallbackFile?: string): string {
    const val = (input || '').trim();

    if (!val) {
      if (!fallbackFile) return '';

      const endsWithImg = assetsBase.endsWith('img/');
      const file = endsWithImg
        ? fallbackFile.replace(/^\/?img\//, '')
        : fallbackFile.startsWith('img/')
          ? fallbackFile
          : `img/${fallbackFile}`;

      return this.joinAsset(assetsBase, file);
    }

    if (/^(data:|blob:)/i.test(val)) return val;

    const isAbs = /^([a-z]+:)?\/\//i.test(val) || val.startsWith('/');
    return isAbs ? val : this.joinAsset(assetsBase, val);
  }

  joinAsset(base: string, rel: string): string {
    let b = base.replace(/\\/g, '/');
    let r = rel.replace(/\\/g, '/').replace(/^\/+/, '');

    if (b.endsWith('img/') && r.startsWith('img/')) r = r.slice(4);
    if (r.startsWith('assets/')) r = r.slice(7);

    return b + r;
  }

  stopVideo(video?: HTMLVideoElement): void {
    if (!video) return;

    try {
      video.pause();
    } catch {}
  }

  primeIOSFrameOnce(video: HTMLVideoElement | undefined, onFallback?: () => void): void {
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
