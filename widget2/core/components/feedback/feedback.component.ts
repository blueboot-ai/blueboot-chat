import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FeedbackType, Message } from '../../models/chat-message.model';

/**
 * The three-button "was this helpful?" row under an assistant message.
 *
 * Was chat/components/chat-feedback, used by the panel, while the embed carried
 * a hand-written copy of the same markup — identical button for button, with a
 * duplicate set of styles in embed.component.css to match. Both are gone: the
 * shared message component renders this, so both surfaces get the same row.
 *
 * Moved into core with that change. It lived under the panel's folder while the
 * panel was its only caller; a component in core importing one out of chat/ is
 * the dependency pointing the wrong way.
 *
 * Emits the bare type. Which message it was about is the caller's context, not
 * this component's — see MessageComponent.onFeedback, which pairs the two.
 */
@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback.component.html',
  styleUrl: './feedback.component.css',
})
export class FeedbackComponent {
  @Input({ required: true }) message!: Message;
  @Input() t: (key: string) => string = () => '';

  @Output() feedback = new EventEmitter<FeedbackType>();

  onFeedback(type: FeedbackType) {
    this.feedback.emit(type);
  }
}
