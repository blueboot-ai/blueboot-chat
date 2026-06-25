import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FeedbackType, Message } from '../../models/chat-message.model';

@Component({
  selector: 'app-chat-feedback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-feedback.component.html',
  styleUrl: './chat-feedback.component.css',
})
export class ChatFeedbackComponent {
  @Input({ required: true }) message!: Message;
  @Input() t: (key: string) => string = () => '';

  @Output() feedback = new EventEmitter<FeedbackType>();

  onFeedback(type: FeedbackType) {
    this.feedback.emit(type);
  }
}
