// Slim segmented control shown above the composer/input — lets the visitor
// choose whether the next message goes to the model or to a live agent via
// the external chat system (see ChatCoreComponent.chatMode/setChatMode()).
//
// Shared by both widget2 entry points (chat.component's composer and
// embed.component's inline input row) — a plain presentational component
// with no state of its own beyond what its inputs describe, matching
// ChatSuggestionsComponent's convention.
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ChatMode = 'model' | 'chat';

@Component({
  selector: 'app-chat-mode-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-mode-selector.component.html',
  styleUrl: './chat-mode-selector.component.css',
})
export class ChatModeSelectorComponent {
  @Input() mode: ChatMode = 'model';

  /** Human-readable name for the live-agent side — externalChat.name (falls
   *  back to the provider id) — vs. the fixed label for the model side. */
  @Input() agentLabel = 'Live agent';
  @Input() aiLabel = 'AI search';

  @Input() disabled = false;

  @Output() modeChange = new EventEmitter<ChatMode>();

  select(mode: ChatMode) {
    if (this.disabled || this.mode === mode) return;
    this.modeChange.emit(mode);
  }
}
