import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-chat-composer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-composer.component.html',
  styleUrl: './chat-composer.component.css',
})
export class ChatComposerComponent {
  @Input() userMessage = '';
  @Input() isSending = false;
  @Input() sendIconReady?: string;
  @Input() appOrWp: any;
  @Input() t: (key: string) => string = () => '';

  @Output() userMessageChange = new EventEmitter<string>();
  @Output() keydownEvent = new EventEmitter<KeyboardEvent>();
  @Output() inputEvent = new EventEmitter<void>();
  @Output() sendMessage = new EventEmitter<void>();

  @ViewChild('inputRef') inputRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('composerRef') composerRef?: ElementRef<HTMLElement>;

  onMessageChange(value: string) {
    this.userMessage = value;
    this.userMessageChange.emit(value);
  }
}
