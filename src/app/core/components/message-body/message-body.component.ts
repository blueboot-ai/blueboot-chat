// Message contents — the status line and the text — for the embed and the panel.
//
// Renders no wrapper and ships no stylesheet: each surface styles `.msg-info`
// and `.msg-body` from its own CSS. Those rules must live in a ShadowDom
// component's stylesheet (embed.component.css, chat.component.css); putting
// them in chat-message.component.css does not work, because Emulated scoping
// compiles them to `.msg-body[_ngcontent-X]` and this component's elements
// never carry X.
//
// The place for "which elements does this message need" as more kinds arrive.

import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';

import { LinkifyPipe } from '../../services/LinkifyPipe';
import { EmojiPipe } from '../../services/EmojiPipe';
import { AttachmentListComponent } from '../attachment-list/attachment-list.component';
import { Message } from '../../models/chat-message.model';

@Component({
  selector: 'bb-message-body',
  standalone: true,
  imports: [CommonModule, MarkdownComponent, LinkifyPipe, EmojiPipe, AttachmentListComponent],
  templateUrl: './message-body.component.html',
})
export class MessageBodyComponent {
  @Input({ required: true }) message!: Message;

  /** How message content is rendered. 'linkify' is the plain-text path. */
  @Input() render: 'markdown' | 'linkify' = 'markdown';

  /** Passed through to the attachment rows for their type labels. */
  @Input() t: (key: string) => string = () => '';

  /**
   * Status line shows only until content arrives to replace it.
   *
   * Suppressed when the message carries attachments: there, `info` holds the
   * upload's failure reason, and the attachment row already shows it against
   * the file it belongs to. Without this the same sentence appears twice, once
   * detached from the thing it is about.
   */
  get showInfo(): boolean {
    return !this.message?.content
      && !!this.message?.info
      && !this.message?.attachments?.length;
  }
}
