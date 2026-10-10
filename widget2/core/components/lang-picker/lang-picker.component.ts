// A language selector for the composer's tools ruler — a globe that opens a
// list of every language the widget ships.
//
// Presentational and stateless beyond "am I open": it emits a language code and
// nothing else. Acting on that code is chat-core's job, because switching
// language re-seeds the string packs and re-runs buildConfig — see
// applyVisitorLang(). Same division as EmojiPickerComponent and
// ChatModeSelectorComponent, which report a choice and leave the consequences
// to the component above.
//
// It is the only language control there is. There used to be an offer banner
// beside it, guessing from the visitor's IP; that is gone with the IP lookup
// itself, and the starting language is now resolved once from
// preferredLang → browser → defaultlang → "en" (resolvePreferredLang in
// shared-library/models/lang-detect). Nothing asks the visitor anything — this
// is where they say so if the resolution was wrong.
//
// Shared by both widget surfaces (the panel's composer and the embed's inline
// input row), so it ships its own stylesheet rather than relying on either
// surface to style it.

import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

import { DEFAULT_UI_TRANSLATIONS } from '../../i18n/ui-strings';
import { langEndonym } from '../../../shared/languages';

export type LangOption = { code: string; label: string };

/** Viewport-coordinate padding box of the element that clips us. */
type ClipBox = { left: number; top: number; width: number; height: number };

/**
 * The box, in viewport coordinates, of the nearest ancestor that clips its
 * overflow — crossing shadow boundaries on the way up. Null when nothing up
 * the tree clips.
 *
 * This is the one thing the panel cannot get from CSS. The widget frame is
 * `overflow: hidden` on both surfaces (.embed-card in the embed, app-chat's
 * :host inside the launcher's #bbc-wrapper in the panel) and a z-index does
 * not leave a clip. Which element clips, and where its edges are, depends on
 * the surface and on how tall the conversation happens to be — so the frame
 * the panel has to fit inside is a runtime measurement, not a stylesheet
 * value.
 */
function clipRectOf(el: HTMLElement): ClipBox | null {
  let node: Node | null = el.parentNode;

  while (node) {
    if (node instanceof HTMLElement) {
      const s = getComputedStyle(node);

      if (s.overflowY !== 'visible' || s.overflowX !== 'visible') {
        // The padding box, not the border box: that is where overflow is
        // clipped, so on an element with a border the border box would be a
        // few px too big in each direction and the panel cut by that much.
        const r = node.getBoundingClientRect();
        const bl = parseFloat(s.borderLeftWidth) || 0;
        const bt = parseFloat(s.borderTopWidth) || 0;
        const br = parseFloat(s.borderRightWidth) || 0;
        const bb = parseFloat(s.borderBottomWidth) || 0;

        return {
          left: r.left + bl,
          top: r.top + bt,
          width: r.width - bl - br,
          height: r.height - bt - bb,
        };
      }

      node = node.parentNode;
      continue;
    }

    // A shadow root has no box of its own; step to the element hosting it.
    const host = (node as ShadowRoot).host;
    node = host ?? node.parentNode;
  }

  return null;
}

@Component({
  selector: 'app-lang-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lang-picker.component.html',
  styleUrl: './lang-picker.component.css',
})
export class LangPickerComponent {
  /** Localized label lookup, passed down like every other widget component. */
  @Input() t: (key: string) => string = () => '';

  @Input() disabled = false;

  /** The language being rendered now, so the list can mark it. */
  @Input() current = '';

  @Output() picked = new EventEmitter<string>();

  /**
   * Every language the widget has a pack for, named in itself.
   *
   * Read from the packs rather than from a second list, so a language added to
   * ui-strings.ts appears here without anyone remembering to. Sorted by the
   * name as displayed, which is the order someone scanning the list expects —
   * not by code, which would put Danish under "da" between Chinese and German.
   */
  readonly options: LangOption[] = Object.keys(DEFAULT_UI_TRANSLATIONS)
    .map(code => ({ code, label: langEndonym(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  open = false;

  @ViewChild('panel') private panelRef?: ElementRef<HTMLElement>;

  /**
   * The frame's size, and the shift from where CSS put the panel to where the
   * frame is. Null until measured.
   *
   * All four are set or none are: `covering` keys off the width, and while it
   * is false the stylesheet's plain drop-down stands — which is the right
   * shape in the one case measuring cannot serve, where nothing up the tree
   * clips and so nothing would be cut anyway.
   */
  protected coverW: number | null = null;
  protected coverH: number | null = null;
  private coverDx = 0;
  private coverDy = 0;

  protected get covering(): boolean {
    return this.coverW !== null;
  }

  protected get coverTransform(): string | null {
    return this.covering ? `translate(${this.coverDx}px, ${this.coverDy}px)` : null;
  }

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  toggle(): void {
    if (this.disabled) return;

    this.open = !this.open;
    this.clearCover();

    // Measured after the panel exists and has been laid out, not here: its own
    // rect is one of the two, and it has no box until *ngIf has rendered it.
    // Angular patches rAF, so the write is seen.
    if (this.open) requestAnimationFrame(() => this.fitToFrame());
  }

  close(): void {
    this.open = false;
    this.clearCover();
  }

  /**
   * Lay the panel over the whole widget frame.
   *
   * The panel cannot get out of the frame — .embed-card and app-chat's :host
   * are both overflow:hidden, and neither a z-index nor a stacking context
   * leaves a clip — so instead of hanging below the header and being cut at
   * the bottom edge, it becomes the frame: every pixel the widget has, and
   * never one more. That is the most room available anywhere, and where it is
   * still not enough for eighteen names the grid scrolls inside it (see
   * .lp-panel.cover .lp-scroll).
   *
   * A transform rather than inset values, because the containing block here is
   * whichever header the picker was dropped into — the shift is measured
   * against the panel's own laid-out position, so it needs no assumption about
   * which element that is or where its edges sit.
   */
  private fitToFrame(): void {
    const panel = this.panelRef?.nativeElement;
    if (!panel) return;

    const frame = clipRectOf(panel);
    if (!frame) return;

    // Untransformed: clearCover() ran before this, and a stale transform would
    // be measured into the new offset and applied twice.
    const own = panel.getBoundingClientRect();

    this.coverDx = Math.round(frame.left - own.left);
    this.coverDy = Math.round(frame.top - own.top);
    this.coverW = Math.round(frame.width);
    this.coverH = Math.round(frame.height);
  }

  private clearCover(): void {
    this.coverW = null;
    this.coverH = null;
    this.coverDx = 0;
    this.coverDy = 0;
  }

  /**
   * The measured geometry is a snapshot, and the frame moves: the embed panel
   * is resizable, and on a phone it is the viewport. Re-measure rather than
   * close — a visitor mid-choice should not lose the list because the keyboard
   * appeared.
   */
  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.open) return;

    this.clearCover();
    requestAnimationFrame(() => this.fitToFrame());
  }

  choose(code: string): void {
    this.close();

    // Emitted even when it is the language already showing.
    //
    // It looks like a no-op and is not: picking the language already showing is
    // a visitor stating a preference, and the host writes it to preferredLang.
    // Without that the next page resolves from the browser again, so a visitor
    // whose browser asks for something else is back where they started every
    // time they navigate.
    //
    // The host is where that belongs, so this reports the click and lets
    // chooseLang() decide what is worth re-deriving.
    this.picked.emit(code);
  }

  /**
   * Close when the click lands outside this component.
   *
   * Bound on the host rather than on document via addEventListener, so Angular
   * removes it with the component.
   *
   * The widget renders in shadow DOM, where an outside click is retargeted to
   * the shadow host, so `composedPath()` is the check that actually works here.
   */
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    if (!this.open) return;

    const path = (event as any).composedPath?.() as EventTarget[] | undefined;
    const inside = path
      ? path.includes(this.host.nativeElement)
      : this.host.nativeElement.contains(event.target as Node);

    if (!inside) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  trackByCode = (_: number, o: LangOption) => o.code;
}
