// The row of example questions under an empty composer.
//
// Extracted from embed.component.html, where it was inline markup plus two
// handlers on the core. A container, not a feature: it renders the strings it
// is given and emits the one that was picked. Whether there are any, when they
// should be offered, and what happens on a pick all stay with the conversation.
//
// Deliberately NOT chat/components/chat-suggestions, which is the panel's. That
// one measures how many chips fit its own composer and takes composerEl and
// historyEl references to do it — layout knowledge specific to the panel that
// this surface has no use for. Sharing it would mean either the embed passing
// nulls for inputs it cannot supply, or the component growing a branch per
// surface. Two small components with one job each beat one component with a
// mode switch.

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-suggestion-chips',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './suggestion-chips.component.html',
  styleUrl: './suggestion-chips.component.css',
})
export class SuggestionChipsComponent {
  @Input() suggestions: string[] = [];

  /** Localized label lookup, passed down like every other widget component. */
  @Input() t: (key: string) => string = () => '';

  @Input() disabled = false;

  /**
   * How many to show at once. 0 or absent means all of them.
   *
   * Config-driven rather than measured: the embed sits at whatever width a
   * customer's page gives it, so "how many fit" is not a question this can
   * answer from the inside without a resize observer. A configured cap is
   * predictable, and an admin who wants fewer chips gets fewer chips.
   */
  @Input() maxVisible = 0;

  @Output() picked = new EventEmitter<string>();

  /**
   * Pressed, before the click.
   *
   * The composer hides the strip when its input loses focus, and pressing a
   * chip blurs the input — so without something on pointer-down the row is
   * gone before the click it was about to receive lands. The host uses this to
   * hold the strip open across that gap.
   */
  @Output() pressed = new EventEmitter<void>();

  get visible(): string[] {
    const all = this.suggestions ?? [];
    return this.maxVisible > 0 ? all.slice(0, this.maxVisible) : all;
  }

  /** Nothing to show is not an empty row — it is no row. */
  get hasAny(): boolean {
    return this.visible.length > 0;
  }

  onPress(): void {
    this.pressed.emit();
  }

  onPick(text: string): void {
    if (this.disabled) return;
    this.picked.emit(text);
  }

  /** The strings are the identity here — there is no id to track by. */
  trackBySuggestion = (_: number, s: string) => s;
}
