import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-header.component.html',
  styleUrl: './chat-header.component.css',
})
export class ChatHeaderComponent {
  @Input() mode: 'compact' | 'full' = 'compact';

  @Input() title = 'Assistant';
  @Input() displayName?: string;

  @Input() logo?: string;
  @Input() logoAlt?: string;
  @Input() logoVisible = true;

  @Input() headerIsRound = true;
  @Input() headerLogoBg?: string;
  @Input() headerLogoInitialLocal = true;
  @Input() headerBg?: string | null;

  @Input() t: (key: string) => string = () => '';

  @Output() toggleFullscreen = new EventEmitter<HTMLButtonElement>();
  @Output() close = new EventEmitter<void>();
  @Output() newChat = new EventEmitter<void>();
  @Output() logoError = new EventEmitter<void>();

  get titleText(): string {
    return this.title || this.displayName || 'Assistant';
  }

  onToggleFullscreen(btn: HTMLButtonElement) {
    this.toggleFullscreen.emit(btn);
  }
}
