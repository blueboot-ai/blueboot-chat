import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';

import { LinkifyPipe } from '../../../services/LinkifyPipe';
import { FeedbackType, Message, Role } from '../../models/chat-message.model';
import { ChatFeedbackComponent } from '../chat-feedback/chat-feedback.component';

@Component({
  selector: 'app-chat-message',
  standalone: true,
  imports: [
    CommonModule,
    MarkdownComponent,
    LinkifyPipe,
    ChatFeedbackComponent,
  ],
  templateUrl: './chat-message.component.html',
  styleUrl: './chat-message.component.css',
})
export class ChatMessageComponent {
  @Input({ required: true }) message!: Message;
  @Input({ required: true }) index!: number;

  @Input() render: 'markdown' | 'linkify' = 'markdown';
  @Input() feedbackEnabled = true;
  @Input() copiedIndex: number | null = null;

  @Input() t: (key: string) => string = () => '';
  @Input() labelFor: (role: Role) => string = () => '';
  @Input() avatarSrc: (role: Role) => string | undefined = () => undefined;
  @Input() avatarBgFor: (role: Role) => string | undefined = () => undefined;

  @Output() copy = new EventEmitter<{ content: string; index: number }>();
  @Output() feedback = new EventEmitter<{ message: Message; type: FeedbackType }>();

  onCopy() {
    this.copy.emit({
      content: this.message.content || '',
      index: this.index,
    });
  }

  onFeedback(type: FeedbackType) {
    this.feedback.emit({
      message: this.message,
      type,
    });
  }
}
