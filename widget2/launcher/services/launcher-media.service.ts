import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LauncherMediaService {
  // mediaAlreadyPlayedThisPage and its window key are gone with the
  // play-once-with-sound rule they served. Sound is no longer a one-shot event
  // to be remembered across the page — it is a state that follows the cursor,
  // and the only thing that plays once is the clip itself, which the released
  // blob already enforces.


  // isIOS() is gone with its only caller. It existed to decide whether the
  // launcher video got an autoplay attribute; the video now carries one on
  // every platform (see launcher.component.html), and no other decision here
  // turns on the operating system. The widget2 copy is the one that was
  // removed — widget/ keeps its own, unchanged.

  /** Passes an already-resolved src through as-is (data:/blob: or absolute
   *  URL). There is no CDN assets base to resolve a relative path against any
   *  more — callers are expected to supply a usable src or nothing at all. */
  normalizeSrc(input: string | undefined): string {
    return (input || '').trim();
  }

  // stopVideo() and isPlaying() are gone. Pausing is one line and belongs with
  // the rest of the hover state in hoverVideo(); the playing check existed for
  // a click-to-stop rule the hover strategy removed.

  // primeVideoFrameOnce() is gone with its caller. It forced a muted
  // play()/pause() so WebKit would composite a first frame for a video that
  // had never played — necessary while the clip autoplayed, pointless now that
  // a hover plays it, and actively wrong once it was re-muting a clip the
  // cursor had unmuted.

  /**
   * Turn the clip's sound on or off while it is running.
   *
   * The launcher plays muted — every browser requires that of an autoplaying
   * video — and the sound follows the cursor: on while it is over the button,
   * off the moment it leaves. That is why this is a toggle rather than a
   * play-with-sound: the clip's playback is not the visitor's decision, only
   * whether they hear it.
   *
   * UNMUTING NEEDS A PRIOR INTERACTION, and that is not a detail to leave to
   * chance. A video that began as muted autoplay and is unmuted with no user
   * activation anywhere on the page is PAUSED by Chrome — the visitor would
   * hover and the picture would stop. Hovering is not activation; a click
   * anywhere earlier is, and it stays true for the life of the page.
   *
   * So: sound only once the page has been interacted with at all. Before
   * that, the hover does nothing and the clip keeps playing silently, which is
   * the outcome the policy is asking for anyway.
   */
  setVideoSound(video: HTMLVideoElement | undefined, on: boolean): void {
    if (!video) return;

    try {
      if (!on) {
        video.muted = true;
        return;
      }

      if (!this.pageHasActivation()) return;

      video.muted = false;
      video.volume = 1;
    } catch {}
  }

  /**
   * Has the visitor interacted with this page at all?
   *
   * navigator.userActivation where it exists (Chromium), which is the browser's
   * own answer to exactly this question. Safari and Firefox do not have it —
   * there the fallback is our own flag, set by the first pointer or key event
   * seen anywhere in the document.
   *
   * The fallback is deliberately the CONSERVATIVE direction: no interaction
   * recorded means no unmute. Guessing the other way is what pauses a video
   * under the cursor.
   */
  private pageHasActivation(): boolean {
    const ua = (navigator as any)?.userActivation;
    if (ua && typeof ua.hasBeenActive === 'boolean') return ua.hasBeenActive;

    return this.sawInteraction;
  }

  private sawInteraction = false;

  constructor() {
    // Capture phase, once, and passive: this only records that something
    // happened and must never delay or interfere with the event itself.
    const seen = () => { this.sawInteraction = true; };

    try {
      document.addEventListener('pointerdown', seen, { capture: true, once: true, passive: true });
      document.addEventListener('keydown', seen, { capture: true, once: true, passive: true });
    } catch {}
  }
}
