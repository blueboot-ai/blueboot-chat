// A small emoji picker for the composer — a button that opens a grid.
//
// Presentational and stateless beyond "am I open": it emits the chosen
// character and nothing else. Inserting it into the input is the composer's
// job, because only the composer holds the textarea and knows where the caret
// is. Same division as ChatModeSelectorComponent, which reports a choice and
// leaves acting on it to the component above.
//
// Shared by both widget surfaces (the panel's composer and the embed's inline
// input row), so it ships its own stylesheet rather than relying on either
// surface to style it.

import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

import { EMOJI_PICKER_GROUPS, EmojiGroup } from '../../services/emoji-shortcodes';

@Component({
  selector: 'app-emoji-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './emoji-picker.component.html',
  styleUrl: './emoji-picker.component.css',
})
export class EmojiPickerComponent {
  /** Localized label lookup, passed down like every other widget component. */
  @Input() t: (key: string) => string = () => '';

  @Input() disabled = false;

  @Output() picked = new EventEmitter<string>();

  /** The same curated set the feed renders, grouped — see emoji-shortcodes.ts. */
  readonly groups: ReadonlyArray<EmojiGroup> = EMOJI_PICKER_GROUPS;

  open = false;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  toggle(): void {
    if (this.disabled) return;
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  choose(char: string): void {
    this.picked.emit(char);
    // Closed on pick: in a widget this narrow the panel covers the
    // conversation, and someone who wants a second emoji can open it again.
    // Leaving it up hides the very message they are composing.
    this.close();
  }

  /**
   * Close when the click lands outside this component.
   *
   * Bound on the host rather than on document via addEventListener, so Angular
   * removes it with the component — the widget has had enough listeners that
   * outlive what registered them.
   *
   * The widget renders in shadow DOM, where an outside click is retargeted to
   * the shadow host, so `contains()` on a composed path element is the check
   * that actually works here.
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

  /** Section heading, falling back to English when a pack lacks the key. */
  groupLabel(key: string): string {
    const label = EMOJI_GROUP_LABELS[key];
    if (!label) return key;

    return (this.t(label.key) || '').trim() || label.en;
  }

  trackByName = (_: number, e: { name: string }) => e.name;
  trackByKey = (_: number, g: EmojiGroup) => g.key;
}

/**
 * i18n key and English fallback per group.
 *
 * Flat camelCase keys, because t() is a plain lookup in the pack's `chrome`
 * map — a dotted `emojiGroup.smileys` would have to exist verbatim as a key,
 * which is not how the rest of the widget's strings are named.
 */
const EMOJI_GROUP_LABELS: Record<string, { key: string; en: string }> = {
  smileys: { key: 'emojiGroupSmileys', en: 'Smileys & emotion' },
  people: { key: 'emojiGroupPeople', en: 'People & body' },
  nature: { key: 'emojiGroupNature', en: 'Animals & nature' },
  food: { key: 'emojiGroupFood', en: 'Food & drink' },
  travel: { key: 'emojiGroupTravel', en: 'Travel & places' },
  activities: { key: 'emojiGroupActivities', en: 'Activities' },
  objects: { key: 'emojiGroupObjects', en: 'Objects' },
  // No `flags` group: country flags are excluded at generation time because
  // Windows draws them as boxed letters — see isUndrawableFlag() in
  // gen-emoji.js. The generic flags that do render live under Symbols.
  symbols: { key: 'emojiGroupSymbols', en: 'Symbols' },
};
