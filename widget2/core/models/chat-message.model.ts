import { ChatInfo, MsgMode, QueryAttachment, RetEvent } from '../../shared/model-query';

export type Role = 'user' | 'assistant' | 'error';

export type FeedbackType = 'positive' | 'neutral' | 'negative';

export type Message = {
  id: number;
  role: Role;
  content?: string;
  info?: string;
  completed?: boolean;
  messageKey?: string;
  feedback?: {
    status?: FeedbackType;
    comment?: string;
    submitted?: boolean;
  };
  /** Set from the matching RetEvent.timestamp when the reply for this turn
   *  arrives (see chat-conversation.functions.ts) — the backend's model-query
   *  start time, not a purely local clock reading. */
  timestamp?: number;

  /**
   * The backend asked the visitor for their details instead of answering (see
   * the contact pre-step). Rendered as a small form in place of the message
   * text; `contactAnswered` flips once submitted or skipped, so the form is
   * not offered twice and does not reappear when history is reloaded.
   */
  /**
   * A placeholder shown while a live chat is being opened, holding a progress
   * line in `info` and no content.
   *
   * Marked so the poll loop can find and remove it when the welcome arrives:
   * that message is what the visitor was waiting for, and the two must not
   * end up stacked. Never persisted as a real turn — if it is still on screen
   * when the conversation is stored, it is a bug, not history.
   */
  pendingWelcome?: boolean;

  /**
   * How the attachments on this message are getting on.
   *
   * Absent once they are stored, which is the normal state for everything read
   * back from storage — so a reloaded conversation shows finished attachments
   * rather than ones stuck mid-upload. 'failed' persists on purpose: the
   * visitor should still see which file did not make it.
   */
  uploadState?: 'uploading' | 'failed';

  contactRequest?: RetEvent['contactRequest'];
  /**
   * True when the visitor opened this form themselves, from the ruler's edit
   * control, rather than the backend asking.
   *
   * Same form, different meaning, and the difference decides what submitting
   * does. Answering an ask is part of getting through to a person, so it opens
   * the live session. Editing your own details is not a request for anything —
   * it only changes what the next message carries — and opening a session off
   * the back of it would summon an agent the visitor never asked for.
   *
   * Local to the widget, not on RetEvent's contactRequest: the backend has no
   * opinion about a form it did not send, and this is a UI distinction rather
   * than wire data.
   */
  contactEditor?: boolean;
  contactAnswered?: boolean;
  /** What the visitor actually submitted, keyed by field. Kept on the message
   *  (not just in the form component) so the acknowledgement still shows what
   *  was shared after a reload — and so the visitor can always see what they
   *  gave, rather than having to take "passed that on" on trust. Empty when
   *  the form was dismissed. */
  contactAnswer?: Record<string, string>;

  /** Where this message was sent. Set on role 'user', at send time. */
  sendMode?: MsgMode;
  /** Which service answered. Set on role 'assistant', from the backend's own
   *  record (RetEvent.recvMode) — never re-derived from the current mode. */
  recvMode?: MsgMode;

  /** ChatInfo.name for this message, if the client supplied one when the
   *  chat started — see ChatCoreComponent.labelFor(). */
  chatName?: string;

  /** @deprecated Superseded by recvMode. Read-only, so conversations already
   *  in localStorage keep their labels. See recvModeOf(). */
  viaChat?: boolean;
  /** @deprecated Superseded by sendMode. See sendModeOf(). */
  sentVia?: 'chat' | 'model';

  /** User-message send status, shown next to the "You" label in history.
   *  'sending' the instant the local bubble is pushed, 'sent' once the
   *  backend has acked the request (subscribeResponse()'s first `next`) —
   *  never set on assistant/error messages. */
  sendStatus?: 'sending' | 'sent';
  /** Local clock reading taken when sendStatus flips to 'sent' — displayed
   *  next to the flag. Local time is fine here: it's just "when my browser
   *  saw the ack", not a value round-tripped anywhere. */
  sentAt?: number;

  /** Local clock reading taken the moment an assistant/error message's
   *  content is finalized — the incoming-message counterpart to sentAt.
   *  Set once (first write wins) whether the reply arrived inline
   *  (model mode) or via the poll loop (chat mode); shown next to the
   *  message's label. Local time, same as sentAt — "when my browser saw
   *  it", not a backend value. */
  receivedAt?: number;

  /** Files on this message — the only attachment shape, matching
   *  QueryMessage.attachments (model-query.ts). */
  attachments?: QueryAttachment[];
};

/** Where a user message was sent. Falls back to the old field, then unset. */
export function sendModeOf(message: Message): MsgMode | undefined {
  return message.sendMode ?? message.sentVia;
}

/** Which service answered. Falls back to the old flag, then unset. */
export function recvModeOf(message: Message): MsgMode | undefined {
  if (message.recvMode) return message.recvMode;
  if (message.viaChat) return 'chat';
  return undefined;
}

/** True when a human agent — not our model — wrote this reply. */
export function isFromAgent(message: Message): boolean {
  return recvModeOf(message) === 'chat';
}

export type StoredHistory = {
  storeTime?: number;
  conversationId?: string;
  messages?: Message[];
  inputHistory?: string[];

  /** The live chat-mode session this conversation was in, if any — restored
   *  on load so ChatPoller can resume polling it (see
   *  ChatCoreComponent.resumeChatPollingFromHistory()) instead of the chat
   *  going silent until the visitor happens to send another message. */
  chatInfo?: ChatInfo;

  /** Which side the visitor was talking to when this was stored. Restored so
   *  a reload lands them back in the live chat they were in — without it the
   *  widget always came back on the model side, and their next message went
   *  to the AI while a human sat waiting on the other end of the thread. */
  chatMode?: MsgMode;
};
