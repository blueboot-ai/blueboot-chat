// src/app/widget2/core/services/chat-conversation.functions.ts
//
// Was ChatConversationService (@Injectable providedIn:'root'). Every method
// only ever touched its own parameters — no instance field, no injected
// dependency — so there was nothing DI was doing for it. Stateless and
// dependency-free, like storage/feedback/widget-config: a plain module
// function, not a service.

import { WritableSignal } from '@angular/core';
import { Subscription } from 'rxjs';

import { QueryMessage, subscribeResponse } from './chat.functions';
import { Settings } from '../settings';
import { ChatInfo, QueryAttachment, RetEvent } from '../../shared/model-query';
import { Message, recvModeOf, sendModeOf } from '../models/chat-message.model';
import { ChatPoller } from './chat-poller';

/**
 * Drop the local bytes from any attachment that has a stored copy.
 *
 * `content` is a base64 data URL — the whole file, inline. It exists so the
 * feed can draw a thumbnail the instant a file is picked, before anything has
 * been uploaded. Once the file is in the bucket it is dead weight in two
 * places: on the message object, and in the localStorage copy written from it.
 *
 * Only ever with a docUrl in hand. Without one there is nothing to fall back
 * to, and dropping the bytes would erase the only copy the widget has — the
 * picture would go blank and the file would be unreachable. That is why this
 * takes the presence of an address as its condition rather than a "sent" flag:
 * the address is the evidence that the file survives being forgotten here.
 *
 * Returns the same message object when nothing changed, so callers can compare
 * by reference and avoid pointless signal writes.
 */
export function stripStoredAttachmentBytes(m: Message): Message {
  if (!m.attachments?.length) return m;

  let changed = false;

  const attachments = m.attachments.map(a => {
    if (!a.content || !a.docUrl) return a;

    changed = true;
    const { content, ...rest } = a;
    return rest;
  });

  return changed ? { ...m, attachments } : m;
}

/**
 * Settle a message's attachments against what the server says it stored.
 *
 * The backend now replies with the descriptors it wrote — see the
 * `attachments.stored` event and the `attachments` field on the non-streaming
 * body. Until it did, the widget derived each file's address itself, by
 * compiling the same filename rules the server uses and assuming they agreed.
 * They did agree, but only by construction: two copies of "sanitise a filename"
 * hold until one of them is fixed, and nothing would have failed loudly.
 *
 * Matched by name, because that is what both sides key on — the storage path is
 * built from it, and a conversation cannot hold two files of one name anyway
 * (the second overwrites the first, deliberately: see attachment-storage.ts).
 *
 * The server's fields win where it has an opinion — storagePath, docUrl and the
 * legacy link pair — and the local ones are kept where it has none: `content`
 * is the visitor's own preview bytes, which the server deliberately does not
 * echo back, and `previewText` is a widget-side snippet the server never had.
 */
export function applyStoredAttachments(
  m: Message,
  stored: QueryAttachment[] | undefined,
): Message {
  if (!m.attachments?.length || !stored?.length) return m;

  const byName = new Map<string, QueryAttachment>();
  for (const s of stored) {
    const name = (s.name || '').trim();
    if (name) byName.set(name, s);
  }
  if (!byName.size) return m;

  let changed = false;

  const attachments = m.attachments.map(a => {
    const match = byName.get((a.name || '').trim());
    if (!match) return a;

    changed = true;

    // Local first, server over the top: the server's undefined fields must not
    // erase what the widget knows, so the spread order matters more than it
    // looks. content/previewText survive because `match` does not carry them.
    return { ...a, ...match };
  });

  return changed ? { ...m, attachments } : m;
}

type InfoTextState = {
  infoIdx: number;
  thinkIdx: number;
  info: string[];
  infoThink: string[];
};

export type ChatConversationSendParams = {
  msg: string;

  /** Descriptors for this turn's files. The bytes travel separately in
   *  `files`; this is the shape the backend records. */
  attachments?: Message['attachments'];

  /** Files to send with this turn — see subscribeResponse().files. Their
   *  presence routes the send to /api/responses/multi. */
  files?: File[];

  /** The language the widget is rendering in — see InputBody.lang. */
  lang?: string;

  appId?: string;
  gptId?: string;
  conversationId: string;

  /** Whatever ChatInfo the last reply's RetEvent carried — round-tripped
   *  back to the backend unchanged on this request. */
  chatInfo?: ChatInfo;
  setChatInfo: (value: ChatInfo | undefined) => void;

  /** 'chat' hands this request to the external live-agent system
   *  (ChatQueryWorker) instead of the model — see the chat-mode selector.
   *  Anything else (including '') is the existing model-query path. */
  clientMode?: 'model' | 'chat' | '';

  /** Owns the chat-mode poll loop — one instance per ChatCoreComponent.
   *  sendWithMessage() starts it once a chat-mode ack carries a chatId;
   *  the component itself calls .stop() on reset/mode-switch. */
  chatPoller: ChatPoller;

  messages$: WritableSignal<Message[]>;

  /**
   * Mints the next message id. The ONLY way to get one.
   *
   * There used to be two schemes that never spoke to each other: a `msgId`
   * counter that only sendWithMessage() advanced, and `last.id + 1` computed
   * inline by every chat-mode path (the pending bubble, the contact form, the
   * poll loop). So a conversation that had been through chat mode left the
   * counter stale, and the next typed message was handed an id a message on
   * screen already held. Both templates use `trackBy: trackById` on exactly
   * that value, so a duplicate means Angular reuses the wrong DOM node and
   * every `arr.map(m => m.id === X)` update lands on whichever it meets first.
   *
   * A function rather than a number, deliberately: the poll loop builds its
   * params object once and reuses it for the life of the conversation, so a
   * snapshot would be stale by the second poll.
   */
  nextMessageId: () => number;

  infoText: InfoTextState;
  sendingText: string;

  /**
   * Shown in the conversation when the request fails or comes back empty.
   * Localized and human — the raw reason goes to the console, not the visitor.
   */
  errorText: string;

  /** For the two upstream failures a visitor can act on. Both fall back to
   *  errorText, so a caller that does not supply them behaves as before. */
  errorFileText?: string;
  errorBusyText?: string;

  isClearedGlobal: () => boolean;
  unmarkClearedGlobal: () => void;
  rememberInputHistory: (value: string) => void;

  saveToStorage: () => void;
  scrollSoon: () => void;
  focusInput: () => void;

  /** Forces a synchronous change-detection pass. Needed specifically around
   *  a poll-delivered message: the history container itself is behind
   *  `*ngIf="!isEmpty"` (see embed.component.html/chat.component.html), so
   *  the very first message a chat receives — most visibly the session's
   *  opening "a human agent will be with you shortly" line, which arrives
   *  with nothing else on screen to have already triggered a render — has
   *  to make that container exist before anything tries to scroll it into
   *  view. Called by applyPolledEvents() before scrollNow(). */
  detectChanges: () => void;

  /** Scrolls to the bottom immediately (no requestAnimationFrame hop) —
   *  used by applyPolledEvents() instead of scrollSoon(). scrollSoon()'s
   *  rAF exists to coalesce a burst of rapid updates (streaming deltas);
   *  a poll delivers one discrete batch after detectChanges() has already
   *  made the DOM current, so there's nothing to coalesce and no reason to
   *  wait a frame — which matters because a backgrounded/inactive tab can
   *  throttle rAF for a long time, silently delaying the scroll. */
  scrollNow: () => void;

  setIsSending: (value: boolean) => void;
  setShowSuggestions: (value: boolean) => void;
  setActiveAssistantMessageId: (value: number | null) => void;

  /**
   * Progress wording for a chat.status stage, in the visitor's language.
   *
   * Supplied by the caller rather than looked up here so this module keeps no
   * dependency on the widget's i18n — the backend sends a stage code, the
   * component resolves it.
   */
  statusText?: (stage: 'connecting' | 'opening' | 'waiting') => string;

  /**
   * The backend handed this visitor to a person mid-answer (detection fired
   * with askForContact off). Called once the reply has been rendered, to
   * switch to chat mode and open the session.
   *
   * Optional so callers that cannot act on it — a page with no live-agent
   * integration — simply don't pass it, rather than having to supply a stub.
   */
  onHandoff?: () => void;
};

// ============================================================
// Chat-mode polling
// ============================================================
// The timer/chatId/cursor/backoff bookkeeping itself now lives in
// ChatPoller (see chat-poller.ts) — one instance per ChatCoreComponent,
// passed in via params.chatPoller. What's left here is just the "a batch of
// events arrived" handling: applying them to messages$, same as the
// model-mode path applies its own inline reply.

/** Whatever a poll's events need to update — a subset of
 *  ChatConversationSendParams so resumePollingIfNeeded() below (called with
 *  no in-flight send, hence no full ChatConversationSendParams to hand it)
 *  can share this same application logic with sendWithMessage(). */
type PollEventTarget = Pick<
  ChatConversationSendParams,
  'setChatInfo' | 'setActiveAssistantMessageId' | 'messages$' | 'nextMessageId' | 'saveToStorage' | 'detectChanges' | 'scrollNow' | 'focusInput'
>;

// Applies one poll's worth of events — same per-message bookkeeping the
// inline model-mode reply does in request$.subscribe().next() below
// (ChatInfo, clearing the active/pending marker once real text lands,
// stamping viaChat/chatName for labelFor()) — just arriving asynchronously
// instead of on the request that sent the message.
function applyPolledEvents(events: RetEvent[], params: PollEventTarget): void {
  // The message the placeholder was waiting for has arrived. Drop it before
  // appending, or the progress line ends up stacked above the very message
  // that resolves it.
  //
  // Any polled message clears it, not just the welcome: an agent who replies
  // before the welcome is generated has answered the same question the
  // placeholder was asking on the visitor's behalf.
  if (events.length) {
    params.messages$.update(arr => arr.filter(m => !m.pendingWelcome));
  }

  for (const event of events) {
    if (event.chatInfo !== undefined) params.setChatInfo(event.chatInfo);

    // Not auto-switching chatMode off activePassive here: every poll
    // re-delivers the chat's entire due history in one batch, so that would
    // flip the mode back and forth on old messages every time. Left as
    // whatever ChatCoreComponent.setChatMode() last set.

    // A real reply landed — clear any still-open pending placeholder so a
    // later model-mode reply can't land on top of it.
    if (event.text) {
      params.setActiveAssistantMessageId(null);
    }

    // Minted before the update, not inside it: an update callback must stay a
    // pure function of the array it is handed, and nextMessageId() both reads
    // messages$ and advances the counter. Burning an id on the update-in-place
    // branch below costs nothing — the counter only has to be monotonic, it
    // does not have to be gapless.
    const appendId = params.nextMessageId();

    params.messages$.update(arr => {
      // A poll can re-deliver a message we already have (e.g. resume resets
      // to the full history) — event.timestamp is stable end-to-end, so
      // match on it to update in place instead of appending a duplicate.
      const existingIdx = event.timestamp !== undefined
        ? arr.findIndex(m => m.timestamp === event.timestamp)
        : -1;

      // Which service answered, as reported by the backend — not "it arrived
      // through the poll loop, so an agent wrote it", which is what this used
      // to assume unconditionally. The welcome and mock replies arrive here
      // too and are written by our model.
      const recvMode = event.recvMode ?? event.chatInfo?.recvMode ?? 'chat';

      if (existingIdx !== -1) {
        const updated = arr.slice();
        updated[existingIdx] = {
          ...updated[existingIdx],
          content: event.text,
          completed: true,
          recvMode,
          chatName: event.chatInfo?.name,
          receivedAt: updated[existingIdx].receivedAt ?? Date.now(),
        };
        return updated;
      }

      return [
        ...arr,
        {
          id: appendId,
          role: 'assistant',
          content: event.text,
          completed: true,
          timestamp: event.timestamp,
          recvMode,
          chatName: event.chatInfo?.name,
          receivedAt: Date.now(),
        },
      ];
    });
  }

  params.saveToStorage();

  // Force the history container (behind *ngIf="!isEmpty") into existence
  // synchronously, then scroll immediately rather than through scrollSoon()'s
  // requestAnimationFrame — see detectChanges()'s and scrollNow()'s doc
  // comments on ChatConversationSendParams.
  params.detectChanges();
  params.scrollNow();

  // A poll-delivered message is otherwise easy to miss entirely: on the
  // embed widget, the panel can be sitting collapsed back to the inline box
  // when an agent's reply comes in, with nothing on screen to show it
  // arrived. Focusing the composer re-fires the same (focus) handler a
  // visitor's own click would — EmbedComponent's onInputFocus() calls
  // reopenIfCollapsedWithHistory(), which raises the overlay because
  // isEmpty is false by the time this runs. Harmless everywhere else: the
  // launcher/chat-panel widget has no separate collapsed state, so this
  // just puts the caret in the box the visitor is already looking at.
  params.focusInput();
}

/**
 * Reconciles the poll loop against the current chatInfo — called liberally
 * on any "activation" (load, panel open, mode toggle). A chatId means try to
 * poll it (no-op if already polling that chatId); no chatId means stop
 * polling. chatInfo itself is only ever cleared by an actual reset/new-chat
 * action, never just to pause polling.
 */
export function resumePollingIfNeeded(
  params: { chatInfo?: ChatInfo; chatPoller: ChatPoller; appId?: string; gptId?: string }
    & PollEventTarget
): void {
  const chatId = params.chatInfo?.chatId;

  if (!chatId) {
    params.chatPoller.stop();
    return;
  }

  params.chatPoller.start(chatId, {
    appId: params.appId,
    gptId: params.gptId,
    onEvents: events => applyPolledEvents(events, params),
  });
}

/**
 * The visitor filled in (or dismissed) the contact form.
 *
 * Values go onto chatInfo, which the widget round-trips on every request — so
 * from here the existing path takes over untouched: the next message carries
 * them, updateContact() on the backend notices they changed, and the chat
 * provider is told (Slack rewrites its thread header and bylines each relayed
 * message). Nothing is sent on its own account; there is no separate endpoint
 * for this and no request made here.
 *
 * The message is marked answered either way, so the form is not offered twice
 * and does not come back when history is reloaded from storage.
 */
export function applyContactAnswer(
  message: Message,
  values: Record<string, string> | undefined,
  params: Pick<ChatConversationSendParams, 'messages$' | 'chatInfo' | 'setChatInfo' | 'saveToStorage' | 'scrollSoon' | 'focusInput'>
): void {
  params.messages$.update(arr =>
    arr.map(m =>
      m.id === message.id
        ? { ...m, contactAnswered: true, contactAnswer: values ?? {} }
        : m
    )
  );

  const name = values?.['name']?.trim();
  const info = values?.['info']?.trim();

  if (name || info) {
    // Merge, don't replace: a form that only asked for a phone number must not
    // wipe a name captured earlier.
    params.setChatInfo({
      ...(params.chatInfo ?? {}),
      ...(name ? { visitorName: name } : {}),
      ...(info ? { contactInfo: info } : {}),
    });
  }

  params.saveToStorage();
  params.scrollSoon();
  params.focusInput();
}

/**
 * Opens the chat-mode session as soon as the visitor selects chat mode,
 * rather than waiting for their first typed message. Sends an empty
 * QueryMessage as an ack — which ChatQueryWorker reads as "the visitor just
 * picked Chat live", whether or not a chatId comes with it. It asks for
 * contact details, or opens/resumes the session, and sends the welcome back
 * through the poll loop.
 *
 * Called on every selection of chat mode, with no precondition. It used to
 * say "only when there's no existing chatId" and the backend enforced that
 * with a 400 — which is exactly why re-entering chat mode did nothing at all.
 *
 * Returns the Subscription so the caller can cancel it on teardown — an SSE
 * stream left running after the widget is destroyed goes on calling
 * saveToStorage() and detectChanges() on a dead view.
 */
export function startChatSession(
  params: { appId?: string; gptId?: string; conversationId: string; lang?: string; chatPoller: ChatPoller }
    & Pick<ChatConversationSendParams, 'setChatInfo' | 'messages$' | 'chatInfo' | 'statusText'>
    & PollEventTarget
): Subscription {
  // The turns the visitor had with the AI before asking for a human. This is
  // the *only* request that creates the session, and ChatQueryWorker relays
  // history to the external system on the session-creating call alone
  // (`isNewSession`) — so history omitted here is history the agent never
  // sees, no matter what later messages carry. It used to be omitted, which
  // is why the agent always started cold.
  const history = buildApiHistory(params.messages$());

  // The same pending bubble the model path uses, so waiting for a live chat
  // looks identical to waiting for an answer. Its line is replaced as the
  // backend reports progress (see the status branch below); no swapTo, since
  // these stages are real events rather than a guess that time has passed.
  const pending = beginPendingBubble(params, {
    id: params.nextMessageId(),
    line: params.statusText?.('connecting') || '',
    // Held back briefly. Switching to chat when a session is already open
    // finishes in well under this — the backend resolves the session and acks
    // with no welcome to announce — so the visitor sees the switch happen and
    // nothing else, instead of a progress line that appears and vanishes.
    // Opening a real session takes far longer than this (a provider round
    // trip), so that case still gets its placeholder.
    appendAfterMs: 400,
    // Marked so the poll loop can drop it when the message it was waiting for
    // finally arrives.
    extra: { pendingWelcome: true, recvMode: 'model' as const },
  });

  const request$ = subscribeResponse(Settings.queryBase(), {
    prompt: '',
    ...(history.length ? { history } : {}),
    appId: params.appId,
    gptId: params.gptId,
    conversationId: params.conversationId,
    mode: 'chat',
    // This request is exactly the one the backend cannot infer a language
    // from: prompt is empty, and a visitor who clicked straight through to a
    // person may have no history either. The welcome it triggers is written
    // before they have typed a word — see generateWelcomeReply().
    lang: params.lang,
    // Carry whatever we already know about the visitor into the session that
    // is about to be created. The contact form usually runs on the model path,
    // before any chat session exists, so by the time the visitor asks for a
    // human the details are sitting on chatInfo — and this is the request that
    // opens the thread. Omit it and the agent's thread opens anonymously, with
    // the name only arriving on the visitor's *next* message.
    ...(params.chatInfo ? { chatInfo: params.chatInfo } : {}),
  });

  // Whether the backend said a welcome is on its way. Only then does the
  // placeholder survive the end of this request — otherwise nothing would ever
  // replace it and it would spin forever.
  let welcomeExpected = false;

  return request$.subscribe({
    next: (reply: RetEvent) => {
      // Progress from the backend. Only the stage travels; the wording is
      // ours, so it is already in the visitor's language.
      if (reply.status?.stage) {
        if (reply.status.stage === 'waiting') welcomeExpected = true;
        const line = params.statusText?.(reply.status.stage);
        if (line) pending.setLine(line);
        return;
      }

      // The backend decided to ask who the visitor is, and deliberately did
      // NOT create a session yet — so there is no chatId here, and the poller
      // must not start. The form's answer comes back through
      // applyContactAnswer(), and the caller then asks again; that second
      // request is the one that opens the agent's thread, by then carrying
      // whatever the visitor gave.
      if (reply.contactRequest) {
        const contactRequest = reply.contactRequest;

        // The form is the reply, so the pending bubble is done: nothing is
        // being opened, and leaving it would show a progress line above a
        // question that is waiting on the visitor, not on us.
        pending.remove();

        // chatInfo still matters: it carries contactAsked back, which is what
        // stops the backend asking again if they decline.
        if (reply.chatInfo !== undefined) params.setChatInfo(reply.chatInfo);

        // Minted outside the update, and — critically — from the counter
        // rather than from the array. `last.id + 1` read an array the
        // pending.remove() above had just emptied, so the form inherited the
        // id the bubble had vacated, and the next remove() of "the bubble"
        // deleted the form instead.
        const formId = params.nextMessageId();

        params.messages$.update(arr => {
          return [
            ...arr,
            {
              id: formId,
              role: 'assistant' as const,
              completed: true,
              receivedAt: Date.now(),
              recvMode: 'model' as const,
              contactRequest,
            },
          ];
        });

        params.saveToStorage();
        params.detectChanges();
        params.scrollNow();
        params.focusInput();
        return;
      }

      if (reply.chatInfo === undefined) return;

      params.setChatInfo(reply.chatInfo);
      if (reply.chatInfo.chatId) {
        params.chatPoller.start(reply.chatInfo.chatId, {
                appId: params.appId,
          gptId: params.gptId,
          onEvents: events => applyPolledEvents(events, params),
        });
      }
    },
    error: (err: any) => {
      console.error('[chat] session-start ack failed:', err);
      // Nothing is coming — a bubble left spinning would claim otherwise.
      pending.remove();
    },

    complete: () => {
      // The welcome arrives later, through the poll loop, so the placeholder
      // has to outlive this request — but only when the backend actually said
      // one is coming (the "waiting" stage). With sendWelcome off nothing
      // would ever replace it, so it goes now rather than spinning forever.
      if (!welcomeExpected) pending.remove();
    },
  });
}

/**
 * Ends the chat-mode session the visitor was in, the mirror image of
 * startChatSession(): sends an empty QueryMessage carrying
 * ChatInfo.status = 'closed' instead of a normal message. ChatQueryWorker
 * (public-service) reads that to close the external session and mark the
 * stored ChatSession closed. Call before wiping local chatInfo/stopping the
 * poller (see newConversation()) — this needs the chatId that's about to be
 * cleared. Fire-and-forget: the widget's own state is reset locally
 * regardless of whether this round-trip succeeds, so there's nothing for a
 * caller to await or react to.
 */
export function closeChatSession(
  params: { appId?: string; gptId?: string; conversationId: string; chatInfo: ChatInfo }
): void {
  const chatId = params.chatInfo.chatId;
  if (!chatId) return;

  subscribeResponse(Settings.queryBase(), {
    prompt: '',
    appId: params.appId,
    gptId: params.gptId,
    conversationId: params.conversationId,
    mode: 'chat',
    chatInfo: { ...params.chatInfo, status: 'closed' },
  }).subscribe({
    error: (err: any) => {
      console.error('[chat] close-session request failed:', err);
    },
  });
}

/**
 * Sends the visitor's typed message.
 *
 * Returns the Subscription (or undefined when there was nothing to send)
 * so the caller can cancel it on teardown — see startChatSession().
 */
export function sendWithMessage(params: ChatConversationSendParams): Subscription | undefined {
  const msg = params.msg.trim();
  if (!msg) return undefined;

  if (params.isClearedGlobal()) {
    params.unmarkClearedGlobal();
  }

  params.rememberInputHistory(msg);

  params.setIsSending(true);
  params.setShowSuggestions(false);

  params.saveToStorage();
  params.scrollSoon();

  const history = buildApiHistory(params.messages$());
  const assistantMessageKey = newAssistantMessageKey();

  // Shared by the local bubble and the backend's `timestamp` option, so chat
  // mode stores the message under this exact value instead of a new one.
  const sentAt = Date.now();

  const request$ = subscribeResponse(Settings.queryBase(), {
    prompt: msg,
    history,
    appId: params.appId,
    gptId: params.gptId,
    conversationId: params.conversationId,
    assistantMessageKey,
    chatInfo: params.chatInfo,
    // '' (or unset) is falsy, so the backend's clientMode dispatch treats it
    // exactly like "not set" — its default/model branch. 'chat' hands this
    // request to ChatQueryWorker instead — see the chat-mode selector.
    mode: params.clientMode || '',
    lang: params.lang,
    timestamp: sentAt,
    attachments: params.attachments,
    files: params.files,
  });

  const userMsgId = params.nextMessageId();

  params.messages$.update(arr => [
    ...arr,
    {
      id: userMsgId,
      role: 'user',
      content: msg,
      ...(params.attachments?.length ? { attachments: params.attachments } : {}),
      // No retval arrives for a user turn (only assistant replies get one
      // from the backend), so stamp it locally at creation time instead —
      // the same value just sent to the backend as this turn's timestamp.
      timestamp: sentAt,
      // Same source as the `mode` sent to the backend just above — records
      // where this particular message actually went, so history keeps
      // showing the right destination even after the visitor flips modes.
      // Where this message is being sent, recorded once at send time so it
      // survives the visitor flipping the selector afterwards.
      sendMode: params.clientMode === 'chat' ? 'chat' : 'model',
      // Flips to 'sent' the moment the backend acks this request (below) —
      // shown next to the "You" label so the visitor can see a message went
      // through, not just that it's sitting in the composer's history.
      sendStatus: 'sending',
    },
  ]);

  params.saveToStorage();

  let content: string | undefined = undefined;

  const infoLineRaw = nextInfoLine(params.infoText);
  const thinkLineRaw = nextThinkingLine(params.infoText, params.sendingText);

  const assistantMsgId = params.nextMessageId();
  params.setActiveAssistantMessageId(assistantMsgId);

  // The same pending bubble the chat paths use. It starts on an info line and
  // falls back to the plain thinking line if nothing has arrived after a
  // moment — that swap is what distinguishes this path, and is why swapTo
  // exists on the helper rather than being copied here.
  const pending = beginPendingBubble(params, {
    id: assistantMsgId,
    line: infoLineRaw || thinkLineRaw,
    ...(infoLineRaw ? { swapTo: thinkLineRaw, swapAfterMs: 1200 } : {}),
    extra: { content, messageKey: assistantMessageKey },
  });

  params.saveToStorage();

  const clearTimers = () => pending.stop();

  // Set when a reply carries a ChatInfo — i.e. this request went through
  // ChatQueryWorker rather than the model. Its ack only carries `text` on
  // the message that opens the chat (see chat-query-worker.ts); every
  // follow-up acks with no text at all, since the real reply arrives later
  // via polling. complete: below reads this to tell "the chat backend
  // legitimately said nothing yet" apart from an actual failed request.
  let isChatAck = false;
  // Set when the backend answered with a request for the visitor's details
  // instead of a written reply (the contact pre-step — see
  // contact-pre-call.ts). Like a chat ack, this turn legitimately carries no
  // text: the form IS the reply. complete: below must not mistake it for a
  // request that failed.
  let isContactRequest = false;
  // Set when the backend handed the visitor straight to a person instead of
  // answering. Unlike a contact request this turn DOES carry text, so the
  // normal empty-response check is not the problem — what it needs is for the
  // caller to open the session once the reply has landed.
  let isHandoff = false;
  // Only the first `next` means anything for the send flag — a streaming
  // reply fires this repeatedly, and the user's own bubble only needs to
  // flip from 'sending' to 'sent' once.
  let sendAcked = false;

  return request$.subscribe({
    next: (reply: RetEvent) => {
      params.setIsSending(false);

      // What the server actually stored, before anything is thrown away.
      //
      // Ordered ahead of the ack block below on purpose: that block drops the
      // local bytes for every attachment that has an address, and this is what
      // gives them one. Reversed, the first turn's files would keep their base64
      // until some later event happened to arrive.
      //
      // Two shapes, one meaning — the streaming path sends an
      // `attachments.stored` event, the non-streaming body carries the same
      // array on the reply itself. Reading both here is cheaper than teaching
      // the caller which transport it is on.
      const storedAttachments = reply.attachments;

      if (storedAttachments?.length) {
        params.messages$.update(arr =>
          arr.map(m => applyStoredAttachments(m, storedAttachments))
        );
      }

      if (!sendAcked) {
        sendAcked = true;
        const ackedAt = Date.now();

        params.messages$.update(arr =>
          arr.map(m => {
            const acked = m.id === userMsgId
              ? { ...m, sendStatus: 'sent' as const, sentAt: ackedAt }
              : m;

            // The ack is also the moment the attachments on this turn are known
            // to be stored: the backend refuses the request outright when it
            // cannot write them (see storeAttachments), so a reply arriving at
            // all means every file on it is in the bucket.
            //
            // That makes the local base64 redundant, and it is the expensive
            // half of the message — a couple of PDFs is megabytes against a
            // ~5MB localStorage quota, which is what makes saveHistory() start
            // evicting *other* conversations. The feed falls back to docUrl for
            // the picture, so nothing disappears from the screen.
            //
            // Everything with an address, not only this turn's: an earlier turn
            // that was still holding bytes is in exactly the same position, and
            // there is no reason to make it wait for its own ack.
            return stripStoredAttachmentBytes(acked);
          })
        );
      }

      // The backend decided this visitor is being handed to a person, and is
      // not asking them anything first. `text` is the line to show, already
      // written in their own language by the classifier — it arrives as a
      // normal assistant message, and the handoff itself is triggered by the
      // caller (see onHandoff below), not here.
      if (reply.handoff) {
        isHandoff = true;
      }

      // The backend is asking the visitor who they are, instead of answering.
      // Attach the form to this turn's placeholder bubble — it replaces the
      // written reply rather than accompanying one, so there is no text to
      // wait for and nothing further will arrive on this stream.
      if (reply.contactRequest) {
        isContactRequest = true;
        const contactRequest = reply.contactRequest;
        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, contactRequest, info: undefined, completed: true, receivedAt: m.receivedAt ?? Date.now() }
              : m
          )
        );
      }

      // Store whatever ChatInfo the backend sent back — round-tripped
      // unchanged on the next request (see subscribeResponse() above).
      if (reply.chatInfo !== undefined) {
        isChatAck = true;
        params.setChatInfo(reply.chatInfo);

        // Stamp the pending bubble with what the backend reported, rather
        // than assuming "a ChatInfo is present, so a human wrote it" — a
        // ChatInfo only says the turn belongs to a chat session, which is
        // equally true of the AI-written welcome message.
        const ackRecvMode = reply.recvMode ?? reply.chatInfo.recvMode ?? 'chat';
        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, recvMode: ackRecvMode, chatName: reply.chatInfo!.name }
              : m
          )
        );

        // A chatId means this is a chat-mode (external system) session —
        // its real replies arrive async via webhook, so start polling for
        // them. No-ops if already polling this chatId.
        if (reply.chatInfo.chatId) {
          const pollOpts = {
                    appId: params.appId,
            gptId: params.gptId,
            onEvents: (events: RetEvent[]) => applyPolledEvents(events, params),
          };
          params.chatPoller.start(reply.chatInfo.chatId, pollOpts);
          // ...and because start() no-ops on an already-polling chatId, tell
          // the poller explicitly that a reply just became likely. Without
          // this, every message after the first is sent into a poller that
          // may already have backed off, so the agent's answer sits unseen
          // for up to MAX_INTERVAL_MS at precisely the wrong moment.
          params.chatPoller.resetPace(pollOpts);
        }
      }

      // Stamp the assistant message with the backend's model-query-start
      // timestamp the first time it arrives — every event of this request
      // carries the same value, so only set it once (m.timestamp is
      // undefined) rather than re-writing it on every delta.
      if (reply.timestamp !== undefined) {
        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId && m.timestamp === undefined
              ? { ...m, timestamp: reply.timestamp }
              : m
          )
        );
      }

      if (reply.delta) {
        content = (content || '') + reply.delta;
        // Text is arriving, so the animated line is done — stop the ticker
        // before clearing it, or the next tick would paint it straight back.
        pending.stop();

        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, content, info: undefined, completed: false }
              : m
          )
        );

        params.saveToStorage();
        params.scrollSoon();
      }

      if (reply.text) {
        pending.stop();
        content = reply.text;

        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, content, info: undefined, completed: true, receivedAt: m.receivedAt ?? Date.now() }
              : m
          )
        );

        params.saveToStorage();
        params.scrollSoon();
      }

      if (!content) {
        pending.tick();
      } else {
        clearTimers();
      }
    },

    error: (err: any) => {
      clearTimers();


      // The visitor sees a sentence they can act on; the reason — a CORS
      // refusal, an HTTP status, a dropped socket — is only useful to us.
      console.error('[chat] request failed:', err);

      const errorText = errorTextFor(err, params);

      params.messages$.update(arr =>
        arr.map(m =>
          m.id === assistantMsgId
            ? {
              ...m,
              role: 'error',
              content: String(errorText),
              info: undefined,
              completed: true,
              receivedAt: m.receivedAt ?? Date.now(),
            }
            : m
        )
      );

      params.saveToStorage();
      params.setActiveAssistantMessageId(null);
      params.setIsSending(false);
    },

    complete: () => {
      clearTimers();

      // A contact request is a complete turn with no text by design — the form
      // is the reply. Without this it lands in the empty-response branch below
      // and the visitor gets "Sorry, something went wrong" in place of the
      // form they were meant to fill in.
      if (isContactRequest) {
        // Clear the "working on it" placeholder text. next: already set it to
        // undefined, but the grow timer fires every 500ms and will have put it
        // back before this ran — and the normal clearing path below is the one
        // we are skipping.
        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, info: undefined, completed: true, receivedAt: m.receivedAt ?? Date.now() }
              : m
          )
        );

        params.saveToStorage();
        params.setActiveAssistantMessageId(null);
        params.setIsSending(false);
        params.scrollSoon();
        params.focusInput();
        return;
      }

      const cameBackEmpty = !content;

      // A chat-mode follow-up legitimately acks with nothing to show — the
      // real reply arrives later via polling as its own message — so the
      // placeholder bubble this turn created is dropped rather than turned
      // into an error. Only the true model-query case (or a chat-mode
      // request that never even acked) still treats empty as a failure.
      if (cameBackEmpty && isChatAck) {
        params.messages$.update(arr => arr.filter(m => m.id !== assistantMsgId));
        params.saveToStorage();
        params.setActiveAssistantMessageId(null);
        params.setIsSending(false);
        params.scrollSoon();
        params.focusInput();
        return;
      }

      // Completing with nothing is a failure the visitor would otherwise see
      // as an empty bubble: the stream opened, said nothing and closed. Treat
      // it exactly like an error rather than leaving dead space in the
      // conversation.
      if (cameBackEmpty) {
        console.error('[chat] request completed with no content');
      }

      params.messages$.update(arr =>
        arr.map(m =>
          m.id === assistantMsgId
            ? cameBackEmpty
              ? {
                ...m,
                role: 'error' as const,
                content: params.errorText,
                info: undefined,
                completed: true,
                receivedAt: m.receivedAt ?? Date.now(),
              }
              : { ...m, completed: true, info: undefined, receivedAt: m.receivedAt ?? Date.now() }
            : m
        )
      );

      params.saveToStorage();

      params.setActiveAssistantMessageId(null);
      params.setIsSending(false);
      params.scrollSoon();
      params.focusInput();

      // Last, once the reply is on screen and the turn is settled: the visitor
      // reads "I'm passing you to a colleague" and only then does the mode
      // switch and the session open. Doing it in next: would flip the composer
      // mid-stream, under a message still being written.
      if (isHandoff) params.onHandoff?.();
    },
  });
}

// ============================================================
// Module-private
// ============================================================

/**
 * The pending assistant bubble — the one with no content and an animated line
 * in `info`.
 *
 * Extracted from sendWithMessage(), which owned it inline, so the chat-mode
 * paths can use the same thing rather than a second implementation. One field
 * (`info`), one 500ms tick, one place that knows how the dots work: a parallel
 * copy would drift, and the two would stop looking like the same product.
 *
 * `swapTo` is the model path's behaviour: start on an info line, and if
 * nothing has arrived after a moment, fall back to the plain "thinking" line.
 * The chat paths don't need it, so they omit it.
 */
type PendingBubble = {
  id: number;
  /** Replace the animated line — chat-mode progress stages use this. */
  setLine(line: string): void;
  /** Advance the dots once. */
  tick(): void;
  /** Stop animating, leave the message where it is. */
  stop(): void;
  /** Stop animating and remove the message entirely. */
  remove(): void;
};

/**
 * The upstream error code, if the failure carried one.
 *
 * The backend answers an OpenAI rejection with
 * `{ error: "OPENAI_ERROR", message: <the raw body, as a string> }`, so the code
 * is two parses deep. Anything unexpected anywhere on that path returns null
 * and the caller falls back to the general apology — a message about the error
 * message being unreadable helps nobody.
 */
function upstreamErrorCode(err: any): string | null {
  try {
    const body = err?.error;
    const raw = typeof body === 'string' ? body : body?.message;
    if (typeof raw !== 'string') return null;

    const parsed = JSON.parse(raw);
    const code = parsed?.error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/**
 * What the visitor is told.
 *
 * Only the failures they can act on get their own sentence: a file the model
 * could not read, and a queue that is full. Everything else — a dropped socket,
 * a CORS refusal, a 500 — is the general apology, because naming it would only
 * worry someone who cannot do anything with it.
 */
function errorTextFor(err: any, params: ChatConversationSendParams): string {
  switch (upstreamErrorCode(err)) {
    case 'invalid_file':
      return params.errorFileText || params.errorText;
    case 'rate_limit_exceeded':
      return params.errorBusyText || params.errorText;
    default:
      return params.errorText;
  }
}

function beginPendingBubble(
  params: Pick<ChatConversationSendParams, 'messages$' | 'saveToStorage' | 'detectChanges' | 'scrollNow'>,
  opts: {
    id: number;
    line: string;
    swapTo?: string;
    swapAfterMs?: number;
    /** Extra fields for the message — e.g. pendingWelcome, messageKey. */
    extra?: Partial<Message>;

    /**
     * Wait this long before putting the bubble on screen at all.
     *
     * For work that might finish almost immediately. Switching to chat when a
     * session already exists is the case: the backend sends "connecting"
     * before getOrCreateSession() has told it the session is already open, so
     * a placeholder went up and came down again a few tens of milliseconds
     * later — a flicker announcing nothing.
     *
     * A delay rather than predicting the outcome client-side: the widget
     * cannot know whether its stored chatId still resolves, and guessing wrong
     * means either a flicker anyway or a slow request with no feedback at all.
     * Waiting is right whatever the answer turns out to be — if the work
     * finishes first the visitor never sees a placeholder, and if it doesn't,
     * one appears having cost a few hundred milliseconds.
     *
     * Only safe where nothing addresses the message by id before it exists.
     * The chat paths qualify (they hold the PendingBubble itself); the model
     * path does NOT — sendWithMessage() writes the reply into this message by
     * id, so it must be there from the start. Hence opt-in, defaulting to 0.
     */
    appendAfterMs?: number;
  }
): PendingBubble {
  let baseLine = opts.line;
  let stopped = false;
  let dots = 0;
  let appended = false;

  // Whether this bubble has already been taken off screen.
  //
  // remove() is called from more than one place for the same bubble — the
  // contactRequest branch removes it to put a form in its place, and then
  // `complete:` removes it again because no welcome was announced. Ids are
  // handed out as "last id + 1", so the message appended after a removal
  // inherits the id the bubble just vacated: on an empty conversation the
  // bubble is id 1, removing it empties the array, and the contact form is
  // appended as id 1 too. The second remove() then filtered by that id and
  // deleted the form — the visitor saw something appear and vanish, and was
  // left with a click that did nothing.
  //
  // Guarded rather than fixed at the call sites: a pending bubble is a
  // one-shot thing, and "remove it again" must mean nothing, not "remove
  // whatever is standing there now".
  let removed = false;

  const paint = (): void => {
    // Nothing on screen yet (still inside appendAfterMs), so there is nothing
    // to repaint — baseLine and dots are simply carried until append() runs.
    if (stopped || !appended) return;

    params.messages$.update(arr =>
      arr.map(m =>
        m.id === opts.id
          ? { ...m, info: `${baseLine}${'.'.repeat(dots)}`, completed: false }
          : m
      )
    );
  };

  const append = (): void => {
    if (appended || removed) return;
    appended = true;

    params.messages$.update(arr => [
      ...arr,
      {
        id: opts.id,
        role: 'assistant' as const,
        info: baseLine,
        completed: false,
        ...(opts.extra ?? {}),
      },
    ]);

    // The bubble is the whole point of this function, so paint it here rather
    // than leaving each caller to remember. It matters most on the very first
    // message of a conversation: the history container is behind
    // `*ngIf="!isEmpty"` (see applyPolledEvents()'s note and the widget
    // templates), so on an empty conversation there is no container yet and
    // the signal update has nothing to repaint into. Without this pass the
    // bubble exists in `messages$` and never reaches the screen — which is
    // exactly how "click Chat live on an empty conversation and nothing
    // happens" looked, while the same click on a conversation with messages
    // worked fine.
    params.detectChanges();
    params.scrollNow();
  };

  const appendTimer = opts.appendAfterMs
    ? setTimeout(append, opts.appendAfterMs)
    : (append(), undefined);

  // Started with the bubble, not before it: an interval animating dots into a
  // message that does not exist yet is pure waste, and on a request that beats
  // the delay it would be the only thing that ever ran.
  const growTimer = setInterval(() => {
    dots = (dots % 3) + 1;
    paint();
  }, 500);

  const swapTimer = opts.swapTo
    ? setTimeout(() => {
        if (stopped) return;
        baseLine = opts.swapTo as string;
        paint();
      }, opts.swapAfterMs ?? 1200)
    : undefined;

  const stop = (): void => {
    stopped = true;
    if (appendTimer) clearTimeout(appendTimer);
    clearInterval(growTimer);
    if (swapTimer) clearTimeout(swapTimer);
  };

  return {
    id: opts.id,
    setLine: (line: string) => { baseLine = line; paint(); },
    tick: () => { dots = (dots % 3) + 1; paint(); },
    stop,
    remove: () => {
      stop();
      if (removed) return;
      removed = true;

      // Never made it on screen — the request finished inside appendAfterMs,
      // which is the whole point. stop() has already cancelled the pending
      // append, so there is nothing to take out of messages$ and no reason to
      // touch storage or force a render.
      if (!appended) return;

      params.messages$.update(arr => arr.filter(m => m.id !== opts.id));
      params.saveToStorage();
      // Same reason as the paint on creation: a bubble that is gone from
      // messages$ but still on screen is worse than one that never appeared.
      params.detectChanges();
    },
  };
}

/**
 * One stored attachment, as a reference the backend can act on.
 *
 * Address and identity, never bytes. The file is already in the bucket and
 * already in the agent's workspace; what a later turn needs to say is *which*
 * file, not what is in it.
 *
 * `content` is dropped explicitly rather than by listing fields, so a
 * descriptor that gains a field later still travels — and so that the one
 * thing that must never travel is named in the code rather than implied by its
 * absence from a whitelist.
 */
function storedAttachmentRef(a: QueryAttachment): QueryAttachment {
  const { content, ...rest } = a;
  return rest;
}

/**
 * The stored attachments on a message, or nothing at all.
 *
 * Only descriptors the backend has confirmed — an address is the evidence. A
 * picked file that never made it to the bucket has no docUrl and no
 * storagePath, and referring to it would tell the backend about a file neither
 * side can reach.
 */
function attachmentRefsFor(m: Message): { attachments?: QueryAttachment[] } {
  const stored = (m.attachments || []).filter(a => !!a.docUrl || !!a.storagePath);
  return stored.length ? { attachments: stored.map(storedAttachmentRef) } : {};
}

function buildApiHistory(messages: Message[]): QueryMessage[] {
  const cleaned = messages
    .filter(m => {
      if (m.role !== 'user' && m.role !== 'assistant') return false;

      const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
      if (hasText) return true;

      // A wordless turn used to be dropped outright, and had to be: the row the
      // widget adds when a file is picked has no words, and while history
      // carried no attachments either it reached the backend as an empty user
      // turn — the model saw nothing where the visitor saw their file.
      //
      // It now has something to say. A row whose files are stored carries their
      // references, which is precisely the turn the *server* builds for itself
      // in this situation: attachToCurrentTurn() makes a wordless user turn
      // rather than lose an upload, on the same reasoning — a message that is
      // only a file is a real message.
      //
      // Still dropped when nothing is stored, so a picked-but-never-sent file
      // does not become an empty turn again.
      return !!attachmentRefsFor(m).attachments;
    })
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      // May legitimately be empty now — see the filter above.
      content: (m.content ?? '').trim(),
      // Both travel with the turn. Without them the history feed was blind:
      // every turn reached the backend looking identical, so anything that
      // needed to know who wrote what had to guess from the request's current
      // mode — a property of now, not of the turn.
      ...(sendModeOf(m) ? { sendMode: sendModeOf(m) } : {}),
      ...(recvModeOf(m) ? { recvMode: recvModeOf(m) } : {}),
      // Who answered, by name — so a handoff relayed back to the agent shows
      // which colleague already replied, not just that one did.
      ...(m.chatName ? { authorName: m.chatName } : {}),
      ...(m.role === 'assistant' && m.messageKey ? { assistantMessageKey: m.messageKey } : {}),
      ...(m.role === 'assistant' && m.feedback?.status ? { feedbackStatus: m.feedback.status } : {}),
      ...(m.role === 'assistant' && m.feedback?.comment ? { feedbackComment: m.feedback.comment } : {}),
      ...(m.role === 'assistant' && m.feedback?.submitted ? { feedbackUpdatedAt: Date.now() } : {}),
      ...(m.timestamp !== undefined ? { timestamp: m.timestamp } : {}),
      // Stored attachments travel with the turn they belong to.
      //
      // This replaces a flat "no attachments in history, ever". That rule was
      // right when a descriptor was only ever the widget's own local guess —
      // name, kind, size, and no way for anyone to read the file — so sending
      // it told the backend a file existed while giving it nothing to do about
      // that, and risked a second copy arriving beside the real bytes.
      //
      // What changed is that a stored descriptor is now an answer rather than a
      // guess: the backend writes the file, stamps storagePath and a durable
      // docUrl on it, and returns it (see applyStoredAttachments). Carrying
      // that back is what lets either party know a file is part of this
      // conversation on turn five, not only on the turn it arrived.
      //
      // storedAttachmentRef() is what keeps the old rule's teeth: bytes never
      // travel here. Only a turn whose files are actually in the bucket
      // contributes anything, so a failed upload stays absent rather than
      // becoming a reference to nothing.
      ...attachmentRefsFor(m),
    }));

  const dedup: QueryMessage[] = [];

  for (const item of cleaned) {
    const last = dedup[dedup.length - 1];

    // The attachment guard is back, and needed again: history is no longer
    // text only, so two wordless attachment turns — different files, both with
    // empty content — would collapse into one and lose a file from the record.
    // Compared by address, since that is what identifies a stored file.
    const sameAttachments =
      (last?.attachments || []).map(a => a.docUrl || a.storagePath || a.name).join('|') ===
      (item.attachments || []).map(a => a.docUrl || a.storagePath || a.name).join('|');

    const same =
      !!last &&
      last.role === item.role &&
      last.content === item.content &&
      sameAttachments &&
      (last.assistantMessageKey || '') === (item.assistantMessageKey || '');

    if (!same) dedup.push(item);
  }

  return dedup;
}

function newAssistantMessageKey(): string {
  return `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nextInfoLine(infoText: InfoTextState): string {
  const list = (infoText.info || []).filter(s => !!String(s).trim());
  if (!list.length) return '';

  const i = infoText.infoIdx % list.length;
  const out = String(list[i]).trim();

  infoText.infoIdx = (infoText.infoIdx + 1) % list.length;

  return out;
}

function nextThinkingLine(infoText: InfoTextState, fallback: string): string {
  const list = (infoText.infoThink || []).filter(s => !!String(s).trim());
  if (!list.length) return fallback || '';

  const i = infoText.thinkIdx % list.length;
  const out = String(list[i]).trim() || fallback || '';

  infoText.thinkIdx = (infoText.thinkIdx + 1) % list.length;

  return out;
}
