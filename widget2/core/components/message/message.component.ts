import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { Message, Role, FeedbackType } from '../../models/chat-message.model';
import { MessageBodyComponent } from '../message-body/message-body.component';
import { ContactFormComponent } from '../contact-form/contact-form.component';
import { FeedbackComponent } from '../feedback/feedback.component';

/**
 * One message in the conversation, shared by both surfaces.
 *
 * There were two: ChatMessageComponent for the panel and an inline block in
 * embed.component.html. Same message, same handlers — every one of them already
 * lives on ChatCoreComponent — rendered by two sets of markup and two sets of
 * CSS that had drifted into different bubbles, different labels, a pill in one
 * and an arrow in the other, and a feedback row that existed twice in identical
 * form.
 *
 * This is the embed's version. The panel therefore loses its bubble borders and
 * its separately-tinted visitor bubble, and gains the in-flight spinner.
 *
 * It renders and nothing else. What a copy or a feedback click *does* stays on
 * the host, which is where the conversation is — hence the function inputs
 * below: they are ChatCoreComponent's own methods, handed in rather than
 * reimplemented.
 */
@Component({
  selector: 'app-message',
  standalone: true,
  imports: [
    CommonModule,
    MessageBodyComponent,
    ContactFormComponent,
    FeedbackComponent,
  ],
  templateUrl: './message.component.html',
  styleUrl: './message.component.css',
})
export class MessageComponent {
  @Input({ required: true }) message!: Message;

  /** Position in the feed. Only the copy button reads it, to tell "this one was
   *  just copied" from "some message was". */
  @Input({ required: true }) index!: number;

  @Input() render: 'markdown' | 'linkify' = 'markdown';
  @Input() t: (key: string) => string = () => '';

  /** Which message is showing its copied tick, or null. */
  @Input() copiedIndex: number | null = null;

  /** Contact details the visitor has already given, for the contact form. */
  @Input() remembered?: any;

  /**
   * Whether the feedback row belongs on this message.
   *
   * Decided by the host, not here. The two surfaces resolved it differently —
   * the panel off a plain @Input, the embed through
   * `appOrWp?.feedbackEnabled ?? this.feedbackEnabled` — and the embed's is the
   * correct one, because an app that turned feedback off means it. Passing the
   * answer in rather than the ingredients keeps that single rule on
   * ChatCoreComponent.feedbackVisibleFor.
   */
  @Input() feedbackVisible = false;

  // ---- The host's own methods, handed in ----------------------------------
  //
  // Functions rather than resolved strings because each is per-message and
  // per-language, and recomputing them in the host template for every field of
  // every message is what these replaced.

  @Input() labelFor: (m: Message) => string = () => '';
  @Input() sentViaLabel: (m: Message) => string = () => '';
  @Input() sendStatusLabel: (m: Message) => string = () => '';
  @Input() receivedLabel: (m: Message) => string = () => '';
  @Input() isSendingMessage: (m: Message) => boolean = () => false;

  /**
   * The avatar, and whether there is one at all.
   *
   * Panel-only, and kept as a switch rather than dropped with the rest of the
   * panel's styling: the images are configured per role in widgetParams, so
   * removing them would take a feature away from apps that set them. The embed
   * passes nothing and gets no avatar column, which is what it has always
   * looked like.
   *
   * An unset avatar for a role means no avatar — not a placeholder circle. See
   * resolveAvatarUrls() in chat-widget-config.functions.ts, which applies the
   * same rule to the source.
   */
  @Input() showAvatar = false;
  @Input() avatarSrc: (role: Role) => string | undefined = () => undefined;
  @Input() avatarBgFor: (role: Role) => string | undefined = () => undefined;

  @Output() copy = new EventEmitter<{ content: string; index: number }>();
  @Output() feedback = new EventEmitter<{ message: Message; type: FeedbackType }>();

  @Output() contactSubmitted = new EventEmitter<{ message: Message; values: any }>();
  @Output() contactSkipped = new EventEmitter<{ message: Message }>();
  @Output() contactCancelled = new EventEmitter<{ message: Message }>();
  @Output() contactCleared = new EventEmitter<{ message: Message }>();

  /**
   * Set once this message's avatar image fails to load, to hide the circle.
   *
   * Per message rather than per role, which is slightly wasteful — the same
   * broken URL fails again on the next message — but it keeps the failure
   * where the <img> is. Nothing resets it: a src that 404'd once will 404
   * again, and retrying on every change-detection pass would be a request
   * loop rather than a recovery.
   */
  avatarFailed = false;

  /** The avatar to draw, or nothing. Both conditions in one place so the
   *  template does not ask twice. */
  get avatar(): string | undefined {
    return this.showAvatar ? this.avatarSrc(this.message.role) : undefined;
  }

  /** The toolbar carries only the copy button, so it rides on the same
   *  condition: an assistant message with something worth copying. */
  get toolbarVisible(): boolean {
    return this.message.role === 'assistant'
        && !!(this.message.content || this.message.info);
  }

  get copied(): boolean {
    return this.copiedIndex === this.index;
  }

  onCopy(): void {
    this.copy.emit({ content: this.message.content || '', index: this.index });
  }

  /**
   * app-chat-feedback emits the bare type; the host wants to know which message
   * it was about. Pairing the two is this component's job — it is the one that
   * knows, and the alternative is passing the message down only to have it
   * handed straight back.
   */
  onFeedback(type: FeedbackType): void {
    this.feedback.emit({ message: this.message, type });
  }
}
