import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ChatModeSelectorComponent, ChatMode } from '../chat-mode-selector/chat-mode-selector.component';
import { EmojiPickerComponent } from '../emoji-picker/emoji-picker.component';
import { InputFunctionsComponent } from '../input-functions/input-functions.component';
import {
  AttachmentUploadComponent,
  AttachmentLimits,
  PickedAttachment,
} from '../attachment-upload/attachment-upload.component';
import { insertAtCaret } from '../../services/caret-insert';
import { filesOnClipboard } from '../../services/clipboard-files';

/**
 * The message box, shared by both surfaces.
 *
 * There used to be two: ChatComposerComponent for the panel and inline markup
 * in embed.component.html for the embed. They were the same three rows — mode
 * selector, input frame, tools ruler — drifting apart in every detail that was
 * only ever fixed on one side: the embed grew em-based sizing that scales with
 * fontSize, the iOS 16px zoom floor, the "?" help button and the attribution on
 * the ruler; the panel kept fixed pixels and a separate attribution row.
 *
 * This is the embed's version, which was the further along of the two. The
 * panel therefore gains the help button and moves its attribution onto the
 * ruler.
 *
 * It holds markup and the two things that only make sense next to the caret
 * (paste, and emoji insertion at the cursor). Everything about the conversation
 * — what a message does, whether there is one, which mode this is — belongs to
 * the host and arrives as an input.
 */
@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ChatModeSelectorComponent,
    EmojiPickerComponent,
    InputFunctionsComponent,
    AttachmentUploadComponent,
  ],
  templateUrl: './composer.component.html',
  styleUrl: './composer.component.css',
})
export class ComposerComponent {
  @Input() userMessage = '';
  @Input() isSending = false;
  @Input() t: (key: string) => string = () => '';

  /** Shown while the box is empty — the welcome line, on the surfaces that have
   *  one. Empty once there is a conversation. */
  @Input() placeholder = '';

  /** The product's mark, for the send button. Fixed and compiled in — see
   *  sendIconFor in core/assets/default-logo. */
  @Input() sendIconReady?: string;

  /** The chat-mode ruler above the input — only when the GPT has direct chat
   *  configured. See ChatCoreComponent.chatModeSelectorVisible. */
  @Input() chatModeVisible = false;
  @Input() chatMode: ChatMode = 'model';
  @Input() chatModeAiLabel = 'AI search';
  @Input() chatModeAgentLabel = 'Live agent';

  /** Upload limits off the app config — see ChatCoreComponent.chatLimits. */
  @Input() chatLimits?: AttachmentLimits;

  /** How many attachments this message already carries, so the per-request cap
   *  is enforced before a file is taken. It matters more for a paste than for
   *  the picker: one paste can carry several images. */
  @Input() attachedCount = 0;

  /**
   * The widget is at rest — nothing said, nothing typed, nothing attached.
   *
   * Passed in rather than worked out here: `attachedCount` alone cannot tell an
   * untouched widget from one where the visitor has already typed. The rule
   * lives with the state, on ChatCoreComponent.isNeutral.
   */
  @Input() isNeutral = false;

  /** No conversation yet. Only the attribution reads it: at rest the ruler has
   *  nothing to sit beside, and a lone credit line under an empty box reads as
   *  the widget's purpose rather than its footer. */
  @Input() isEmpty = true;

  /** Live chat only — there is nobody on the other end in model mode for the
   *  details to reach. See ChatCoreComponent.contactEditVisible. */
  @Input() contactEditVisible = false;

  /** How tall the box may grow. The embed was fixed at one line (nowrap, capped
   *  at the line height); both surfaces now grow, because a visitor cannot
   *  check a question they cannot see. */
  @Input() maxHeightPx = 420;

  @Output() userMessageChange = new EventEmitter<string>();
  @Output() keydownEvent = new EventEmitter<KeyboardEvent>();
  @Output() inputEvent = new EventEmitter<void>();
  @Output() focusEvent = new EventEmitter<void>();
  @Output() blurEvent = new EventEmitter<void>();
  @Output() sendMessage = new EventEmitter<void>();
  @Output() chatModeChange = new EventEmitter<ChatMode>();

  /** A file the visitor chose on the ruler. Relayed straight up: this holds the
   *  input, but what happens to an attachment is the host's call. */
  @Output() attachmentPicked = new EventEmitter<PickedAttachment>();

  /** One or more files were pasted and taken. Fired after the `picked` events,
   *  so the host already holds them by the time it reacts. */
  @Output() attachmentsPasted = new EventEmitter<void>();

  /** The "?" — the only thing a first-time visitor can act on before typing. */
  @Output() helpRequested = new EventEmitter<void>();

  @Output() contactEditRequested = new EventEmitter<void>();

  @ViewChild('inputRef') inputRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('composerRef') composerRef?: ElementRef<HTMLElement>;

  /** The attach control, so a paste goes through the same validation the picker
   *  uses rather than a second copy of it. */
  @ViewChild(AttachmentUploadComponent) private attachmentUpload?: AttachmentUploadComponent;

  /**
   * A file pasted into the message box becomes an attachment — a screenshot, or
   * a document copied in the file manager.
   *
   * preventDefault() only once a file has actually been taken: copying from a
   * web page puts an image AND the surrounding HTML on the clipboard, so
   * suppressing every paste would break pasting text.
   */
  onPaste(event: ClipboardEvent): void {
    const files = filesOnClipboard(event.clipboardData);
    if (files.length === 0) return;

    const taken = this.attachmentUpload?.acceptPastedFiles(files) ?? 0;
    if (taken === 0) return;

    // Something was attached, so the image must not also land in the text as
    // whatever markup the source page carried.
    event.preventDefault();

    // After the picked events above, so the host is already holding the files.
    this.attachmentsPasted.emit();
  }

  /**
   * A click anywhere on the frame puts the caret in the box.
   *
   * The frame shows a text cursor across its whole width, and the padding
   * either side of the textarea is a good part of that width — without this,
   * clicking the most obvious-looking part of the target did nothing and the
   * cursor was making a promise the box did not keep.
   *
   * pointerdown, not click: focus should land as the button goes down, the way
   * it does when the textarea itself is hit.
   *
   * Buttons and the textarea are left alone — they handle their own press, and
   * preventDefault() on a button's pointerdown would stop it focusing.
   */
  focusFromFrame(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    const input = this.inputRef?.nativeElement;

    if (!input || !target || target === input) return;
    if (target.closest('button')) return;

    // Without this the frame takes the focus itself and the caret never
    // arrives, because a pointerdown on a non-focusable element still blurs
    // whatever had focus.
    event.preventDefault();
    input.focus();
  }

  /** The emoji picker rides with live chat: it is offered when the visitor is
   *  talking to a person, not when they are querying the knowledge base. */
  get emojiPickerVisible(): boolean {
    return this.chatModeVisible && this.chatMode === 'chat';
  }

  /**
   * Whether the tools strip has anything on it.
   *
   * At rest the attach control is away, the attribution rides on !isEmpty, and
   * the two live-chat controls are model-mode-away — leaving a hairline band
   * with nothing on it, which made an empty widget look like it was asking for
   * an upload. The strip goes with its contents.
   */
  get rulerVisible(): boolean {
    return !this.isNeutral
        || !this.isEmpty
        || this.emojiPickerVisible
        || this.contactEditVisible;
  }

  /**
   * Whether to send under the product's own mark, or a plain arrow.
   *
   * The branded icon says "ask the assistant". In live chat the message is
   * going to a person, so a search-branded button claims the wrong thing about
   * where the text is headed — a plain arrow just means "send".
   */
  get useBrandSendIcon(): boolean {
    return !!this.sendIconReady && this.chatMode !== 'chat';
  }

  onMessageChange(value: string) {
    this.userMessage = value;
    this.userMessageChange.emit(value);
  }

  /** Put the chosen emoji where the caret is, not at the end of the message. */
  onEmojiPicked(char: string) {
    this.onMessageChange(insertAtCaret(this.inputRef?.nativeElement, char));
    // Inserting programmatically fires no (input) event, so tell the host to
    // run what a keystroke would — autosize, and whatever else it hangs there.
    this.inputEvent.emit();
  }
}
