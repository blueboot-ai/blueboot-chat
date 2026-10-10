import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * The starter suggestions, shown above the composer while the conversation is
 * empty.
 *
 * Every suggestion is rendered, always. There is no fitting pass and no "More"
 * dialog: the chips are ordinary content inside .history, the panel's own
 * scroll container, alongside the welcome text — a long list scrolls with the
 * welcome text above it, in the same frame, with no extra surface of its own.
 *
 * What this replaced is worth knowing, because it looked reasonable and was
 * not. .chat.empty .history was overflow:hidden, so the one scrollable area was
 * locked shut while suggestions were on screen. With nowhere to put a list too
 * long for the panel, the component measured how many chips fit, hid the rest
 * behind a "More (n)" button, and reopened them in a modal over a scrim. That
 * machinery — a ResizeObserver on the very element the reflow resized, a
 * binary search over chip counts, a lock that could not hold across its own
 * async boundary — oscillated between the full list and the collapsed one,
 * swallowed clicks on chips that were display:none between pointerdown and
 * pointerup, and its scrim dimmed the widget's header. Letting the container
 * scroll costs nothing and removes all of it.
 */
@Component({
  selector: 'app-chat-suggestions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-suggestions.component.html',
  styleUrl: './chat-suggestions.component.css',
})
export class ChatSuggestionsComponent {
  @Input() suggestions: string[] = [];
  @Input() showSuggestions = true;
  @Input() isEmpty = true;
  @Input() isComposing = false;

  @Input() t: (key: string) => string = () => '';

  @Output() applySuggestion = new EventEmitter<string>();

  trackBySuggestion = (_: number, s: string) => s;

  get shouldShowSuggestions(): boolean {
    return !!this.showSuggestions && this.isEmpty && !this.isComposing && !!this.suggestions?.length;
  }

  onApplySuggestion(s: string) {
    this.applySuggestion.emit(s);
  }
}
