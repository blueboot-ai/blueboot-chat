// src/app/widget2/core/chat-core.component.ts
//
// Shared chat engine for widget2. Everything both entry points need lives
// here: state, storage, selection handling, feedback, send pipeline, app
// config load, and the full lifecycle.
//
// The one rule for this file: **it declares no @Input()**.
//
// Angular merges @Input metadata down the prototype chain, so any input
// declared here would become bindable on every subclass and could never be
// removed by one of them. Keeping the base input-free is what lets each
// surface publish its own attribute list: EmbedComponent and ChatComponent
// each re-declare, with @Input(), exactly the properties they want bindable —
// in lowercase for HTML and again as a camelCase setter for an Angular
// template. Anything not re-declared is a plain field and is not part of any
// surface's public attribute set.
//
// @Directive() with no selector is the supported way to decorate an abstract
// Angular base class — it must never be added to a template or an `imports`
// array.

import {
  Directive,
  AfterViewInit,
  signal,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ElementRef,
  ViewChild,
  ViewChildren,
  QueryList,
  NgZone,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { BluebootClient } from './services/blueboot.client';
import { newConversationId } from './services/chat.functions';
import { PickedAttachment } from './components/attachment-upload/attachment-upload.component';
import { makePreviewDataUrl, makeTextPreview } from './services/attachment-preview';
import { WidgetApp } from './models/widget-app';
import { Settings } from './settings';
import {
  DEFAULT_LANG,
  DEFAULT_UI_TRANSLATIONS,
  DEFAULT_SUGGESTIONS,
  DEFAULT_INFO_TEXT,
  pickLang,
} from './i18n/ui-strings';
// Detection lives in shared-library, not in the widget: the console asks the
// same question on the same page load, and the two used to answer it with
// separate country tables and separate IP lookups — the second of which the
// provider refused. `supported` is the only argument the widget adds, because
// which packs this build ships is the one thing shared-library cannot know.
import {
  DEFAULT_DETECTED_LANG,
  readStoredLang,
  resolvePreferredLang,
  writeStoredLang,
} from '../shared/lang-detect';

import { FeedbackType, Message, Role, isFromAgent, recvModeOf, sendModeOf } from './models/chat-message.model';
import { normalizeLangCode } from './utils/lang.utils';
import { DEFAULT_LOGO_DATA_URI, sendIconFor } from './assets/default-logo';
import { DEFAULT_WIDGET_THEME } from './theme/default-widget-theme';
import { backgroundLuminance, resolveHeaderText } from './theme/header-contrast';

// Aliased where the class already has a member of the same name, so the
// module function and the method stay visually distinct at the call site.
import { sendWithMessage as sendChatMessage, resumePollingIfNeeded, startChatSession, closeChatSession, applyContactAnswer } from './services/chat-conversation.functions';
import { ChatPoller } from './services/chat-poller';
import { ChatInfo } from '../shared/model-query';

import {
  StorageScope,
  buildHistoryKey,
  buildOpenKey,
  buildClearedMarkerKey,
  clearScopedHistories,
  buildStoredHistory,
  loadBestHistory,
  saveHistory,
  removeLocalKey,
  loadContact,
  saveContact,
  clearContact,
  withDocUrls,
} from './services/chat-storage.functions';
// Aliased where the class already has a member of the same name, so the
// module function and the method stay visually distinct at the call site.
import { submitAssistantFeedback as postAssistantFeedback } from './services/chat-feedback.functions';
import {
  buildConfig,
  ChatWidgetConfigResult,
  getStrings as resolveStrings,
  getEffectiveLang as resolveEffectiveLang,
  sanitizeUsername,
} from './services/chat-widget-config.functions';

@Directive()
export abstract class ChatCoreComponent
  implements OnInit, AfterViewInit, OnDestroy, OnChanges
{
  // ============================================================
  // Configuration — plain fields, NOT inputs (see file header).
  // Subclasses re-declare with @Input() whatever they want bindable.
  // ============================================================

  /**
   * The backend this widget talks to, as a base URL.
   *
   * Named envUrl rather than env because two different things wore that word:
   * the *build* environment (prod / dev), which chooses the compiled-in
   * default, and the *host's* choice of backend, which is this. Only the second
   * is a parameter, and it is now the address itself rather than a name we look
   * up — see Settings.setBackendUrl().
   */
  envUrl?: string;

  // userId is gone. It was sent as x-userid on every request and no backend
  // handler read it — cleanOpenAiBody() even stripped the matching body field
  // before the model call — and its only real effect was as a last-resort
  // display name, which is what `username` is for. A parameter that looks like
  // it identifies the visitor and does not is worse than no parameter.
  appId?: string;
  gptId?: string;

  /**
   * Which installation of the widget this is, when a page carries more than
   * one. See StorageScope — it is what keeps two widgets for the same app from
   * sharing a conversation, an open flag and a visitor cache.
   */
  assistantId?: string;

  /**
   * Whether the app has asked for the "was this helpful?" row.
   *
   * false by default, not true. It is the app's setting that decides, and an
   * app with nothing saved has not asked for it — showing it anyway meant every
   * widget collected ratings its owner never turned on, and a setting that is
   * on until you find it and switch it off is not really a setting.
   *
   * applyConfig() only assigns this when the config carries an actual boolean,
   * so "absent" and "false" both land here as false.
   */
  feedbackEnabled: boolean = false;
  /** Empty by default so the localized pack value can supply it — see
   *  initLocalizedTexts(). labelFor() still hard-fallbacks to 'Assistant'. */
  title: string = '';
  mode: 'compact' | 'full' = 'compact';
  render: 'markdown' | 'linkify' = 'markdown';

  logoSrc?: string;
  logoAlt?: string;

  welcomeText: string = '';
  persist: boolean = true;
  storageKey?: string;
  /** Empty means "nobody specified" — resolveStartingLang() then settles it
    *  from the stored preference, the browser, `defaultlang`, then 'en'. A
    *  declared [lang] pre-empts that, but only for a visitor with no stored
    *  preference. */
  lang: string = '';
  translations?: Partial<Record<string, any>>;
  defaultLang?: string;
  username?: string;
  roleLabels?: Partial<Record<Role, string>>;
  roleAvatars?: Partial<Record<Role, string>>;
  roleAvatarImages?: Partial<Record<Role, string>>;
  roleAvatarBg?: Partial<Record<Role, string>>;
  /** The chip behind the header logo. Panel only — see headerIsRound below. */
  headerLogoBg?: string;

  // headerLogoRound / headerLogoInitial are gone from here. They were declared
  // as fields and never read: buildConfig resolves widgetParams.headerLogoRound
  // and .headerLogoInitial, and applyConfig writes the answers onto
  // headerIsRound / headerLogoInitialLocal. Two names for one setting, one of
  // them inert.

  fontFamily?: string;
  fontSize?: string;
  lineHeight?: string;

  /** The widget background, as a host stated it. Declared here rather than only
   *  on each surface so effectiveBackColor below can resolve it once. Both
   *  surfaces re-declare it as their own @Input. */
  backColor?: string;

  /** The message-bubble background, as a host stated it. Here for the same
   *  reason as backColor — see effectiveMessageColor. */
  messageColor?: string;
  autoFocusOnInit: boolean = true;

  // ============================================================
  // View refs
  // ============================================================

  @ViewChild('historyRef') historyRef?: ElementRef<HTMLDivElement>;

  @ViewChildren('msgItem', { read: ElementRef })
  msgItems!: QueryList<ElementRef<HTMLElement>>;

  /** The composer textarea. The base has no composer of its own — subclasses
   *  override this to point at however they render their input. Returning
   *  undefined disables autosize/focus/input-history rather than throwing. */
  get inputRef(): ElementRef<HTMLTextAreaElement> | undefined {
    return undefined;
  }

  /** Wrapper element around the composer, used to reserve scroll padding.
   *  Undefined means "no composer chrome to measure". */
  get composerRef(): ElementRef<HTMLElement> | undefined {
    return undefined;
  }

  protected ro?: ResizeObserver;
  protected msgItemsSub?: Subscription;

  /**
   * Requests still in flight — the SSE streams opened by sendWithMessage() and
   * startChatSession().
   *
   * Tracked because nothing else cancelled them. ngOnDestroy tears down five
   * listeners, the poller, the ResizeObserver and the ViewChildren
   * subscription, but a request left running kept delivering frames into a
   * destroyed component: saveToStorage() writing a conversation nobody is
   * looking at, and detectChanges() throwing ViewDestroyedError on a view that
   * no longer exists.
   *
   * Entries remove themselves when the stream ends — RxJS unsubscribes on
   * complete/error, which runs the teardown registered in track().
   */
  private readonly inFlightRequests = new Set<Subscription>();

  /** Register an in-flight request so ngOnDestroy can cancel it. */
  private track(sub?: Subscription): void {
    if (!sub || sub.closed) return;

    this.inFlightRequests.add(sub);
    sub.add(() => this.inFlightRequests.delete(sub));
  }
  protected scrollRAF?: number;

  // ============================================================
  // State
  // ============================================================

  displayName: string | undefined = undefined;
  description: string | undefined = undefined;
  messages$ = signal<Message[]>([]);
  trackById = (_: number, m: Message) => m.id;

  /** High-water mark for message ids — see nextMessageId(). Seeded from the
   *  restored history in doInit() so a reloaded conversation carries on above
   *  its existing ids rather than colliding with them. */
  msgId = 1;

  /**
   * The one place a message id comes from.
   *
   * Monotonic, and never below anything currently on screen. Both properties
   * matter and neither alone is enough: the counter stops an id being reused
   * after a message is removed (which is how the contact form ended up
   * inheriting the pending bubble's id and being deleted by it), and the
   * high-water check against messages$ stops a counter that has fallen behind
   * — because history was restored, or because an older code path appended
   * without advancing it — from handing out an id that is already taken.
   *
   * Both templates use `trackBy: trackById` on this value, so a duplicate
   * makes Angular reuse the wrong DOM node, and every `arr.map(m => m.id === X)`
   * update lands on whichever it meets first.
   */
  protected nextMessageId(): number {
    const highestOnScreen = this.messages$().reduce((max, m) => Math.max(max, m.id || 0), 0);
    this.msgId = Math.max(this.msgId, highestOnScreen) + 1;
    return this.msgId;
  }

  feedbackModalOpen = false;
  feedbackTargetMessageId: number | null = null;
  feedbackComment = '';
  protected activeAssistantMessageId: number | null = null;

  protected conversationId?: string;

  /** Whatever ChatInfo the last reply's RetEvent carried — round-tripped
   *  back to the backend unchanged on the next request. */
  private chatInfo?: ChatInfo;

  /** Owns the chat-mode poll loop (timer, chatId, cursor, in-flight guard)
   *  — see chat-poller.ts. One instance per component; started from
   *  sendWithMessage() via chat-conversation.functions.ts once a chat-mode
   *  ack carries a chatId, stopped here on every conversation reset. */
  private readonly chatPoller = new ChatPoller();

  /**
   * Which backend a sent message goes to: the model ('model', the default),
   * or the external live-agent system via ChatQueryWorker ('chat') — see
   * ChatModeSelectorComponent, the slim bar shown above the composer/input
   * when this GPT has direct-chat configured (externalChat.external).
   */
  chatMode: 'model' | 'chat' = 'model';

  /** Sanitized externalChat off the loaded WidgetApp — {external, name, type}
   *  or undefined if this GPT has none configured. Read directly off
   *  blueBoot.widgetApp rather than through appOrWp: appOrWp resolves to
   *  widgetParams when present, and externalChat lives on the app itself,
   *  not inside widgetParams. */
  get externalChat(): { external: boolean; name: string; type: string; askForContact?: boolean } | undefined {
    return (this.blueBoot?.widgetApp as any)?.externalChat;
  }


  /** True once a GPT's externalChat is actually turned on — gates whether
   *  ChatModeSelectorComponent renders at all. */
  get chatModeSelectorVisible(): boolean {
    return this.externalChat?.external === true;
  }

  /**
   * Upload limits for this GPT — size, count, accepted types.
   *
   * Read off the loaded WidgetApp for the same reason externalChat is: getApp
   * serves chatLimits on the app itself, not inside widgetParams, so appOrWp
   * (which resolves to widgetParams when present) would miss it.
   *
   * Undefined until the config lands. AttachmentUploadComponent falls back to
   * the same defaults the backend uses, so the control is usable on the first
   * frame and simply tightens if the admin configured something stricter.
   */
  get chatLimits(): {
    uploadEnabled?: boolean;
    maxFileSizeBytes?: number;
    maxFilesPerRequest?: number;
    allowedMimeTypes?: string[];
  } | undefined {
    return (this.blueBoot?.widgetApp as any)?.chatLimits;
  }

  /**
   * Files the visitor has attached to the message being written.
   *
   * The picked files themselves, not descriptors: nothing is uploaded until
   * the message is sent, and then the whole turn goes as multipart to
   * /api/responses/multi, which stores them and describes them server-side.
   *
   * Held on the core rather than in the composer: the composer is redrawn as
   * the widget changes shape, and an attachment belongs to the message, not to
   * the box it was typed in.
   */
  protected pendingAttachments: PickedAttachment[] = [];

  /** The visitor picked a file: show it in the feed, and keep it for the send. */
  onAttachmentPicked(picked: PickedAttachment): void {
    this.pendingAttachments = [...this.pendingAttachments, picked];
    this.pushAttachmentMessage(picked);
  }

  /**
   * A pasted image goes straight to the model.
   *
   * Pasting is already a deliberate act with a subject — the visitor has a
   * screenshot and wants to know about it. Attaching it and then waiting for a
   * second click adds a step that asks them to confirm something they just
   * did.
   *
   * Called after the attachments are in `pendingAttachments`, so the ordinary
   * send path carries them: nothing here knows about files.
   *
   * The message. Whatever is in the box wins — a visitor who typed "why does
   * this fail?" and then pasted the screenshot meant those together.
   *
   * With an empty box it sends a full stop. sendWithMessage() refuses an empty
   * message, so an image alone would go nowhere at all, and something has to
   * stand in. A "." rather than a written-out question because the question
   * would be words this widget put in the visitor's mouth — in one language,
   * needing eighteen translations, and wrong whenever they pasted a screenshot
   * meaning something other than "what is this?". The image is the message;
   * the stop is punctuation.
   */
  protected sendPastedAttachments(): void {
    if (this.isSending) return;
    if (!this.pendingAttachments.length) return;

    const msg = this.userMessage.trim() || '.';

    this.userMessage = '';
    this.onTextareaInput();
    this.sendWithMessage(msg);
  }

  /**
   * Hand over what is waiting to be sent, and forget it.
   *
   * Taken and cleared in one step: these belong to this turn, and leaving them
   * behind would silently re-send them on the next one.
   */
  private takePendingAttachments(): PickedAttachment[] {
    if (!this.pendingAttachments.length) return [];

    const out = this.pendingAttachments;
    this.pendingAttachments = [];
    return out;
  }

  /**
   * Put the attached file in the conversation, as its own message.
   *
   * The visitor did something; the feed is where this widget says what
   * happened. Without it the only acknowledgement is a button that briefly
   * looks pressed, and a file picked but not visibly received reads as a
   * failure — they pick it again.
   *
   * Role 'user' because they attached it, but deliberately no sendMode and no
   * sendStatus: nothing has gone anywhere yet, and either field would claim
   * otherwise. The metadata rides along on `attachments` so that when the
   * upload is wired this message already carries what it needs.
   */
  private pushAttachmentMessage(attachment: PickedAttachment): number {
    const id = this.nextMessageId();

    this.messages$.update(arr => [
      ...arr,
      {
        id,
        role: 'user' as const,
        // No text. The row is drawn by AttachmentListComponent off the
        // `attachments` array below, so the name, type and size are data
        // rather than a sentence — which is what lets the same message render
        // identically in the panel and the embed, and lets a thumbnail be
        // added later without re-parsing a string.
        completed: true,
        timestamp: Date.now(),
        attachments: [
          {
            // The real category, unflattened. QueryAttachment.kind is the same
            // AttachmentKind the picker classified with, so what the visitor
            // sees, what is stored, and what reaches the backend are one value.
            kind: attachment.kind,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
          },
        ],
      },
    ]);

    // The picture, drawn from the visitor's own bytes.
    //
    // Detached rather than awaited: the row is already on screen with its name
    // and size, and decoding a photo takes long enough to be visible. The
    // thumbnail drops in when it is ready, which reads as the image loading —
    // holding the whole row back for it would read as the widget hanging.
    //
    // Downscaled inside makePreviewDataUrl(). The original bytes still go to
    // the backend through the FormData send; this copy exists only to be drawn,
    // and only a small one can survive in localStorage.
    void Promise.all([
        makePreviewDataUrl(attachment.file, attachment.kind),
        makeTextPreview(attachment.file, attachment.mimeType),
    ]).then(([content, previewText]) => {
        // Exactly one of these is ever set — a picture or a snippet, never
        // both — but they resolve together so the row is written once instead
        // of twice.
        // A document produces neither — no thumbnail, no text snippet — and
        // that is not a reason to skip the save. The row still has to be
        // persisted, and saveToStorage() is also what stamps the attachment
        // with its /api/doc address, so returning early here left every PDF
        // and spreadsheet without one.
        if (!content && !previewText) {
            this.saveToStorage();
            return;
        }

        this.messages$.update(arr =>
            arr.map(m =>
                m.id === id && m.attachments?.length
                    ? {
                        ...m,
                        attachments: m.attachments.map(a => ({
                            ...a,
                            ...(content ? { content } : {}),
                            ...(previewText ? { previewText } : {}),
                        })),
                    }
                    : m
            )
        );
        this.saveToStorage();
        this.cdr.detectChanges();
        this.scrollToBottom(true);
    });

    // The conversation may still be empty, in which case the history container
    // does not exist yet and a signal update has nothing to paint into — see
    // beginPendingBubble()'s note. Same reason, same fix.
    this.showSuggestions = false;
    this.saveToStorage();
    this.cdr.detectChanges();
    this.scrollToBottom(true);

    return id;
  }

  /**
   * Switches which backend the next message goes to.
   *
   * chatInfo/chatId is intentionally kept across the switch rather than
   * dropped: a visitor going model → chat → model → chat again should land
   * back in the same external chat session, not mint a new one every time
   * they toggle — getOrCreateSession() (chat-session-store.ts) resumes
   * whatever chatId it's handed rather than creating fresh, so keeping it
   * here is what makes that resumption actually happen on the next send.
   * The message history itself is left alone either way.
   *
   * Polling is left running across the switch, in either direction — never
   * stopped just because the visitor toggled away from 'chat'. Stopping it
   * on every switch away and restarting it on every switch back would mean
   * a visitor bouncing model → chat → model → chat could miss a live reply
   * that arrived while they were on the model side, and would needlessly
   * re-fetch/re-resume on every single toggle. resumeChatPollingFromHistory()
   * reconciles instead: it (re)starts polling whenever chatInfo has a
   * chatId (a no-op if already polling it) and stops it when there isn't
   * one — so calling it here on every toggle, regardless of direction,
   * always leaves polling in the right state.
   */
  setChatMode(mode: 'model' | 'chat'): void {
    if (this.chatMode === mode) return;

    this.chatMode = mode;
    this.resumeChatPollingFromHistory();
    // Stored here rather than only on the next send: a visitor who switches to
    // chat and then reloads before typing anything must not come back on the
    // model side while a thread is already open for them.
    this.saveToStorage();
  }

  /**
   * Bound directly to the mode selector's (modeChange)/(chatModeChange)
   * output — i.e. an actual click on the "chat" tab — rather than folded
   * into setChatMode() itself. setChatMode() is a plain state setter that
   * anything (a future restore-from-storage, programmatic mode sync, etc.)
   * can call safely; the session-creating ack must never fire from one of
   * those, only from the visitor themselves picking chat mode.
   *
   * Picking chat always sends the request. The backend decides whether that
   * opens a session, resumes one, or asks for contact details first — and
   * whether a welcome comes back. Never a client-side condition.
   */
  onChatModeSelected(mode: 'model' | 'chat'): void {
    this.setChatMode(mode);
    if (mode !== 'chat') return;

    // No conditions. Picking chat always sends the request, whether or not a
    // session already exists — the backend opens one or resumes one, and
    // either way answers with the welcome if that setting is on.
    //
    // Every version of a client-side condition here has been wrong. First it
    // was `isFirstTimeIntoChat`, three questions folded into one flag used to
    // decide whether to act at all; then it was a "rejoin quietly" branch that
    // sent nothing. Both leave the visitor clicking a button that does
    // nothing. The widget reports what it knows (seedContactFromMemory) and
    // renders what it is told to (startChatSession's next: handler) — what
    // should happen is not its judgement to make.
    this.openChatSession();
  }

  /**
   * Take a chatInfo from the backend, keeping the details the visitor gave us.
   *
   * Everything in a server chatInfo is authoritative except who the visitor is.
   * chatId, contactAsked and the rest are the session's own facts and are
   * adopted as sent. The name and contact details are not: the visitor typed
   * them into this widget, they are in this browser's storage, and the server's
   * copy is only ever an echo of what we told it earlier.
   *
   * Without this, an echo carrying older details overwrote newer ones and the
   * widget then sent the old values back on its next turn — at which point the
   * backend merged them over the new ones and reverted itself. The edit lost,
   * every turn, with only the message label still showing the new name because
   * that is read from storage rather than from chatInfo.
   *
   * Not applied when they declined: seedContactFromMemory() explains why —
   * "we remember you" must never override "do not send my details".
   */
  private adoptChatInfo(value: ChatInfo | undefined): void {
    this.chatInfo = value;

    if (!value || this.contactDeclined) return;

    const remembered = this.rememberedContact;
    const name = remembered?.name?.trim();
    const info = remembered?.info?.trim();
    if (!name && !info) return;

    this.chatInfo = {
      ...(value ?? {}),
      ...(name ? { visitorName: name } : {}),
      ...(info ? { contactInfo: info } : {}),
    };
  }

  /**
   * Put details remembered from an earlier conversation onto chatInfo, so they
   * travel with the request that opens the session.
   *
   * The remembered cache is localStorage-only, so without this "we already
   * know them" meant nothing was sent: the agent got an anonymous thread and
   * the welcome had nothing to report. Recognising someone has to mean using
   * what we remember.
   *
   * Sent whenever we have it, with no client-side conditions: the widget's job
   * is to report what it knows, and the backend decides what to do with it —
   * whether to store it, relay it to the agent, or mention it in the welcome.
   * Splitting that judgement across both ends is how the two drift apart.
   */
  private seedContactFromMemory(): void {
    // They just chose "Send without info". Remembering someone must not
    // override them declining right now — seeding here would put details back
    // that the visitor had explicitly opted out of sending, which is worse
    // than never having remembered them at all.
    if (this.contactDeclined) return;

    if (this.chatInfo?.visitorName || this.chatInfo?.contactInfo) return;

    const remembered = this.rememberedContact;
    if (!remembered?.name && !remembered?.info) return;

    this.chatInfo = {
      ...(this.chatInfo ?? {}),
      ...(remembered.name ? { visitorName: remembered.name } : {}),
      ...(remembered.info ? { contactInfo: remembered.info } : {}),
    };
  }

  /**
   * Wording for a backend progress stage, in the visitor's language.
   *
   * The backend sends only a stage code. These strings never vary by
   * conversation, so they belong in the widget's i18n rather than being
   * written server-side — same reasoning as the contact form's field labels.
   */
  private chatStatusText(stage: 'connecting' | 'opening' | 'waiting'): string {
    if (stage === 'opening') {
      return (this.t('chatStatusOpening') || '').trim() || 'Setting up the conversation';
    }
    if (stage === 'waiting') {
      return (this.t('chatStatusWaiting') || '').trim() || 'Almost there';
    }
    return (this.t('chatStatusConnecting') || '').trim() || 'Connecting you to a person';
  }

  /** Create the live-agent session. Split out of onChatModeSelected() so the
   *  contact form can defer it without duplicating the call. */
  private openChatSession(): void {
    // Opening a live session is a conversation getting under way, exactly as
    // much as typing a message is — and sendWithMessage() was the only place
    // lifting the cleared marker. A visitor who cleared the chat, switched to
    // a human and then reloaded before typing anything came back to a wiped
    // widget, with the agent still holding an open thread on the other end.
    if (this.isClearedGlobal()) this.unmarkClearedGlobal();

    // Before the request, not after — this is what makes the thread open
    // already naming the visitor.
    this.seedContactFromMemory();

    this.track(startChatSession({
      appId: this.appId,
      gptId: this.gptId,
      conversationId: this.ensureConversationId(),
      chatPoller: this.chatPoller,
      // The welcome this request triggers is written before the visitor has
      // typed anything, so there is nothing for the model to read a language
      // from. This is that language.
      lang: this.lang,
      // May already carry visitorName/contactInfo from the contact form, even
      // though there is no chatId yet — that's the point of passing it.
      chatInfo: this.chatInfo,
      statusText: stage => this.chatStatusText(stage),
      setChatInfo: value => {
        this.adoptChatInfo(value);
      },
      setActiveAssistantMessageId: value => {
        this.activeAssistantMessageId = value;
      },
      messages$: this.messages$,
      nextMessageId: () => this.nextMessageId(),
      saveToStorage: () => this.saveToStorage(),
      detectChanges: () => this.cdr.detectChanges(),
      scrollNow: () => this.scrollToBottom(true),
      focusInput: () => this.focusInput(),
    }));
  }

  /**
   * The current conversation's id. Does NOT mint one — startConversationId()
   * is the only thing that does, at the two moments a conversation begins.
   *
   * The fallback exists because the return type is non-optional and a request
   * with no id would be worse than an invented one; reaching it means a
   * conversation started somewhere that didn't say so, which is a bug, hence
   * the log line rather than a silent recovery.
   */
  protected ensureConversationId(): string {
    if (!this.conversationId) {
      console.warn('[chat] conversationId requested before the conversation started — minting late');
      this.startConversationId();
    }
    return this.conversationId!;
  }

  /**
   * Everything the widget can say for itself, from the compiled-in packs, for
   * the language resolveStartingLang() just settled.
   *
   * The single place this is done: title, welcomeText, translations,
   * suggestions and the info/thinking lines are all seeded here, once per
   * doInit() run. Nothing else in this file re-seeds them from the packs —
   * doInitApp() and onAppConfigAttemptFailed() still call
   * applyEmbeddedContentFallback() on their own, but that fills only whatever
   * the app config left empty, which is a different job from this initial seed.
   */
  protected initLocalizedTexts() {
    const pack = pickLang(DEFAULT_UI_TRANSLATIONS, this.lang, this.defaultLang);

    // Localized title/welcomeText, straight from the compiled-in packs, for
    // the language just resolved above.
    this.setTitle(pack['title'] || '');
    this.welcomeText = pack['welcomeText'] || '';
    this.titleFromPack = true;
    this.welcomeFromPack = true;

    // `this.translations` is deliberately left alone here: it means "the
    // host's own [translations] override", nothing else. strings() already
    // falls back to this same compiled-in pack on its own when neither the
    // host nor the backend supplies a key, so seeding it here would make the
    // pack look like a host override and let it outrank real backend
    // translations (wp.translations) — the opposite of the intended
    // precedence (backend overrides local default; never the reverse).

    this.suggestions = [...(pickLang(DEFAULT_SUGGESTIONS, this.lang, DEFAULT_LANG) || [])];

    const info = pickLang(DEFAULT_INFO_TEXT, this.lang, DEFAULT_LANG);
    this.infoText.info = [...(info?.info || [])];
    this.infoText.infoThink = [...(info?.infoThink || [])];

    // The send-button icon: a compiled-in data URI, so it is ready on the first
    // frame rather than waiting on getApp(). Re-seeded here so a re-init (a
    // language switch, or a new appId) is not left showing whatever the
    // previous run chose. applyConfig() runs it again once the config resolves,
    // because the message colour it is picked against may come from there.
    this.sendIconReady = sendIconFor(this.effectiveMessageColor);
  }

  /**
   * True while title / welcomeText still hold a value we seeded from the string
   * packs rather than one the host supplied. buildConfig is then passed '' for
   * them, so the pack default for the *effective* language wins instead of a
   * stale seed from whatever language was active at startup.
   */
  protected titleFromPack = false;
  protected welcomeFromPack = false;

  /**
   * A title declared by the host, which nothing else may overwrite.
   *
   * Two other sources write this.title, and both write it more than once: the
   * string packs seed it in initLocalizedTexts() and again on every language
   * change, and applyConfig() replaces it whenever getApp() resolves. A plain
   * @Input assigned at mount would be clobbered by either — which is precisely
   * what the host asking for a fixed title is asking not to happen.
   *
   * So it is kept separately and applied through setTitle(), which every writer
   * goes through. Precedence is then a property of the one function rather than
   * a race between callers.
   *
   * Empty means unset: a host that wants no title at all is asking for the
   * default, not for a blank bar.
   */
  protected titleOverride = '';

  /**
   * The single writer for this.title.
   *
   * Callers pass what their own source resolved to; the override wins if there
   * is one. Kept as a method rather than a setter on `title` because `title` is
   * read all over the templates and a setter that silently ignores assignment
   * is the kind of thing that costs someone an afternoon.
   */
  protected setTitle(value: string): void {
    const forced = (this.titleOverride || '').trim();
    this.title = forced || value;
  }

  /**
   * The language codes this build actually ships strings for.
   *
   * The one argument the widget adds to every lang-detect call, and the only
   * thing about a language this component knows that shared-library cannot —
   * so it is asked for in seven places. A getter rather than a field because
   * the answer is derived, not stored.
   */
  private get supportedLangs(): string[] {
    return Object.keys(DEFAULT_UI_TRANSLATIONS);
  }

  /**
   * The host declared a language, so the visitor does not get to change it.
   *
   * Set by resolveStartingLang() and read by the header to drop the picker.
   * A field rather than a getter on `this.lang`: after resolution `lang` is
   * always set, so by the time the header renders there is nothing left in it
   * to distinguish "the site asked for Norwegian" from "we worked out
   * Norwegian". This records which of the two it was, at the one moment the
   * difference is still visible.
   */
  protected langLocked = false;

  /**
   * The host's declared language, if it named one and we ship it.
   *
   * Empty when unset — which is why the surfaces default the input to '' rather
   * than DEFAULT_LANG: with the built-in default sitting in the field there is
   * no way to tell "the site asked for English" from "the site said nothing",
   * and the second must not outrank the visitor's browser.
   */
  protected get declaredLang(): string {
    const code = normalizeLangCode(this.defaultLang || '', '');
    return code && this.supportedLangs.includes(code) ? code : '';
  }

  // `lang` has exactly two writers, and no guarded setter between them:
  // resolveStartingLang() settles it at mount, and applyVisitorLang() changes
  // it when the visitor asks — or when the panel reopens and the stored
  // preference has moved under us (refreshLangOnShow). applyConfig() does not
  // touch it.

  /**
   * The language the chain currently resolves to: stored preference → browser
   * → the tag's `defaultlang` → 'en'.
   *
   * A getter and not a one-off, because it is asked twice — once at mount and
   * again whenever the panel becomes visible — and the two must be the same
   * question. Reading it has no side effects; nothing is stored.
   *
   * The stored preference is both the visitor's own pick from this widget's
   * picker and whatever the host page's language menu wrote: one key, one
   * meaning — what language this visitor reads this product in. A visitor who
   * picked a language has stated a preference about *this site*; the browser's
   * list is a default they may never have looked at. Rendering the widget in
   * English inside a page the visitor has just set to Norwegian is the widget
   * disagreeing with the page it is embedded in.
   *
   * Validated against the packs we ship: `supported` is the only thing this
   * component knows that shared-library cannot, so a stale or hand-edited code
   * cannot select a language with no strings behind it.
   *
   * `defaultlang` is passed as the FALLBACK rather than checked before the
   * browser, which is what its name says it is: the language for a visitor
   * whose own browser asked for nothing we ship. It used to sit above the
   * browser, so a site with defaultlang="en" showed English to a visitor whose
   * browser had asked for Norwegian — the site's default overruling a
   * preference the visitor did express, just not in our storage.
   *
   * 'en' is the last resort when the tag declares nothing either:
   * DEFAULT_DETECTED_LANG, not the widget's DEFAULT_LANG ('no'), because at
   * that point we know nothing about this person and English leaves the most of
   * them able to read the panel. DEFAULT_LANG stays what it is for pack
   * selection, where "the product's own language" is the right meaning.
   */
  private get resolvedLang(): string {
    return resolvePreferredLang({
      supported: this.supportedLangs,
      fallback: this.declaredLang || DEFAULT_DETECTED_LANG,
    });
  }

  /**
   * Re-resolve the language each time the panel becomes visible.
   *
   * The widget mounts once and then sits closed, often for the whole visit,
   * while the page around it keeps going. `preferredLang` is one shared key —
   * the host site's own language menu writes it too — so by the time the
   * visitor opens the panel, the answer settled at mount can be stale: someone
   * switches the site to Norwegian, opens the chat, and gets the English it
   * decided on before they chose.
   *
   * remember: false, and that matters. Nothing here is a visitor decision —
   * re-resolving is us re-reading the same signals — and writing the result
   * back would turn a browser-derived default into a stored preference, which
   * is precisely what stops the chain looking at the browser again. Only the
   * picker writes storage.
   *
   * A declared [lang] is not revisited: it won outright at mount and it wins
   * here too. applyVisitorLang() returns immediately when the code has not
   * changed, so the common case costs one localStorage read.
   */
  private refreshLangOnShow(): void {
    if (this.langLocked) return;

    this.applyVisitorLang(this.resolvedLang, false);
  }

  /**
   * Settle `lang` at mount — see resolvedLang for the chain.
   *
   * Synchronous: nothing blocks here and getApp() is issued immediately.
   *
   * Only ever writes into an empty `lang`, so a declared [lang] survives.
   * Because this settles `lang` before the app config arrives,
   * widgetParams.lang / defaultLang do not steer the active language.
   *
   * Not the last word, as it once was: refreshLangOnShow() asks the same
   * question again whenever the panel becomes visible, because the stored
   * preference is shared with the host page and can move while the widget sits
   * closed.
   */
  protected resolveStartingLang(): void {
    // A declared [lang] wins outright — first priority, ahead of a stored
    // preference and everything else.
    //
    // It says what language this embed speaks, which is the site's decision
    // and not a starting point for the visitor to move. That is also why
    // langLocked hides the picker: leaving the control there would invite a
    // visitor to contradict the embed, and because a pick is remembered it
    // would keep contradicting it on every later visit — the widget and the
    // page permanently disagreeing, with the markup looking ignored.
    //
    // A site that wants its visitors to choose declares no lang, and then the
    // whole chain below applies.
    if (this.lang) {
      this.langLocked = true;
      return;
    }

    this.lang = this.resolvedLang;
  }

  // applyIpLangIfDifferent() was here: a late, asynchronous switch to the
  // language the visitor's IP suggested. The country lookup it depended on is
  // gone (see lang-detect.ts for what it cost and what it bought), so there is
  // nothing to arrive late any more.
  //
  // What that means for the rest of this class: resolveStartingLang() is now
  // the whole story. The language is settled once, synchronously, before
  // getApp() is issued, and nothing after mount changes it except the visitor
  // using the picker. The `remember: false` path through applyVisitorLang()
  // existed only for this caller.

  /**
   * Switch to a language and re-derive everything that depends on it.
   *
   * The single path for changing language, taken by the picker in the header
   * and by geo detection alike. They must have one answer: an earlier version
   * had the logic inline in the offer's accept handler, and adding a second
   * entry point meant either duplicating five careful steps or calling a method
   * named for the offer from a control that is not one.
   *
   * Everything a language touches is re-derived here, in order, because a
   * partial switch is worse than none — a widget showing German chrome around
   * a Norwegian welcome message looks broken in a way that neither language
   * alone would.
   *
   * @param remember whether to persist this as the visitor's own choice. True
   *   for the picker; false for detection, which is a guess that must stay free
   *   to answer differently on the next page — and which must never write the
   *   stored code, since a stored code is itself what stops detection running.
   */
  protected applyVisitorLang(code: string, remember = true): void {
    const next = normalizeLangCode(code || '', '');
    if (!next || next === this.lang) return;

    this.lang = next;

    // Remembered for the next load, in the one shared key every surface reads —
    // and only for a real decision. Storage is left entirely untouched for a
    // detected language: writing it would look like a choice to the next load,
    // and clearing it would throw away a choice made earlier that detection
    // happens to disagree with today.
    //
    // This is also the only place the widget writes a language. Everything
    // that reads one reads the same key through lang-detect.
    if (remember) writeStoredLang(next, { supported: this.supportedLangs });

    // Anything seeded from the packs is now in the wrong language.
    this.initLocalizedTexts();

    // Re-run the config load so buildConfig resolves title, welcomeText,
    // suggestions and info lines against the new language. The payload itself
    // is language-independent, so this costs nothing over the wire — the cache
    // answers it — but the *choosing* happens in buildConfig, and only a
    // re-run redoes it.
    this.reloadAppConfigForLang();
    this.cdr.markForCheck();
  }

  /**
   * The picker's choice.
   *
   * The choice is recorded even when the language does not change.
   * applyVisitorLang() returns early in that case — correctly, there is nothing
   * to re-derive — but "I want the one I already have" is still an answer, and
   * it is the only answer available to the visitor reading German in France
   * whose location keeps switching them to French. Recording it is what stops
   * detection overriding them on the next page.
   */
  chooseLang(code: string): void {
    const next = normalizeLangCode(code || '', '');
    if (!next) return;

    // Before applyVisitorLang(), which writes the same key again on a real
    // change. Two writes of one value, in exchange for the flag being set on
    // the path where the language does not move at all.
    writeStoredLang(next, { supported: this.supportedLangs });

    this.applyVisitorLang(next);
  }

  /**
   * Re-derives the widget's text for the language just switched to.
   *
   * getApp() is language-independent — see BluebootClient.cacheKey(), which
   * never includes lang — so there is nothing new to fetch: this.blueBoot
   * already holds whatever config was last loaded, and doInitApp() just
   * re-runs buildConfig against the now-current this.lang to pick the right
   * title, welcome text, suggestions and info lines. No network call, no new
   * BluebootClient — a fresh instance would only force a same-app media
   * refetch for no benefit, since media is never cached.
   *
   * Only if nothing has loaded yet (the visitor switched language before the
   * very first getApp() resolved) does this fall back to the normal load
   * path, reusing the existing client rather than building a new one.
   */
  protected reloadAppConfigForLang(): void {
    const app = this.blueBoot?.widgetApp;

    if (app) {
      this.doInitApp(app);
      this.cdr.markForCheck();
      return;
    }

    const runId = ++this.initRunId;

    this.appConfigState = 'pending';
    this.appConfigAttempt = 0;

    if (this.blueBoot) {
      // A cached config was served instantly; if the background refresh finds
      // it has changed, re-apply so the visitor sees the new wording this load.
      this.blueBoot.onRefresh = (app) => {
        if (runId !== this.initRunId) return;
        this.zone.run(() => {
          this.doInitApp(app);
          this.cdr.markForCheck();
        });
      };
    }

    this.loadAppConfig(runId);
    this.loadAppMedia(runId);
  }

  userMessage = '';
  isSending = false;
  copiedIndex: number | null = null;
  protected copyTimer: any;

  protected inputHistory: string[] = [];
  protected inputHistoryIndex = -1;
  protected inputHistoryDraft = '';

  selectionActionVisible = false;
  selectionActionX = 0;
  selectionActionY = 0;
  protected selectedAssistantText = '';

  protected readonly onSelectionMouseUp = () => this.updateSelectionAction();
  protected readonly onSelectionKeyUp = () => this.updateSelectionAction();
  protected readonly onDocumentSelectionChange = () => this.updateSelectionAction();
  protected readonly onWindowResize = () => this.hideSelectionAction();
  protected readonly onWindowScroll = () => this.hideSelectionAction();

  protected hasInitialized = false;
  protected initRunId = 0;

  /**
   * Where the getApp() call stands: 'pending' until it succeeds, then 'loaded'.
   *
   * There is no 'failed' state: initLocalizedTexts() already seeded title,
   * welcomeText, suggestions and the info lines from the compiled-in packs
   * before getApp() was even issued, so the widget is fully usable from the
   * first frame. (Not `translations` — that field means "the host's own
   * override" and initLocalizedTexts() leaves it alone on purpose; strings()
   * falls back to the same packs on its own.)
   *
   * If getApp() never succeeds — every retry exhausted —
   * onAppConfigAttemptFailed() does nothing further: no error notice, no state
   * flip, no re-applied fallback. A late success still wins whenever it does
   * land; nothing here forecloses that.
   */
  protected appConfigState: 'pending' | 'loaded' = 'pending';

  /**
   * Per-attempt deadlines for getApp(), in order.
   *
   * BluebootClient has no timeout of its own, so a hung request never settles
   * — without a deadline the widget would wait forever. The first is short so
   * the visitor gets working content quickly; the retry is long because by then
   * the compiled-in defaults are already on screen and nothing is blocked, so
   * patience costs nothing.
   *
   * Add entries to retry further; the last one is the final attempt.
   */
  protected readonly APP_CONFIG_TIMEOUTS_MS = [4000, 15000];

  private appConfigTimer?: any;
  private appConfigAttempt = 0;

  /**
   * Issues getApp() with the current attempt's deadline.
   *
   * A late success still wins: doInitApp() overwrites whatever the fallback put
   * in place, so a slow backend eventually replaces the defaults rather than
   * being ignored.
   */
  protected loadAppConfig(runId: number): void {
    const idx = Math.min(this.appConfigAttempt, this.APP_CONFIG_TIMEOUTS_MS.length - 1);

    clearTimeout(this.appConfigTimer);
    this.appConfigTimer = setTimeout(
      () => this.zone.run(() => this.onAppConfigAttemptFailed(runId)),
      this.APP_CONFIG_TIMEOUTS_MS[idx],
    );

    this.blueBoot?.getApp('text')
      .then((res) => {
        clearTimeout(this.appConfigTimer);
        if (runId !== this.initRunId) return;

        const app = res ? this.blueBoot?.widgetApp : undefined;

        if (app) {
          this.doInitApp(app);
          this.appConfigState = 'loaded';
          this.cdr.markForCheck();
          return;
        }

        // Reached the backend but got nothing usable — same outcome, for
        // content purposes, as never reaching it.
        this.onAppConfigAttemptFailed(runId);
      })
      .catch((e) => {
        clearTimeout(this.appConfigTimer);
        this.onAppConfigAttemptFailed(runId);
        console.error(e);
      });
  }

  /**
   * Fetches the media half — logos, robot art, avatars, video.
   *
   * Always a real request: this half is never cached, because it is the part
   * that can be large and the part that must not go stale. Fire-and-forget and
   * off the retry schedule — imagery arriving late is a cosmetic loss, unlike
   * the text, so it gets one attempt and no fallback.
   *
   * The result merges into widgetApp, so re-running doInitApp picks up the
   * imagery without disturbing the wording already applied.
   */
  protected loadAppMedia(runId: number): void {
    this.blueBoot?.getApp('media')
      .then((ok) => {
        if (!ok || runId !== this.initRunId) return;

        const app = this.blueBoot?.widgetApp;
        if (!app) return;

        this.zone.run(() => {
          this.doInitApp(app);
          this.cdr.markForCheck();
        });
      })
      .catch(() => {
        // Imagery is optional; the widget stays on whatever it already has.
      });
  }

  /**
   * One attempt gave up — from a rejection, an unusable payload, or its
   * deadline. Retries with the next (longer) deadline; once every attempt is
   * spent, this does nothing further.
   *
   * Deliberately makes no changes to the widget: initLocalizedTexts() already
   * put compiled-in content on screen before getApp() was ever issued, so
   * there is nothing to fall back to here, no state to flip, and no notice to
   * show. A late success still applies normally via doInitApp() whenever it
   * lands — this function's only job is retrying, or giving up quietly.
   */
  protected onAppConfigAttemptFailed(runId: number): void {
    if (runId !== this.initRunId) return;
    if (this.appConfigState === 'loaded') return;

    const next = this.appConfigAttempt + 1;
    if (next >= this.APP_CONFIG_TIMEOUTS_MS.length) return;

    this.appConfigAttempt = next;
    this.loadAppConfig(runId);
  }

  /**
   * Fills suggestions and the info/thinking lines from the compiled-in packs,
   * for whatever is still empty.
   *
   * Runs on both outcomes, which is what makes widgetParams the source of truth
   * and the packs the backstop:
   *
   *   - after doInitApp(), so an app that returned no suggestions of its own
   *     still gets a usable set rather than an empty strip;
   *   - after a failed load, so the widget is usable with no config at all.
   *
   * "Still empty" is exact rather than approximate: doInitApp assigns
   * suggestions and infoText unconditionally from the config, so a language
   * change resets them first and this refills them in the new language.
   *
   * Writes to the component's own state rather than into widgetParams: with no
   * app loaded, `appOrWp` returns a fresh {} on every read, so mutating it is
   * discarded.
   */
  protected applyEmbeddedContentFallback(): void {
    const lang = resolveEffectiveLang(this.lang);

    if (!this.suggestions?.length) {
      this.suggestions = [...(pickLang(DEFAULT_SUGGESTIONS, lang, DEFAULT_LANG) || [])];
    }

    const info = pickLang(DEFAULT_INFO_TEXT, lang, DEFAULT_LANG);

    if (!this.infoText.info.length) {
      this.infoText.info = [...(info?.info || [])];
    }

    if (!this.infoText.infoThink.length) {
      this.infoText.infoThink = [...(info?.infoThink || [])];
    }
  }

  suggestions: string[] = [];

  showSuggestions: boolean | undefined = true;

  infoText = {
    infoIdx: 0,
    thinkIdx: 0,
    info: [] as string[],
    infoThink: [] as string[],
  };

  /**
   * The header logo chip: its shape, and whether an initial stands in when no
   * logo is set. Resolved from widgetParams.headerLogoRound / headerLogoInitial
   * in buildConfig and written here by applyConfig.
   *
   * Panel only in effect, with headerLogoBg above. app-chat-header is the only
   * thing that reads them, and only chat.component.html renders it — the embed
   * has no logo in its title bar at all, by design: it sits inside a host
   * page's own look rather than putting a branded band over it. They live on
   * the base because applyConfig writes them, not because both surfaces use
   * them; wiring them into the embed would need a chip to put them on first.
   */
  headerIsRound = true;
  headerLogoInitialLocal = true;

  protected blueBoot: BluebootClient | undefined;

  protected cachedLogoDataUrl?: string;
  protected cachedAvatarDataUrl: Partial<Record<Role, string>> = {};
  protected avatarBlobUrls: Partial<Record<Role, string>> = {};
  protected imgPolicy = { checked: false, dataOk: true, blobOk: true };

  /**
   * The send-button mark. Fixed: always one of the two compiled-in marks, never
   * anything a setting can write — see sendIconFor in core/assets/default-logo.
   *
   * Ready on the first frame rather than after getApp(). This field default
   * covers the render before ngOnInit runs; initLocalizedTexts() picks it at
   * the start of every doInit() and applyConfig() picks it again, both because
   * the message colour it is chosen against can arrive late.
   *
   * The bare constant here rather than sendIconFor(): a field initializer runs
   * before the inputs are set, so there is no background to choose against yet.
   */
  sendIconReady: string = DEFAULT_LOGO_DATA_URI;

  protected apiFontFamily?: string;
  protected apiFontSize?: string;
  protected apiLineHeight?: string;

  // Storage, feedback, widget-config and conversation orchestration are all
  // plain module functions (see ./services/*.functions.ts) — every one of
  // them was a stateless service with nothing to inject.
  protected cdr = inject(ChangeDetectorRef);


  constructor(
    protected zone: NgZone,
    protected elementRef: ElementRef<HTMLElement>,
  ) {
    // Settings.setBackendUrl(this.envUrl) used to be here and did nothing
    // useful: Angular has not assigned inputs at construction, so `envUrl` is
    // always undefined and the call took the "nothing supplied" branch.
    // Harmless alone, but on a page with two widgets it reset a sibling that
    // *had* supplied a backend.
    //
    // It is applied in ngOnInit instead, where the input exists — and only
    // there. It is deliberately not re-applied on change: the backend is fixed
    // for the life of the page (see Settings.backendLocked), because swapping
    // it under a running conversation leaves history, attachments and any live
    // agent session split across two servers.
  }

  // ============================================================
  // Typography
  // ============================================================

  protected applyTypographyVars() {
    try {
      const hostEl = this.elementRef.nativeElement as HTMLElement;
      const ff = (this.fontFamily?.trim() || this.apiFontFamily?.trim() || '');
      const fs = (this.fontSize?.trim() || this.apiFontSize?.trim() || '');
      const lh = (this.lineHeight?.trim() || this.apiLineHeight?.trim() || '');

      if (ff) hostEl.style.setProperty('--bb-font-family', ff);
      // --bb-font-size-base, not --bb-font-size: the host's own stylesheet
      // (chat.component.css / embed.component.css) derives the effective
      // --bb-font-size from that base — 1:1 on desktop, scaled up under a
      // mobile @media rule — so the mobile bump stays relative to whatever
      // the base is, this value included, rather than only applying when
      // nothing was ever set.
      if (fs) hostEl.style.setProperty('--bb-font-size-base', fs);
      if (lh) hostEl.style.setProperty('--bb-line-height', lh);
    } catch {}
  }

  // ============================================================
  // Storage keys
  // ============================================================

  /** The identity every storage key for this instance is scoped to.
   *  Not user-scoped — see the note on StorageScope. */
  protected get storageScope(): StorageScope {
    return { appId: this.appId, gptId: this.gptId, assistantId: this.assistantId };
  }

  protected getKey(): string {
    if (this.storageKey) return this.storageKey;
    return buildHistoryKey(this.storageScope);
  }

  protected getOpenKey(): string {
    return buildOpenKey(this.storageScope);
  }

  protected rememberOpen(isOpen: boolean) {
    try {
      localStorage.setItem(this.getOpenKey(), isOpen ? '1' : '0');
    } catch {}
  }

  protected clearedMarkerKeyGlobal(): string {
    return buildClearedMarkerKey(this.storageScope);
  }

  protected markClearedGlobal() {
    try {
      localStorage.setItem(this.clearedMarkerKeyGlobal(), '1');
    } catch {}
  }

  protected unmarkClearedGlobal() {
    try {
      localStorage.removeItem(this.clearedMarkerKeyGlobal());
    } catch {}
  }

  protected isClearedGlobal(): boolean {
    try {
      return localStorage.getItem(this.clearedMarkerKeyGlobal()) === '1';
    } catch {
      return false;
    }
  }

  protected clearAllHistoriesForAppGpt() {
    clearScopedHistories(this.storageScope);
  }

  // ============================================================
  // Input history
  // ============================================================

  protected clearInputHistory() {
    this.inputHistory = [];
    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';
  }

  protected rememberInputHistory(value: string) {
    const v = String(value || '').trim();
    if (!v) return;

    if (this.inputHistory[this.inputHistory.length - 1] !== v) {
      this.inputHistory.push(v);
      if (this.inputHistory.length > 50) this.inputHistory.shift();
    }

    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';
  }

  protected rebuildInputHistoryFromMessages(messages: Message[]): string[] {
    const out: string[] = [];

    for (const m of messages) {
      if (m.role !== 'user') continue;

      const v = String(m.content || '').trim();
      if (!v) continue;
      if (out[out.length - 1] !== v) out.push(v);
    }

    return out;
  }

  protected setComposerValue(value: string) {
    this.userMessage = value;

    requestAnimationFrame(() => {
      this.onTextareaInput();
      const ta = this.inputRef?.nativeElement;
      if (!ta) return;

      const pos = ta.value.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  protected handleInputHistoryKey(e: KeyboardEvent): boolean {
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
    if (!this.inputHistory.length) return false;

    const ta = this.inputRef?.nativeElement;
    if (!ta) return false;
    if (ta.selectionStart !== ta.selectionEnd) return false;

    const value = this.userMessage || '';
    const pos = ta.selectionStart ?? 0;

    if (e.key === 'ArrowUp') {
      if (this.inputHistoryIndex === -1 && pos !== 0) return false;
      e.preventDefault();

      if (this.inputHistoryIndex === -1) {
        this.inputHistoryDraft = value;
        this.inputHistoryIndex = this.inputHistory.length - 1;
      } else if (this.inputHistoryIndex > 0) {
        this.inputHistoryIndex -= 1;
      }

      this.setComposerValue(this.inputHistory[this.inputHistoryIndex] || '');
      return true;
    }

    if (this.inputHistoryIndex === -1) return false;
    e.preventDefault();

    if (this.inputHistoryIndex < this.inputHistory.length - 1) {
      this.inputHistoryIndex += 1;
      this.setComposerValue(this.inputHistory[this.inputHistoryIndex] || '');
    } else {
      const draft = this.inputHistoryDraft;
      this.inputHistoryIndex = -1;
      this.inputHistoryDraft = '';
      this.setComposerValue(draft);
    }

    return true;
  }

  // ============================================================
  // Text selection -> "use text"
  // ============================================================

  protected getActiveSelection(): Selection | null {
    const root = this.elementRef.nativeElement.shadowRoot as any;
    return root?.getSelection?.() || document.getSelection?.() || window.getSelection?.() || null;
  }

  protected nodeElement(node: Node | null): HTMLElement | null {
    if (!node) return null;
    if (node instanceof HTMLElement) return node;
    return node.parentElement;
  }

  protected hideSelectionAction() {
    this.selectionActionVisible = false;
    this.selectedAssistantText = '';
  }

  protected updateSelectionAction() {
    requestAnimationFrame(() => {
      const root = this.elementRef.nativeElement.shadowRoot;
      const sel = this.getActiveSelection();

      if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        this.zone.run(() => this.hideSelectionAction());
        return;
      }

      const text = String(sel.toString() || '').trim();
      if (!text) {
        this.zone.run(() => this.hideSelectionAction());
        return;
      }

      const startEl = this.nodeElement(sel.anchorNode);
      const endEl = this.nodeElement(sel.focusNode);

      if (!startEl || !endEl || !root.contains(startEl) || !root.contains(endEl)) {
        this.zone.run(() => this.hideSelectionAction());
        return;
      }

      // One class now, not two: both surfaces render the same message component
      // and it carries the embed's names. The panel's '.msg.ai' went with the
      // markup it belonged to.
      const startMsg = startEl.closest('.msg-assistant');
      const endMsg = endEl.closest('.msg-assistant');

      // The body, so a selection that strays into the name line or the feedback
      // row is not offered as text to reuse.
      //
      // This asked for '.text' until now, and no element in the widget has ever
      // carried that class — the body renders as .msg-body. Both of these were
      // therefore always null and the popup could not appear on either surface.
      const startText = startEl.closest('.msg-body');
      const endText = endEl.closest('.msg-body');

      if (!startMsg || !endMsg || startMsg !== endMsg || !startText || !endText) {
        this.zone.run(() => this.hideSelectionAction());
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (!rect || (!rect.width && !rect.height)) {
        this.zone.run(() => this.hideSelectionAction());
        return;
      }

      // .selection-action is position:absolute against :host (see
      // chat.component.css), not position:fixed against the browser
      // window — so its coordinates must be relative to this panel's own
      // box, not the viewport. getBoundingClientRect() on both the
      // selection and the host itself are in the same (viewport) space;
      // subtracting the host's origin converts into the host's own space.
      const hostRect = this.elementRef.nativeElement.getBoundingClientRect();

      let x = (rect.left - hostRect.left) + (rect.width / 2);
      let y = (rect.top - hostRect.top) - 42;

      if (y < 8) y = (rect.bottom - hostRect.top) + 8;
      x = Math.max(56, Math.min(hostRect.width - 56, x));

      this.zone.run(() => {
        this.selectedAssistantText = text;
        this.selectionActionX = x;
        this.selectionActionY = y;
        this.selectionActionVisible = true;
      });
    });
  }

  useSelectedAssistantText() {
    const text = String(this.selectedAssistantText || '').trim();
    if (!text) return;

    const next = this.userMessage.trim()
      ? `${this.userMessage.replace(/\s+$/, '')}\n\n${text}`
      : text;

    this.setComposerValue(next);

    try {
      this.getActiveSelection()?.removeAllRanges();
    } catch {}

    this.hideSelectionAction();
    this.focusInput();
  }

  applySuggestionText(s: string) {
    this.userMessage = s;

    requestAnimationFrame(() => {
      this.onTextareaInput();
      this.focusInput();
    });
  }

  // ============================================================
  // i18n
  // ============================================================

  protected getEffectiveLang(): string {
    return resolveEffectiveLang(this.lang);
  }

  protected strings(): Record<string, string> {
    return resolveStrings(
      this.appOrWp,
      this.lang,
      this.defaultLang,
      this.translations
    );
  }



  t(key: string): string {
    const s = this.strings();
    return (s && (s as any)[key]) || '';
  }

  get dir(): 'ltr' | 'rtl' {
    const rtl = ['ar', 'fa', 'ur', 'he'];
    return rtl.includes(this.getEffectiveLang()) ? 'rtl' : 'ltr';
  }

  // ============================================================
  // Backend identity
  // ============================================================

  /** Backend base URL used to construct BluebootClient, shared by every bot
   *  variant. Resolved from `envurl` — see Settings.setBackendUrl(), which
   *  latches the first one supplied for the life of the page. */
  protected resolveBackendUrl(): string {
    return Settings.resolveBackendUrl();
  }


  // ============================================================
  // History persistence
  // ============================================================

  protected loadFromStorage() {
    // Files waiting to be sent belong to the conversation being left behind.
    this.pendingAttachments = [];

    // The id this widget is already carrying, if any. loadFromStorage() runs
    // once per doInit(), and doInit() runs again whenever appId/gptId/
    // storageKey change (ngOnChanges) — which with a web component is routine:
    // the host page sets those attributes after the element upgrades, so the
    // first run happens under a placeholder storage key and the second under
    // the real one. Dropping the id on every run meant the second run found
    // nothing cached (different key) and minted a *second* id, changing the
    // conversation's identity moments after it began.
    //
    // Carried forward instead: a conversation that has already started keeps
    // its id across a re-init, and is re-persisted below under whatever key is
    // now current. newConversation() is the only place that changes it, and it
    // clears the field itself before calling in.
    const carriedConversationId = this.conversationId;

    this.messages$.set([]);
    this.contactDeclined = false;
    this.conversationId = carriedConversationId;
    this.chatInfo = undefined;
    this.chatMode = 'model';
    this.chatPoller.stop();
    this.activeAssistantMessageId = null;
    this.inputHistory = [];
    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';

    if (this.isClearedGlobal()) {
      this.clearAllHistoriesForAppGpt();
      this.startConversationId();
      return;
    }

    let loadedMessages: Message[] = [];
    let loadedInputHistory: string[] = [];

    const data = loadBestHistory(this.getKey());

    if (data) {
      const cid = String(data?.conversationId || '').trim();
      if (cid) this.conversationId = cid;

      if (Array.isArray(data?.messages)) {
        loadedMessages = data.messages as Message[];
      }

      if (Array.isArray(data?.inputHistory)) {
        loadedInputHistory = data.inputHistory
          .map(x => String(x || '').trim())
          .filter(Boolean);
      }

      // Restored, not left cleared above: a chat-mode conversation with a
      // live chatId needs this back so resumeChatPollingFromHistory() (rule
      // 1/2 — see chat-poller.ts) has something to check and can pick the
      // poll loop back up instead of the chat going silent until the
      // visitor happens to send another message.
      if (data?.chatInfo?.chatId) {
        this.chatInfo = data.chatInfo;
      }

      // Put them back on the side they were talking to. Assigned directly
      // rather than through setChatMode(): this is a restore, and the poller
      // reconciliation setChatMode() would trigger is about to run anyway in
      // doInit()'s resumeChatPollingFromHistory(). Only honoured with a live
      // chatId — chat mode without a session is a mode the visitor can
      // re-enter themselves, and restoring it would suppress the contact
      // form and the welcome that opening one is supposed to produce.
      if (data?.chatMode === 'chat' && this.chatInfo?.chatId) {
        this.chatMode = 'chat';
      }
    }

    if (loadedMessages.length > 0) {
      this.messages$.set(loadedMessages);
    }

    this.inputHistory = loadedInputHistory.length
      ? loadedInputHistory
      : this.rebuildInputHistoryFromMessages(loadedMessages);

    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';

    // Nothing restored one, so this widget is opening on a conversation that
    // does not exist yet. Mint it here — see startConversationId().
    this.startConversationId();

    try {
      const wasOpen = localStorage.getItem(this.getOpenKey()) === '1';
      if (wasOpen) requestAnimationFrame(() => this.scrollToBottomNow());
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Give this conversation its id, and write it down.
   *
   * Called from exactly two places, and nowhere else: opening the widget with
   * nothing restored from cache, and starting a new conversation. Those are
   * the only two moments a conversation actually begins.
   *
   * It used to be minted lazily, by ensureConversationId() at the moment a
   * request needed one, and not persisted until some later save. That made the
   * id a property of the request rather than of the conversation: a widget
   * opened with no cache minted a fresh one on every click, so nothing
   * server-side could recognise two clicks as the same conversation. Now that
   * getOrCreateSession() resolves an existing session by conversationId, that
   * meant a new session — a new agent thread — each time.
   *
   * Persisted immediately, before any request can carry it, so a reload finds
   * the same conversation rather than inventing another.
   *
   * The save runs even when an id is already in hand. A re-init (see the note
   * in loadFromStorage()) carries the existing id over to a new storage key,
   * and without writing it there the id would be in memory only — lost on the
   * next reload, which is the same "invented another conversation" bug taking
   * one step longer to show up.
   */
  private startConversationId(): void {
    if (!this.conversationId) this.conversationId = newConversationId();
    this.saveToStorage();
  }

  /**
   * Ask the backend to delete the files stored for a conversation.
   *
   * Sent when the conversation ends. The bucket's 90-day rule would get there
   * eventually, but "eventually" is the wrong answer to someone who has just
   * cleared a chat: they said they were done with it, and their documents
   * should not outlive that by three months.
   *
   * keepalive, because this can be the last thing the widget does. A visitor
   * who clears the chat and immediately closes the tab would otherwise have the
   * request cancelled mid-flight — keepalive is what lets the browser finish
   * sending it after the page is gone.
   *
   * Errors are swallowed on purpose. This is housekeeping the visitor never
   * sees, they have already moved on to an empty conversation, and a failure
   * costs nothing that the lifecycle rule will not fix.
   */
  protected wipeConversationFiles(conversationId: string): void {
    if (!conversationId || !this.appId) return;

    try {
      const url = `${Settings.queryBase()}/api/doc/${encodeURIComponent(conversationId)}`;

      void fetch(url, {
        method: 'DELETE',
        headers: { 'x-appid': this.appId },
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Never throws into the caller: newConversation() must complete whatever
      // happens here, or the visitor is left in a conversation they asked to
      // end.
    }
  }

  protected saveToStorage() {
    if (!this.persist) return;

    // Where a stored attachment can be reached. Needed in two places and
    // knowable in neither of them: the storage module cannot see Settings, and
    // the URL depends on the app this widget is.
    const docCtx = { appId: this.appId, baseUrl: Settings.queryBase() };

    // Stamp the *live* messages first, so the conversation on screen knows
    // where its files went — that is what lets the feed link to a document and
    // fall back to the stored copy for a thumbnail. Doing this only inside
    // buildStoredHistory() wrote the address into the localStorage copy alone,
    // where nothing rendering the feed could see it until a reload.
    //
    // withDocUrls() returns the same array when it changed nothing, so this is
    // a no-op write on the overwhelming majority of saves rather than a model
    // update on every one.
    const stamped = withDocUrls(this.messages$(), this.conversationId, docCtx);
    if (stamped !== this.messages$()) this.messages$.set(stamped);

    // buildStoredHistory() then drops the bytes from its own copy: the live
    // message keeps `content` for an instant preview, the persisted one carries
    // only the address.
    const payload = buildStoredHistory(
      this.conversationId,
      [...this.messages$()],
      [...this.inputHistory],
      this.chatInfo,
      this.chatMode,
      docCtx
    );

    saveHistory(this.getKey(), payload);
  }

  // ============================================================
  // Scrolling
  // ============================================================

  /**
   * The bottom is the right place in a conversation, and the wrong place before
   * one has started.
   *
   * Opening with the welcome text and the suggestions on screen, the newest
   * thing is not at the bottom — the greeting is at the top, and the chips
   * below it are a list to read from the beginning. A suggestion list long
   * enough to scroll would otherwise open already scrolled past the greeting,
   * showing the visitor the tail of a list they have not seen the start of.
   *
   * Only while the suggestions are actually up: the first message sets
   * showSuggestions false before the pending bubble exists, and that moment is
   * already a conversation even though messages$ is briefly still empty.
   */
  private get scrollAnchorIsTop(): boolean {
    return this.isEmpty && !!this.showSuggestions;
  }

  protected scrollToBottomNow() {
    const el = this.historyRef?.nativeElement;
    if (!el) return;

    el.scrollTop = this.scrollAnchorIsTop ? 0 : el.scrollHeight;
  }

  protected scrollToBottom(immediate = false) {
    const el = this.historyRef?.nativeElement;
    if (!el) return;

    if (this.scrollAnchorIsTop) {
      el.scrollTop = 0;
      return;
    }

    if (immediate) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    if (this.scrollRAF) cancelAnimationFrame(this.scrollRAF);

    this.scrollRAF = requestAnimationFrame(() =>
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    );
  }

  protected scrollSoon() {
    if (this.scrollRAF) cancelAnimationFrame(this.scrollRAF);
    this.scrollRAF = requestAnimationFrame(() => this.scrollToBottom());
  }

  protected scrollOnNextOpen() {
    requestAnimationFrame(() => requestAnimationFrame(() => this.scrollToBottomNow()));
  }

  // ============================================================
  // Conversation lifecycle
  // ============================================================

  /**
   * Whether the "this will end the live chat" confirmation is showing.
   * Only ever true while a live-agent session actually exists.
   */
  newChatConfirmOpen = false;

  /**
   * Entry point for the "new conversation" control — what the templates call.
   *
   * Starting a new conversation while a live chat is open is destructive in a
   * way the visitor cannot see: closeChatSession() ends the session on the
   * agent's side, so anything they were part-way through typing is delivered
   * to nobody, and the visitor is never told. That is worth one question.
   *
   * With no live session there is nothing to lose that a normal chat history
   * clear does not already imply, so it goes straight through — a confirm on
   * every new chat would just train people to dismiss it.
   */
  requestNewConversation(): void {
    if (this.chatInfo?.chatId) {
      this.newChatConfirmOpen = true;
      return;
    }
    this.newConversation();
  }

  confirmNewConversation(): void {
    this.newChatConfirmOpen = false;
    this.newConversation();
  }

  cancelNewConversation(): void {
    this.newChatConfirmOpen = false;
  }

  newConversation() {
    this.hideSelectionAction();
    this.contactDeclined = false;
    // Picked but never sent — they belonged to the conversation being cleared.
    this.pendingAttachments = [];
    this.clearInputHistory();
    this.messages$.set([]);
    this.userMessage = '';

    // Tell the backend the visitor is done with this chat-mode session
    // before wiping the very chatInfo that request needs — closeChatSession()
    // no-ops on its own if there was never a chat-mode session to close.
    if (this.chatInfo?.chatId) {
      closeChatSession({
          appId: this.appId,
        gptId: this.gptId,
        conversationId: this.ensureConversationId(),
        chatInfo: this.chatInfo,
      });
    }

    // Forget the visitor's uploaded files, before the id that addresses them
    // goes. Read first for exactly that reason: two lines down there is no way
    // left to say which conversation's files these were.
    //
    // Not awaited. The visitor asked to start a new chat, and that should
    // happen at once rather than behind a bucket round trip; the request is
    // fire-and-forget and the 90-day lifecycle rule catches anything it misses.
    const endingConversationId = this.conversationId;
    if (endingConversationId) this.wipeConversationFiles(endingConversationId);

    this.conversationId = undefined;
    this.chatInfo = undefined;
    this.chatPoller.stop();
    this.activeAssistantMessageId = null;

    // A fresh conversation always starts on the model side — chat mode (and
    // its session) belonged to the conversation just cleared, not to
    // whatever gets typed next. setChatMode() (not a raw field assignment)
    // so polling state stays consistent with the mode.
    this.setChatMode('model');

    if (this.persist) {
      removeLocalKey(this.getKey());
      removeLocalKey(this.getOpenKey());
    }

    this.markClearedGlobal();
    this.clearAllHistoriesForAppGpt();
    // Deliberately NOT clearing the remembered contact details here. This is
    // newConversation(), and "start a new chat" must not mean "type your phone
    // number again" — which is the whole point of remembering them, since the
    // form only ever reappears in a new conversation. clearContact() exists for
    // a real "forget me" action if one is ever added.
    this.rememberOpen(false);

    // Last, after the wipe above — a conversation has just begun, and this is
    // the second (and only other) place that starts one. Minting it before
    // removeLocalKey() would only write it out and immediately delete it.
    this.startConversationId();

    this.showSuggestions = true;
    this.scrollSoon();
    this.focusInput();
  }

  // ============================================================
  // Images / avatars
  // ============================================================

  protected async detectImgPolicy(): Promise<void> {
    if (this.imgPolicy.checked) return;

    const testImg = (src: string) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
      });

    const dataSvg =
      'data:image/svg+xml;base64,' +
      btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`);

    this.imgPolicy.dataOk = await testImg(dataSvg);

    const blobUrl = URL.createObjectURL(new Blob(['x'], { type: 'text/plain' }));
    this.imgPolicy.blobOk = await testImg(blobUrl);

    try {
      URL.revokeObjectURL(blobUrl);
    } catch {}

    this.imgPolicy.checked = true;
  }

  protected async dataImageToBlobUrl(dataUrl: string): Promise<string | undefined> {
    try {
      const res = await fetch(dataUrl);
      if (!res.ok) return undefined;

      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return undefined;
    }
  }

  protected async applyAvatar(role: Role, src: string) {
    const s = (src || '').trim();
    if (!s) return;

    if (!s.startsWith('data:image/')) {
      this.zone.run(() => {
        this.cachedAvatarDataUrl[role] = s;
      });
      return;
    }

    await this.detectImgPolicy();

    if (this.imgPolicy.dataOk) {
      this.zone.run(() => {
        this.cachedAvatarDataUrl[role] = s;
      });
      return;
    }

    if (this.imgPolicy.blobOk) {
      const blobUrl = await this.dataImageToBlobUrl(s);

      if (blobUrl) {
        const prev = this.avatarBlobUrls?.[role];

        if (prev) {
          try {
            URL.revokeObjectURL(prev);
          } catch {}
        }

        this.avatarBlobUrls[role] = blobUrl;

        this.zone.run(() => {
          this.cachedAvatarDataUrl[role] = blobUrl;
        });
      }
    }
  }

  // ============================================================
  // App config
  // ============================================================

  /**
   * Applies a loaded app config. Split into the four things it does, in order:
   * resolve, apply, load media, settle the view.
   */
  doInitApp(app: WidgetApp) {
    const config = this.buildConfigFor(app);

    this.applyConfig(config);
    this.loadConfigMedia(config);

    // The config has had its say. Anything it left empty falls back to the
    // compiled-in packs, in the language now active.
    this.applyEmbeddedContentFallback();
    this.restoreScrollPosition();
  }

  private buildConfigFor(app: WidgetApp) {
    return buildConfig({
      app,

      currentTitle: this.titleFromPack ? '' : this.title,
      currentWelcomeText: this.welcomeFromPack ? '' : this.welcomeText,
      currentDisplayName: this.displayName,
      currentDescription: this.description,

      lang: this.lang,
      defaultLang: this.defaultLang,

      username: this.username,

      roleAvatars: this.roleAvatars,
      roleAvatarImages: this.roleAvatarImages,


    });
  }

  /** Everything the config decides, copied onto the component. */
  private applyConfig(config: ChatWidgetConfigResult) {
    if (typeof config.feedbackEnabled === 'boolean') {
      this.feedbackEnabled = config.feedbackEnabled;
    }

    this.apiFontFamily = config.apiFontFamily;
    this.apiFontSize = config.apiFontSize;
    this.apiLineHeight = config.apiLineHeight;

    this.applyTypographyVars();
    requestAnimationFrame(() => this.applyTypographyVars());

    this.displayName = config.displayName;
    this.description = config.description;

    // config.lang is deliberately NOT applied. The app's configured language
    // says what its CONTENT is written in — it is not a statement about the
    // person reading it, and the interface language is decided entirely by
    // resolveStartingLang(): stored preference, browser, the tag's
    // defaultlang, 'en'.
    //
    // This assignment used to be here, and it is the thing not to put back:
    // getApp() resolves after mount, so a language the visitor had picked
    // showed for a moment and was then replaced by the app's configured one.
    // this.translations is deliberately left alone: it holds only a genuine
    // host [translations] override (or nothing). strings() recomputes the full
    // pack/backend/host merge on every call from this.appOrWp +
    // this.translations, so writing a merged snapshot back onto it would freeze
    // stale copy in place of live backend data on any later re-render. That is
    // why buildConfig no longer returns translations at all.

    // titleFromPack / welcomeFromPack stay as they are: config.title may itself
    // be a pack default, and a later language change must re-resolve it rather
    // than pin this language's wording.
    //
    // buildConfig() already falls through to the compiled pack when
    // widgetParams has nothing for this language — this is the same rule
    // embed and the launcher's chat panel both get, since they share this
    // method. The trim() check below is a second, cheap guarantee of that
    // exact rule right here, using the same pickLang()/DEFAULT_UI_TRANSLATIONS
    // call initLocalizedTexts() seeds from, so "blank or none from the
    // backend" can never survive as an actually-blank title/welcome text.
    const fallbackPack = pickLang(DEFAULT_UI_TRANSLATIONS, this.lang, this.defaultLang);
    // Through setTitle(), so a host-declared title survives the config landing.
    // This is the assignment that used to undo it: getApp() resolves after
    // mount, so a plain @Input would show for a moment and then be replaced by
    // the backend's own wording.
    this.setTitle((config.title && config.title.trim()) ? config.title : (fallbackPack['title'] || config.title));
    this.welcomeText = (config.welcomeText && config.welcomeText.trim()) ? config.welcomeText : (fallbackPack['welcomeText'] || config.welcomeText);

    this.suggestions = config.suggestions;

    // The app's own status lines win whenever it has any, and each half is
    // decided separately — an app may set `info` and leave `infoThink` to the
    // default.
    //
    // Assigned only when non-empty, rather than assigned unconditionally and
    // refilled afterwards by applyEmbeddedContentFallback(). That worked, but
    // only because the two ran in the right order: for a moment the app's
    // configured lines were replaced by an empty array, and anything that read
    // or re-seeded infoText in between got the compiled default instead of the
    // app's wording. Never overwriting a real value removes the window.
    if (config.info?.length) {
      this.infoText.info = config.info;
    }

    if (config.infoThink?.length) {
      this.infoText.infoThink = config.infoThink;
    }

    // Only when the host said nothing: an explicit attribute outranks the app.
    if (!this.roleLabels && config.roleLabels) {
      this.roleLabels = config.roleLabels;
    }

    this.headerIsRound = config.headerIsRound;
    this.headerLogoInitialLocal = config.headerLogoInitialLocal;
    this.headerLogoBg = config.headerLogoBg;

    this.username = config.username;

    // Not from the config — the mark is fixed. Re-picked here only because the
    // message colour it is chosen against may have arrived with the config.
    this.sendIconReady = sendIconFor(this.effectiveMessageColor);
  }

  /**
   * Logo and avatars, applied once.
   *
   * This used to set each source, then call BbImgCacheMini.ensure() and set it
   * a second time from the result — "shown immediately, then swapped for the
   * cached copy". Two things killed that: the cache has been short-circuited
   * by its own HISTORY_ONLY flag for some time, so ensure() resolved to the
   * value it was handed; and get-app now serves storage URLs instead of
   * inlined base64, so there is nothing left worth caching in localStorage.
   * A URL is a few dozen bytes, and the image behind it is cached by the
   * browser under the `immutable`, one-year header it is served with — which
   * is a better cache than this was, shared across every site the widget runs
   * on rather than rebuilt per origin.
   *
   * So each source is set once, from the config, and the second pass is gone.
   */
  private loadConfigMedia(config: ChatWidgetConfigResult) {
    const logo = config.logoCandidate;
    if (logo && this.cachedLogoDataUrl !== logo) {
      this.cachedLogoDataUrl = logo;
    }

    (['user', 'assistant', 'error'] as Role[]).forEach(role => {
      const url = config.avatarUrls[role];
      if (url) this.applyAvatar(role, url);
    });
  }

  private restoreScrollPosition() {
    const isOpen = localStorage.getItem(this.getOpenKey()) === '1';

    if (isOpen) requestAnimationFrame(() => this.scrollToBottomNow());
  }

  /**
   * The app/gpt/assistant this widget last initialised for, as one string.
   *
   * Empty until the first doInit(). Compared on every later one to tell two
   * very different re-inits apart — see resetForIdentityChange().
   */
  private lastInitIdentity = '';

  private identityKey(): string {
    return `${this.appId || ''}|${this.gptId || ''}|${this.assistantId || ''}`;
  }

  /**
   * A re-init is not always a new assistant, and the difference matters.
   *
   * Two things cause doInit() to run again:
   *
   *   1. The host filling in attributes after the element upgraded. The first
   *      run had no appId; the second has the real one. This is one widget
   *      settling, and a conversation begun in the meantime must survive —
   *      which is exactly what loadFromStorage()'s carriedConversationId does.
   *   2. The widget being pointed at a *different* app. Nothing about the
   *      previous one should survive: not the conversation, not the visitor's
   *      chat session, not the cached config.
   *
   * Told apart by whether the previous identity had a real appId. Without this
   * the carry-forward in loadFromStorage() applies to both, and app B opens
   * holding app A's conversation id — reading app A's history out of storage
   * and continuing its chat session against a different assistant.
   */
  private resetForIdentityChange(): void {
    this.conversationId = undefined;
    this.messages$.set([]);
    this.chatInfo = undefined;
    this.chatMode = 'model';
    this.chatPoller.stop();
    this.activeAssistantMessageId = null;

    // doInit() replaces this a few lines further down, but clear it here all
    // the same: between the two, reloadAppConfigForLang() and everything else
    // reading blueBoot?.widgetApp would otherwise still see the previous app.
    this.blueBoot = undefined;

    // Anything the previous app configured — title, welcome, suggestions,
    // info lines — goes back to the packs until the new config lands, rather
    // than showing the old app's wording while it loads. titleOverride is left
    // alone: a title the host declared belongs to the host, not to the app.
    this.titleFromPack = true;
    this.welcomeFromPack = true;
  }

  async doInit() {
    const runId = ++this.initRunId;

    // Before anything else: is this the same assistant settling, or a new one?
    const identity = this.identityKey();
    const previous = this.lastInitIdentity;
    const previousHadApp = !!previous && !previous.startsWith('|');

    this.lastInitIdentity = identity;

    if (previousHadApp && previous !== identity) {
      this.resetForIdentityChange();
    }

    this.clearInputHistory();
    this.hideSelectionAction();

    // Settle the language before anything talks to the backend, so getApp()
    // and every downstream request carry the final value. Synchronous, and
    // final: nothing after this point changes the language except the visitor
    // choosing one.
    this.resolveStartingLang();
    this.initLocalizedTexts();

    // resolveStartingLang() ran above, so this.lang is settled — the backend
    // sees the language the widget is actually rendering in.
    this.blueBoot = new BluebootClient(
      this.resolveBackendUrl(),
      this.appId,
      this.gptId
    );

    // A cached config was served instantly; if the background refresh finds it
    // has changed, re-apply so the visitor sees the new wording this load.
    this.blueBoot.onRefresh = (app) => {
      if (runId !== this.initRunId) return;
      this.zone.run(() => {
        this.doInitApp(app);
        this.cdr.markForCheck();
      });
    };

    // Cache, applied before getApp() is even called: a hit inside getApp()
    // itself would apply just as well, but only a tick later, from inside the
    // promise it returns. Peeking here means cached title, welcome text,
    // suggestions and logo are on screen synchronously, in this same pass —
    // loadAppConfig() below still runs its normal course (cache-refresh,
    // network fetch, or retry) and re-applies via doInitApp() if anything
    // about it actually changed.
    const cachedApp = this.blueBoot.peekCachedApp();
    if (cachedApp) this.doInitApp(cachedApp);

    this.appConfigState = 'pending';
    this.appConfigAttempt = 0;
    this.loadAppConfig(runId);
    this.loadAppMedia(runId);

    if (runId !== this.initRunId) return;

    this.applyTypographyVars();
    requestAnimationFrame(() => this.applyTypographyVars());

    this.loadFromStorage();
    if (runId !== this.initRunId) return;

    // Rule 2 — "always try to start when the widget gets active": this is
    // the widget's own activation (a fresh load/reload), immediately after
    // loadFromStorage() restored whatever chatInfo the last session left —
    // rule 1 inside resumePollingIfNeeded() means this does nothing at all
    // when there's no chatId to resume.
    this.resumeChatPollingFromHistory();

    this.showSuggestions = this.messages$().length === 0;

    const arr = this.messages$();
    const maxId = arr.reduce((max, m) => Math.max(max, m.id || 0), 0);

    this.msgId = maxId || 0;
  }

  // ============================================================
  // Angular lifecycle
  // ============================================================

  ngOnInit() {
    this.hasInitialized = true;
    Settings.setBackendUrl(this.envUrl);
    // doInit() resolves the language and seeds the localized text itself —
    // see initLocalizedTexts().
    this.doInit();
  }

  /**
   * Which inputs mean "this is a different assistant now" — reload the config.
   *
   * `assistantId` and `envUrl` belong here alongside the obvious two:
   * assistantId decides the storage scope (history, open flag, remembered
   * contact), so a change without a re-init leaves the widget reading another
   * assistant's state, and envUrl changes which backend answers at all.
   *
   * The camel-spelled entries are not decoration. Each parameter is offered in
   * two spellings — lowercase for HTML, camelCase for an Angular template — and
   * Angular allows one alias per member, so the second spelling is a setter on
   * a *separate* property (appIdCamel and friends, on the embed, the launcher
   * and the panel).
   *
   * SimpleChanges is keyed by the property name, never by the alias. So a host
   * using the camelCase spelling produced a change under `appIdCamel`, the
   * setter dutifully assigned `this.appId` — and this method, testing only
   * `appId`, concluded nothing had changed. The value was right and the config
   * was never fetched: no title, no colours, no suggestions from settings, the
   * widget quietly showing its compiled-in defaults instead.
   *
   * Listed rather than pattern-matched on a "Camel" suffix: a list is greppable
   * from the setters it depends on, and a convention is one rename away from
   * failing the same silent way.
   */
  private static readonly REINIT_INPUTS = [
    'appId', 'appIdCamel',
    'gptId', 'gptIdCamel',
    'assistantId', 'assistantIdCamel',
    'envUrl', 'envUrlCamel',
    'storageKey',
  ];

  ngOnChanges(changes: SimpleChanges) {
    if (changes['fontFamily'] || changes['fontSize'] || changes['lineHeight']) {
      this.applyTypographyVars();
      requestAnimationFrame(() => this.applyTypographyVars());
    }

    if (!this.hasInitialized) return;

    if (ChatCoreComponent.REINIT_INPUTS.some(k => changes[k])) {
      this.doInit();
    }
  }

  ngAfterViewInit() {
    this.applyTypographyVars();
    requestAnimationFrame(() => this.applyTypographyVars());

    if (this.autoFocusOnInit) this.focusInput();

    const host = this.elementRef.nativeElement;
    const root = host.shadowRoot;

    root?.addEventListener('mouseup', this.onSelectionMouseUp as EventListener);
    root?.addEventListener('keyup', this.onSelectionKeyUp as EventListener);
    document.addEventListener('selectionchange', this.onDocumentSelectionChange as EventListener);
    window.addEventListener('resize', this.onWindowResize, true);
    window.addEventListener('scroll', this.onWindowScroll, true);


    if (this.mode === 'compact') {
      this.scrollToBottom(true);

      this.msgItemsSub = this.msgItems?.changes.subscribe(() => {
        const isOpen = localStorage.getItem(this.getOpenKey()) === '1';

        if (isOpen) this.scrollToBottom();
      });

      if (this.composerRef) {
        this.ro = new ResizeObserver(() => {
          const h = this.composerRef!.nativeElement.offsetHeight || 0;
          const el = this.historyRef?.nativeElement;

          if (el) el.style.scrollPaddingBottom = `${h + 8}px`;
        });

        this.ro.observe(this.composerRef.nativeElement);
      }
    } else {
      this.scrollSoon();
    }

    host.addEventListener('bbc-opened', () => {
      this.rememberOpen(true);
      this.scrollOnNextOpen();

      // Before anything that renders: a language change re-seeds the string
      // packs and re-runs buildConfig, so doing it first means the panel the
      // visitor is about to see is already in the right language rather than
      // switching under them a frame later.
      this.refreshLangOnShow();

      // Rule 2, the other activation point: the visitor opening a launcher
      // panel that's been sitting dormant. Re-checks history rather than
      // trusting whatever ChatPoller was left doing — a no-op if it's
      // already correctly polling, but picks a stale/never-started poller
      // back up otherwise.
      this.panelHidden = false;
      this.resumeChatPollingFromHistory();
      // ...and if the poller was merely paused (panel collapsed rather than
      // conversation ended) it still holds its chatId, so resume() puts it
      // straight back to work. resumeChatPollingFromHistory() can't: start()
      // no-ops on the chatId it's already holding.
      this.chatPoller.resume();

      this.applyTypographyVars();
      requestAnimationFrame(() => this.applyTypographyVars());
    });

    host.addEventListener('bbc-closed', () => {
      this.rememberOpen(false);
      // Collapsed to the launcher button: still a live conversation, just
      // nobody looking at it. pause() (not stop()) keeps the chatId so
      // reopening resumes the same chat — and releases the long poll's open
      // request and its server-side Firestore listener meanwhile.
      this.panelHidden = true;
      this.chatPoller.pause();
    });

    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // ViewChild refs (composerRef, historyRef) are set during ngAfterViewInit.
    // Trigger a second change detection pass so bindings that depend on them
    // (e.g. [composerEl]="composerRef?.nativeElement") don't throw NG0100.
    this.cdr.detectChanges();
  }

  /**
   * Whether the launcher panel is collapsed. Tracked as its own field rather
   * than read back from the remembered-open storage key, because an embedded
   * (always-visible) widget never sets that key at all — and would then never
   * be considered visible enough to resume.
   */
  private panelHidden = false;

  /**
   * Backgrounded tab / minimised window: suspend the poll loop, resume when
   * the visitor comes back.
   *
   * Worth doing for its own sake — browsers throttle timers in hidden tabs,
   * so a loop left running there is unreliable anyway — but it matters much
   * more with long polling, where a hidden widget otherwise holds an open
   * request and a live server-side Firestore listener for as long as the tab
   * stays in the background.
   *
   * Nothing is missed while suspended: the poll endpoint keeps no cursor, so
   * the first request after resuming returns every unread message at once.
   */
  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.chatPoller.pause();
    } else if (!this.panelHidden) {
      // resume() polls immediately rather than waiting out an interval, so a
      // reply that landed while the tab was hidden shows up as the visitor
      // returns to it.
      this.chatPoller.resume();
    }
  };

  ngOnDestroy() {
    clearTimeout(this.appConfigTimer);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    // Nothing else stops the poll loop when the widget is torn down — the
    // other stop() calls are all on conversation-lifecycle paths
    // (newConversation, loadFromStorage, mode switch), none of which run on
    // destroy. Without this the loop outlives the component, and with long
    // polling each orphaned cycle also holds an open request and a live
    // Firestore listener on the server for up to 25s.
    this.chatPoller.stop();

    // Cancel anything still streaming. Without this an in-flight SSE request
    // outlives the component and keeps calling back into it — saveToStorage()
    // on a conversation nobody is looking at, and detectChanges() on a
    // destroyed view, which throws ViewDestroyedError.
    this.inFlightRequests.forEach(sub => sub.unsubscribe());
    this.inFlightRequests.clear();


    if (this.msgItemsSub) this.msgItemsSub.unsubscribe();
    if (this.ro) this.ro.disconnect();
    if (this.scrollRAF) cancelAnimationFrame(this.scrollRAF);

    const root = this.elementRef.nativeElement.shadowRoot;

    root?.removeEventListener('mouseup', this.onSelectionMouseUp as EventListener);
    root?.removeEventListener('keyup', this.onSelectionKeyUp as EventListener);
    document.removeEventListener('selectionchange', this.onDocumentSelectionChange as EventListener);
    window.removeEventListener('resize', this.onWindowResize, true);
    window.removeEventListener('scroll', this.onWindowScroll, true);

    (['user', 'assistant', 'error'] as Role[]).forEach(role => {
      const u = this.avatarBlobUrls?.[role];

      if (u) {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      }
    });

    this.avatarBlobUrls = {};
  }

  // ============================================================
  // Composer
  // ============================================================

  public focusInput() {
    requestAnimationFrame(() => this.inputRef?.nativeElement?.focus());
  }

  onTextareaInput() {
    const ta = this.inputRef?.nativeElement;
    if (!ta) return;

    if (this.messages$().length === 0) {
      this.showSuggestions = true;
    }

    ta.style.height = '';
    ta.style.overflowY = 'hidden';

    if (!this.userMessage.trim()) {
      return;
    }

    ta.style.height = 'auto';

    const max = this.composerMaxHeight((this.mode === 'full') ? 420 : 360);
    const next = Math.min(ta.scrollHeight, max);

    ta.style.height = next + 'px';
    ta.style.overflowY = (ta.scrollHeight > max) ? 'auto' : 'hidden';
  }

  /**
   * The message box's growth cap, bounded by the window.
   *
   * A flat pixel cap is a cap on the box and not on the widget: the widget also
   * carries a conversation above the box and, in the panel, a header — so a box
   * allowed 420px could put the whole thing past the bottom of a short window
   * or a small embedding frame. The box was pinned to one line until recently,
   * which is why this never came up.
   *
   * A third of the viewport, floored at two or three lines so a very short
   * window still leaves something worth typing in. `preferred` stays the
   * ceiling — this only ever lowers it.
   */
  protected composerMaxHeight(preferred: number): number {
    const viewport = typeof window === 'undefined' ? 0 : (window.innerHeight || 0);
    if (!viewport) return preferred;

    return Math.min(preferred, Math.max(96, Math.round(viewport / 3)));
  }

  onComposerKeydown(e: KeyboardEvent) {
    if (this.handleInputHistoryKey(e)) return;

    if (e.key === 'Enter' && !e.shiftKey && !this.isSending) {
      e.preventDefault();
      this.send();
    }
  }

  send() {
    const msg = this.userMessage.trim();
    if (!msg || this.isSending) return;

    this.userMessage = '';
    this.onTextareaInput();
    this.sendWithMessage(msg);
  }

  protected sendWithMessage(msg: string) {
    if (!msg || this.isSending) return;

    const conversationId = this.ensureConversationId();

    // Whatever the visitor attached since the last send goes out with this
    // message. Taken and cleared in the same step: they belong to this turn,
    // and leaving them behind would silently re-send them on the next one.
    const pending = this.takePendingAttachments();

    this.track(sendChatMessage({
      msg,
      // The files themselves. Their presence routes this send to
      // /api/responses/multi — see subscribeResponse().
      files: pending.map(p => p.file),

      appId: this.appId,
      gptId: this.gptId,
      conversationId,
      lang: this.lang,

      chatInfo: this.chatInfo,
      setChatInfo: value => {
        this.adoptChatInfo(value);
      },
      clientMode: this.chatMode === 'chat' ? 'chat' : '',
      chatPoller: this.chatPoller,
      // Detection fired on the AI path and the backend handed them over. The
      // reply is already on screen; this switches mode and opens the session.
      onHandoff: () => this.handOffAfterContact(),

      messages$: this.messages$,
      nextMessageId: () => this.nextMessageId(),

      infoText: this.infoText,
      sendingText: this.t('sending') || '',
      errorText:
        this.t('errorMessage') || 'Sorry, something went wrong. Please try again.',
      errorFileText:
        this.t('errorFileUnreadable') ||
        'That file could not be read. Try saving it as PDF or CSV and attaching it again.',
      errorBusyText:
        this.t('errorBusy') || 'It is busy right now — please try again in a moment.',

      isClearedGlobal: () => this.isClearedGlobal(),
      unmarkClearedGlobal: () => this.unmarkClearedGlobal(),
      rememberInputHistory: value => this.rememberInputHistory(value),

      saveToStorage: () => this.saveToStorage(),
      scrollSoon: () => this.scrollSoon(),
      focusInput: () => this.focusInput(),
      detectChanges: () => this.cdr.detectChanges(),
      scrollNow: () => this.scrollToBottom(true),

      setIsSending: value => {
        this.isSending = value;
      },

      setShowSuggestions: value => {
        this.showSuggestions = value;
      },

      setActiveAssistantMessageId: value => {
        this.activeAssistantMessageId = value;
      },
    }));
  }

  /**
   * Has this conversation been to a live agent at all?
   *
   * True while the visitor is in chat mode, and true afterwards for any
   * conversation that has a message which went to or came from an agent — so
   * switching back to AI search does not silence a chat that is still open,
   * which is the case the poll loop exists for.
   */
  private get chatEngaged(): boolean {
    if (this.chatMode === 'chat') return true;

    return this.messages$().some(m => sendModeOf(m) === 'chat' || recvModeOf(m) === 'chat');
  }

  /**
   * Picks the chat-mode poll loop back up on "the widget got active" —
   * called after loadFromStorage() restores chatInfo (doInit(), so on every
   * fresh load/reload) and again on the panel actually being opened
   * ('bbc-opened' — see ngAfterViewInit()). Both call sites are deliberate:
   * a reload needs this to resume a chat at all, and re-checking on open
   * covers a chat that went stale (or was never running yet this page
   * load) without either call site needing to reason about which one
   * "really" owns starting it — resumePollingIfNeeded()/ChatPoller.start()
   * are idempotent, so calling this liberally costs nothing.
   */
  protected resumeChatPollingFromHistory(): void {
    // Nothing to listen for until this conversation has actually been to a
    // human. A stored chatId alone is not enough: it outlives the exchange it
    // belongs to, so a visitor who is only using AI search would have a poll
    // loop running behind them — an open request every few seconds, and a
    // live Firestore listener on the server, for a chat nobody is in.
    if (!this.chatEngaged) {
      this.chatPoller.stop();
      return;
    }

    resumePollingIfNeeded({
      chatInfo: this.chatInfo,
      chatPoller: this.chatPoller,
      appId: this.appId,
      gptId: this.gptId,
      setChatInfo: value => {
        this.adoptChatInfo(value);
      },
      setActiveAssistantMessageId: value => {
        this.activeAssistantMessageId = value;
      },
      messages$: this.messages$,
      nextMessageId: () => this.nextMessageId(),
      saveToStorage: () => this.saveToStorage(),
      detectChanges: () => this.cdr.detectChanges(),
      scrollNow: () => this.scrollToBottom(true),
      focusInput: () => this.focusInput(),
    });
  }

  // ============================================================
  // Feedback
  // ============================================================

  /**
   * What the visitor shared last time, for prefilling the form.
   *
   * Read fresh rather than cached on the component: the details can be written
   * by a form later in this same conversation, and a value captured at
   * construction would be stale by then.
   */
  get rememberedContact(): { name?: string; info?: string } | undefined {
    return loadContact(this.storageScope, this.storageKey);
  }

  /**
   * The name the visitor gave the contact form, for captioning their messages.
   *
   * Cached, unlike rememberedContact above, and for the opposite reason. That
   * getter is read once when a form is built and must be current; this one is
   * read by labelFor() for every message on every change-detection pass, and
   * loadContact() is a localStorage read plus a JSON.parse each time. On a long
   * conversation that is hundreds of parses per keystroke for an answer that
   * changes at most once a session.
   *
   * undefined means "not looked yet", null means "looked, nothing there" — the
   * distinction is what stops a visitor who never filled the form from being
   * re-checked forever.
   */
  private visitorNameCache: string | null | undefined;

  private get visitorName(): string {
    if (this.visitorNameCache === undefined) {
      this.visitorNameCache = sanitizeUsername(this.rememberedContact?.name) || null;
    }

    return this.visitorNameCache || '';
  }

  /** Drop the cache after the stored contact changes, so the next label read
   *  picks up the new name. The only writer is onContactSubmitted(). */
  private invalidateVisitorName(): void {
    this.visitorNameCache = undefined;
  }

  /**
   * The visitor filled in the contact form, or dismissed it (onContactSkipped
   * below).
   *
   * Both end the same way — the message is marked answered and whatever was
   * given goes onto chatInfo, from where the widget's normal round-trip
   * carries it to the backend on the next message. Skipping is a legitimate
   * answer, not a failure: it just carries no values.
   *
   * Lives on the core component so both widgets share it — the panel widget
   * routes it through app-message, the embed widget calls it directly.
   */
  onContactSubmitted(m: Message, values: Record<string, string>): void {
    // Read what was remembered *before* saving over it: whether anything
    // actually changed is what decides if the agent hears about this at all.
    const remembered = this.rememberedContact;
    const name = (values['name'] ?? '').trim();
    const info = (values['info'] ?? '').trim();
    const changed =
      (remembered?.name ?? '').trim() !== name ||
      (remembered?.info ?? '').trim() !== info;

    // Remember before applying: next time the form appears — a new
    // conversation, a different day — it comes up already filled in.
    saveContact(this.storageScope, { name: values['name'], info: values['info'] }, this.storageKey);

    // The name they just gave captions their messages from here on — including
    // the ones already in the conversation, since the label is read fresh on
    // every render rather than stamped onto the message when it was sent.
    this.invalidateVisitorName();

    applyContactAnswer(m, values, this.contactAnswerParams());
    this.removeContactMessage(m);

    // The editor reports a change, and says nothing when there is none.
    //
    // Both forms look the same and both end here, but they answer different
    // questions. The backend's ask is a step on the way to a person, so
    // answering it opens the session. The editor is the visitor maintaining
    // their own details, and the only reason to trouble the agent is that the
    // details are now different from the ones they were given.
    //
    // openChatSession(), not handOffAfterContact(): the latter short-circuits
    // when a chatId already exists and sends nothing, which is the common case
    // here — the editor is only offered in chat mode. openChatSession() posts
    // the ack turn carrying chatInfo, which applyContactAnswer has just
    // updated, so the new details travel without inventing a typed message to
    // carry them.
    //
    // It covers both states, which is why it is the right call and not merely
    // the working one: with no session yet — chat mode chosen but nothing
    // opened, or the conversation cleared since — the ack opens one, and the
    // details are there from the first moment an agent sees the thread. With a
    // session already open it resumes that one and updates it. Either way the
    // visitor's details reach the person who will reply.
    //
    // Unchanged means silence: re-saving the same name and email is not news,
    // and a message every time someone opens the form to check what they had
    // entered would be noise in the agent's thread.
    if (m.contactEditor) {
      if (changed) this.openChatSession();
      return;
    }

    this.handOffAfterContact();
  }

  onContactSkipped(m: Message): void {
    // Declining applies to this conversation, not forever: remembered details
    // stay in storage for the next one, but nothing from memory is sent on
    // this one. Set before the handoff, since that is what opens the session.
    this.contactDeclined = true;

    applyContactAnswer(m, undefined, this.contactAnswerParams());
    this.removeContactMessage(m);
    // Skipping declines to share details, not to get help — they still asked
    // for a person, so the handoff happens either way.
    this.handOffAfterContact();
  }

  /**
   * Take the contact request out of the conversation.
   *
   * Every button on the form ends here — submit, skip and cancel alike. The
   * form is a prompt, not a turn: once it has been dealt with, leaving it in
   * the transcript means the visitor scrolls back past a question they already
   * answered, still rendered as a question. Removing it is what makes the
   * conversation read as what happened.
   *
   * Note the order at the call sites: applyContactAnswer() runs first and is
   * what actually carries the values out, onto chatInfo via
   * contactAnswerParams(). It writes to the message as well — marking it
   * answered, rendering an acknowledgement — and that part is what goes away
   * with the message, which is the point. Nothing downstream reads it: the
   * handoff works from chatInfo and the session, not from this bubble.
   *
   * Kept as one helper rather than three copies so the three paths cannot drift
   * — the cancel path has been the odd one out once already.
   */
  private removeContactMessage(m: Message): void {
    this.messages$.update(arr => arr.filter(x => x.id !== m.id));

    this.saveToStorage();
    this.cdr.detectChanges();
  }

  /**
   * Should the "change my details" control be offered?
   *
   * Live-agent mode only. In model mode there is nobody to reply to the visitor
   * and nothing that would be sent their details, so a control for editing them
   * would be asking for information with no destination.
   */
  get contactEditVisible(): boolean {
    return this.chatMode === 'chat';
  }

  /**
   * Put a contact form in the conversation so the visitor can change what the
   * agent will see.
   *
   * The same form the backend asks with, minted locally: there is no request to
   * make here — the details live in this browser (loadContact) and go out with
   * the next message either way — so involving the server would be a round trip
   * to be told something we already know.
   *
   * Rendered as an assistant message rather than as a panel of its own because
   * that is the one place the form already exists, already prefills from what
   * is remembered, and already knows what to do with all three buttons. A
   * second surface for the same three fields would be a second thing to keep in
   * step with the first.
   *
   * `skippable: false` hides "Send without info": skipping means "go ahead
   * without my details", which is an answer to being *asked*. Here the visitor
   * opened the form themselves, so the two honest ways out are saving and
   * cancelling — and cancel already removes the message.
   */
  openContactEditor(): void {
    // One form at a time. Opening a second while the first is unanswered leaves
    // two identical asks in the feed, and answering either one leaves the other
    // sitting there stale.
    if (this.messages$().some(m => !!m.contactRequest && !m.contactAnswered)) return;

    const id = this.nextMessageId();

    this.messages$.update(arr => [
      ...arr,
      {
        id,
        role: 'assistant' as const,
        completed: true,
        receivedAt: Date.now(),
        recvMode: 'model' as const,
        // Opened by the visitor, not asked for by the backend — see
        // onContactSubmitted, which uses this to decide whether saving also
        // opens a live session.
        contactEditor: true,
        contactRequest: {
          // The wire label is a fallback the form only uses when it has no
          // translation of its own — see labelFor() in contact-form. Filled in
          // anyway because the type requires it, and an empty string here would
          // render as a blank label in that fallback case.
          fields: [
            { key: 'name' as const, label: (this.t('contactFieldName') || '').trim() || 'Your name' },
            { key: 'info' as const, label: (this.t('contactFieldInfo') || '').trim() || 'Contact info' },
          ],
          reason: (this.t('contactEditReason') || '').trim()
            || 'Add your name and contact details to the chat.',
          skippable: false,
        },
      },
    ]);

    this.saveToStorage();
    this.cdr.detectChanges();
  }

  /**
   * The visitor cancelled the contact request.
   *
   * Nothing is sent and no session opens — the whole point is that this
   * withdraws the ask rather than answering it. That is the only thing left
   * separating this from the other two buttons now that all three remove the
   * message: deliberately not applyContactAnswer(), because that marks the
   * message answered and carries values out to chatInfo, and cancelling did
   * neither.
   */
  onContactCancelled(m: Message): void {
    this.removeContactMessage(m);
  }

  /**
   * Forget the visitor's stored details.
   *
   * The message deliberately stays: they asked to erase what was remembered,
   * not to close the form, and leaving it open is what lets them immediately
   * type something different. Removing it would make "clear" and "cancel" do
   * the same visible thing for different reasons.
   *
   * clearContact() takes the details out of the shared visitor cache and leaves
   * the panel placement in it — the two share an entry but not a meaning, and
   * this request is only about the first.
   *
   * visitorName is cached separately for labelFor(), so it is invalidated here
   * too; without that, the visitor's own messages would keep their old name in
   * the header after the details behind it were gone.
   */
  onContactCleared(_m: Message): void {
    clearContact(this.storageScope, this.storageKey);
    this.invalidateVisitorName();

    this.saveToStorage();
    this.cdr.detectChanges();
  }

  /**
   * The visitor chose "Send without info" in this conversation.
   *
   * Kept per conversation rather than persisted: they declined to share on
   * this occasion, which says nothing about the next one. newConversation()
   * clears it along with the rest of the conversation state.
   */
  private contactDeclined = false;

  /**
   * Start the live-agent handoff the form was asking on behalf of.
   *
   * Without this the feature stops half-way: the visitor asks for a human, is
   * asked who they are, fills it in — and nothing happens, because the details
   * only sit on chatInfo and nothing has opened a session. They are left
   * thanked and ignored.
   *
   * Routed through onChatModeSelected() rather than calling startChatSession()
   * directly so the mode switch, the poller and the session creation all stay
   * in the one place that already gets that ordering right. It no-ops when a
   * session already exists.
   */
  private handOffAfterContact(): void {
    // A session may already exist (the visitor was in chat mode, or asked
    // twice). Creating one again would be wrong, but the composer must still
    // end up in chat mode — otherwise their next message goes to the AI, which
    // is precisely what they just asked to stop happening.
    if (this.chatInfo?.chatId) {
      this.setChatMode('chat');
      return;
    }

    // openChatSession(), not onChatModeSelected(): the form has just been
    // answered, and the mode handler is the path that leads to asking for
    // contact details in the first place — going back through it is how you
    // get a second form.
    this.setChatMode('chat');
    this.openChatSession();
  }

  private contactAnswerParams() {
    return {
      messages$: this.messages$,
      chatInfo: this.chatInfo,
      // Assigned directly, not through adoptChatInfo(): this is the form
      // putting the visitor's own answer onto chatInfo, so it is the source
      // those details come from rather than an echo to be corrected against
      // them. Sending it through adoptChatInfo would re-apply what was just
      // saved over what was just typed — the same values today, and a way for
      // the two to disagree the moment either side changes.
      setChatInfo: (value: ChatInfo | undefined) => {
        this.chatInfo = value;
      },
      saveToStorage: () => this.saveToStorage(),
      scrollSoon: () => this.scrollSoon(),
      focusInput: () => this.focusInput(),
    };
  }

  /**
   * Is this reply worth asking about?
   *
   * Only the assistant's own answers. A message relayed from a human agent
   * arrives with role 'assistant' too — that is how the feed renders it — but
   * "was this helpful?" under something a colleague typed asks the visitor to
   * rate a person, and the answer would land in analytics about model quality
   * where it means nothing.
   *
   * isFromAgent() reads the message's recorded origin (recvMode, with the
   * legacy viaChat fallback), so conversations already in storage are judged
   * the same way as new ones.
   */
  /*
   * The app's setting decides, and only an explicit true shows the row. `??`
   * rather than `||` on purpose: a saved `false` has to win over the field, and
   * with `||` it would fall through to it.
   */
  feedbackVisibleFor(m: Message): boolean {
    return (this.appOrWp?.feedbackEnabled ?? this.feedbackEnabled) === true
      && m.role === 'assistant'
      && !!m.content
      && m.completed === true
      && !isFromAgent(m);
  }

  onAssistantFeedback(m: Message, status: FeedbackType) {
    // The same test the template uses, not a looser one: this is a public
    // method, and a rating for an agent's message must not be accepted just
    // because something called it directly.
    if (!this.feedbackVisibleFor(m)) return;
    if (m.feedback?.submitted) return;

    if (status === 'negative') {
      this.feedbackTargetMessageId = m.id;
      this.feedbackComment = m.feedback?.comment || '';
      this.feedbackModalOpen = true;

      this.messages$.update(arr =>
        arr.map(x =>
          x.id === m.id
            ? { ...x, feedback: { ...(x.feedback || {}), status } }
            : x
        )
      );

      this.saveToStorage();
      return;
    }

    this.messages$.update(arr =>
      arr.map(x =>
        x.id === m.id
          ? { ...x, feedback: { ...(x.feedback || {}), status, submitted: true } }
          : x
      )
    );

    this.saveToStorage();
    this.submitAssistantFeedback(m.id, status, '');
  }

  closeFeedbackModal() {
    this.feedbackModalOpen = false;
    this.feedbackTargetMessageId = null;
    this.feedbackComment = '';
  }

  submitNegativeFeedback() {
    if (this.feedbackTargetMessageId == null) return;

    const message = this.messages$().find(
      m => m.id === this.feedbackTargetMessageId
    );

    if (!message) return;

    const comment = this.feedbackComment.trim();

    this.messages$.update(arr =>
      arr.map(x =>
        x.id === message.id
          ? {
            ...x,
            feedback: {
              ...(x.feedback || {}),
              status: 'negative',
              comment,
              submitted: true,
            },
          }
          : x
      )
    );

    this.saveToStorage();
    this.submitAssistantFeedback(message.id, 'negative', comment);
    this.closeFeedbackModal();
  }

  protected submitAssistantFeedback(
    messageId: number,
    reaction: 'positive' | 'neutral' | 'negative',
    comment?: string
  ) {
    postAssistantFeedback({
      baseUrl: Settings.queryBase(),
      messages: this.messages$(),
      messageId,
      reaction,
      comment,
      appId: this.appId,
      gptId: this.gptId,
      conversationId: this.conversationId,
    });
  }

  // ============================================================
  // View helpers
  // ============================================================

  get isEmpty(): boolean {
    return this.messages$().length === 0;
  }

  get isComposing(): boolean {
    return this.userMessage.trim().length > 0;
  }

  /**
   * Sends the localized "help me use this" prompt as if the visitor typed it.
   *
   * Behind the "?" on the composer. Here rather than on the embed, which is
   * where it started, because the composer is shared and both surfaces show
   * the button.
   */
  askForHelp(): void {
    if (this.isSending) return;

    this.sendWithMessage(this.t('helpPrompt') || 'Help me use this');
  }

  /**
   * Nothing has happened yet — no messages, nothing typed, nothing attached.
   *
   * The widget's resting state, and the one a visitor meets first. Tools that
   * act on a message being written have nothing to act on here, and showing
   * them makes the widget look like a form to fill in rather than a question
   * to ask. They appear the moment there is something for them to do.
   *
   * All three conditions, not just `isEmpty`: a visitor who has typed a line
   * but not sent it is plainly composing, and one who attached a file before
   * writing anything would otherwise lose the control that shows what they
   * attached.
   */
  get isNeutral(): boolean {
    return this.isEmpty
        && !this.isComposing
        && this.pendingAttachments.length === 0;
  }

  /**
   * The colour actually painted behind the conversation and the composer.
   *
   * The same chain both surfaces' templates use for --bb-back: an explicit
   * parameter, then the app's configured colour, then the suggested default.
   * Held here so the pieces that have to read the ground they sit on — see
   * surfaceText — resolve it the same way the paint does.
   */
  get effectiveBackColor(): string {
    return this.backColor || this.appOrWp?.backColor || DEFAULT_WIDGET_THEME.backColor;
  }

  /**
   * Text and icon colour for the chrome sitting directly on the widget
   * background: the title bar, and the toolbar under the composer.
   *
   * Derived from that background the way the header's text is, with the same
   * helper — black or white, whichever the ground can carry. Nothing is passed
   * as `configured` because there is no setting for it: this chrome follows the
   * background, always.
   *
   * Deliberately not the message bubbles. Those have their own ground and keep
   * taking fontColor, which is what a host sets to colour the conversation. The
   * chrome is a different question: the toolbar controls were a fixed grey and
   * the title took fontColor, and since fontColor and backColor are independent
   * settings, nothing stopped a pair that cannot be read.
   */
  get surfaceText(): string {
    return resolveHeaderText(undefined, this.effectiveBackColor);
  }

  /**
   * The colour painted behind the messages — and behind the composer's input
   * frame, which is declared as a message background on purpose.
   *
   * inputBg is in the chain as a legacy alias. It was the admin's "Chat UI"
   * colour for the box the visitor writes in, back when the composer had a fill
   * of its own; the composer takes the message colour now, so the two describe
   * the same surface. There is no messageColor setting yet, which makes inputBg
   * the only saved value an existing app can have for it — dropping it would
   * quietly reset every widget whose owner had picked one.
   *
   * White when nothing is configured, matching the CSS fallback for
   * --bb-msg-back. Not the widget background: messageColor being its own
   * setting is the whole point.
   */
  get effectiveMessageColor(): string {
    return this.messageColor
        || this.appOrWp?.messageColor
        || this.appOrWp?.inputBg
        || '#ffffff';
  }

  /**
   * Colour for the chrome inside the input frame: the send button, the "?", and
   * the welcome line standing in as the placeholder.
   *
   * Their ground is the frame, which is painted with --bb-msg-back, so they are
   * derived from that rather than from the card the way the header and the
   * toolbar are. They took fontColor before, through `color: inherit` all the
   * way up from the shell, and vanished whenever fontColor came close to the
   * message colour.
   *
   * What the visitor actually types is left alone: that is the message they are
   * writing, and it should look like the message it becomes. The placeholder is
   * not — nobody wrote it, and it belongs with the controls around it.
   */
  get inputChromeText(): string {
    return resolveHeaderText(undefined, this.effectiveMessageColor);
  }

  /**
   * Whether the input frame is dark enough to need the light I-beam.
   *
   * A flag rather than a colour because this picks between two drawn cursors,
   * and a cursor cannot take currentColor — the image is fixed at the point it
   * is declared. The surfaces put it on the class the composer's stylesheet
   * looks for; see the cursor block in composer.component.css.
   *
   * The same 0.62 threshold the header text uses, so the beam and the icons
   * beside it flip together rather than one at a time across a mid tone.
   */
  get inputFrameIsDark(): boolean {
    const luminance = backgroundLuminance(this.effectiveMessageColor);

    return luminance !== undefined && luminance <= 0.62;
  }

  copyText(text: string, i: number) {
    navigator.clipboard.writeText(text)
      .then(() => {
        this.copiedIndex = i;
        clearTimeout(this.copyTimer);

        this.copyTimer = setTimeout(() => {
          if (this.copiedIndex === i) this.copiedIndex = null;
        }, 1200);
      })
      .catch(err => console.error('Copy failed', err));
  }

  get appOrWp(): any {
    const app = this.blueBoot?.widgetApp as any;
    return app?.widgetParams || app || {};
  }

  /**
   * Label shown in a message's header.
   *
   * Accepts the whole message (not just its role) so a reply a human agent
   * actually wrote shows their name instead of "Assistant".
   *
   * The test is the message's recorded origin (isFromAgent → msgFrom), not
   * the mode the widget is in and not "did this arrive through the poll
   * loop". Those two are why the AI-written welcome message used to be
   * captioned with a live agent's name: it belongs to a chat session and
   * arrives by polling, but the model wrote it.
   *
   * A plain role string still works for any older caller — there's no message
   * to have an origin, so it falls through to the role labels.
   */
  labelFor(message: Message | Role): string {
    const role: Role = typeof message === 'string' ? message : message.role;
    const msg: Message | undefined = typeof message === 'string' ? undefined : message;

    if (role === 'assistant' && msg && isFromAgent(msg)) {
      // The person's own name if the external system sent one — an answer from
      // a named human should say who. Otherwise the connection's name, via the
      // same chain everything else uses.
      return (msg.chatName || '').trim() || this.agentLabel;
    }

    const override = this.roleLabels?.[role];
    if (override) return override;

    if (role === 'user') {
      // The host's own username first — a signed-in site knows who this is
      // better than a form does. Then the name the visitor gave the contact
      // form, which is the same person saying so themselves. "You" is what is
      // left when nobody has a name to offer.
      const uname = sanitizeUsername(this.username) || this.visitorName;
      return uname || (this.t('you') || '').trim() || 'You';
    }

    if (role === 'assistant') {
      return (this.t('assistant') || '').trim() || (this.title || this.displayName || 'Assistant');
    }

    return (this.t('error') || '').trim() || 'Error';
  }

  /**
   * Is this message still on its way out?
   *
   * The spinner's condition, kept beside sendStatusLabel() because the two
   * split one state between them: this covers 'sending', that covers what
   * happens after. Both return nothing for anything but a user message with a
   * status, so older stored history shows neither.
   *
   * A method on the core rather than a check in each template — the panel
   * widget renders the same header row.
   */
  isSendingMessage(message: Message): boolean {
    return message.role === 'user' && message.sendStatus === 'sending';
  }

  /**
   * Text for the small send-status flag next to the "You" label — the clock
   * the request was acked at (see chat-conversation.functions.ts). '' for
   * anything but a user message that actually has a status (older stored
   * history has none), and '' while it is still in flight: the spinner
   * isSendingMessage() drives says that instead.
   */
  sendStatusLabel(message: Message): string {
    if (message.role !== 'user' || !message.sendStatus) return '';

    // In flight: no text. The spinner in the header row says it, and says it in
    // every language without being translated into any of them.
    // isSendingMessage() below is what the template renders it from.
    if (message.sendStatus === 'sending') return '';

    // The clock alone. "Sent 14:41" on the visitor's own message says nothing
    // the position of the bubble has not already said — it is their message, in
    // their conversation, and it is there. The word was carrying the timestamp
    // rather than adding to it.
    //
    // 'Sending…' above keeps its word, because that one is not obvious: it is a
    // state the visitor cannot otherwise see, and it has no time to show yet.
    //
    // With no sentAt this now returns '' where it used to return the bare word,
    // and the span disappears instead of showing a status with no time. That is
    // the right end of the trade: a flag reading only "Sent" was the least
    // informative thing in the row.
    //
    // This method is shared by both widgets, so the panel loses the word too.
    // The sentFlag / receivedFlag entries stay in ui-strings — unused strings
    // are cheap, and re-translating them into 18 languages would not be.
    return this.formatClockTime(message.sentAt);
  }

  /**
   * Text for the small destination flag next to the "You" label — tells the
   * visitor whether that particular message actually went to the AI or to
   * the live agent (message.sendMode, stamped once at send time in
   * chat-conversation.functions.ts). Only ever shown when a live-agent
   * integration is configured at all: with no chat mode to switch between,
   * every message obviously went to the model, so the flag would be noise.
   * '' when the send mode is unknown (older stored history).
   */
  sentViaLabel(message: Message): string {
    if (message.role !== 'user' || !this.chatModeSelectorVisible) return '';

    const sendMode = sendModeOf(message);
    if (!sendMode) return '';

    return sendMode === 'chat'
      ? this.agentLabel
      : (this.t('chatModeAi') || '').trim() || 'AI';
  }

  /**
   * What to call the human side of the conversation.
   *
   * The name the app configured for its chat connection first — "Support",
   * "Kundeservice", whatever the customer called it. That name is the one the
   * visitor is being handed to, and it says something; "Live agent" says only
   * that the software has a concept of live agents.
   *
   * Falls back to the localized generic, then to English, so a connection
   * saved without a name still reads sensibly in every language.
   *
   * A getter rather than the same expression in three places: it was already
   * written inline in the embed's template and the panel's, and the third
   * caller — the "sent via" flag on a visitor's own message — was written
   * without it and had been showing "Live-agent" all along.
   */
  get agentLabel(): string {
    return (this.externalChat?.name || '').trim()
      || (this.t('chatModeAgent') || '').trim()
      || 'Live agent';
  }

  /**
   * Text for the small received-status flag next to an assistant/error
   * message's label — the incoming-message counterpart to
   * sendStatusLabel(). Only ever 'Received HH:MM' (no in-flight state to
   * show, unlike sending — the message doesn't exist in the list at all
   * until it has content), and only once receivedAt is actually stamped
   * (see chat-conversation.functions.ts) — '' for a still-streaming reply
   * or older stored history with no receivedAt.
   */
  receivedLabel(message: Message): string {
    if (message.role === 'user' || !message.receivedAt) return '';

    // Same as sendStatusLabel(): the clock without the word. An assistant
    // message that is on screen was received; saying so beside the label it is
    // already under is repeating the obvious in the one place where space is
    // tightest.
    return this.formatClockTime(message.receivedAt);
  }

  /**
   * Shared by sendStatusLabel()/receivedLabel() — a local wall-clock reading,
   * or '' when there's nothing to format.
   *
   * Formatted for the widget's own language, not the browser's. It was `[]`,
   * which means "whatever this browser is set to" — so a widget rendering in
   * Norwegian on an en-US machine put "Sendt 02:41 PM" next to the message: the
   * word translated, the clock beside it did not. The two halves of one line
   * disagreeing about which country they are in is worse than either choice on
   * its own.
   *
   * The 12-hour/24-hour split comes free with the locale, which is the reason
   * to fix it here rather than hardcoding hour12: no reads 24-hour, en-US reads
   * 12-hour, and that is a convention of the language rather than a preference
   * to be configured.
   *
   * lang is a bare language tag ('no', 'de'), which is a valid BCP-47 locale on
   * its own. Empty — before resolveStartingLang() has run — passes undefined,
   * which restores exactly the old behaviour rather than throwing.
   *
   * try/catch because Intl throws RangeError on a malformed tag, and lang can
   * come from a customer's HTML attribute. A timestamp is not worth taking the
   * message list down for: fall back to the browser default and carry on.
   */
  private formatClockTime(epochMs: number | undefined): string {
    if (!epochMs) return '';

    const when = new Date(epochMs);
    const locale = (this.lang || '').trim() || undefined;

    // Over a day old, the clock alone is a lie by omission: "14:41" on a
    // message from last week reads as this afternoon, and the visitor has no
    // way to tell from the line itself. Restored history is exactly where this
    // bites — a conversation reopened days later is all timestamps and no
    // dates.
    //
    // Elapsed time, not calendar day: 09:00 yesterday and 09:00 today are a day
    // apart and should look it, while 23:50 and 00:10 are twenty minutes apart
    // and should not be pulled onto separate dates for crossing midnight.
    //
    // dateStyle/timeStyle rather than hand-assembled fields — they cannot be
    // mixed with hour/minute, which is why this is a separate options object
    // and not a couple of extra keys on the one below. 'short' keeps it to the
    // width the header row has: the locale decides what short means, which is
    // the whole point (09.09.2026, 14:41 in no; 9/9/26, 2:41 PM in en-US).
    const DAY_MS = 24 * 60 * 60 * 1000;
    const isOld = Date.now() - epochMs >= DAY_MS;

    const opts: Intl.DateTimeFormatOptions = isOld
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { hour: '2-digit', minute: '2-digit' };

    // toLocaleString for both: with only hour/minute set it produces the same
    // string toLocaleTimeString did, and one call site is one thing to get
    // right rather than two.
    try {
      return when.toLocaleString(locale, opts);
    } catch {
      return when.toLocaleString(undefined, opts);
    }
  }

  computedLogo(): string | undefined {
    if (this.cachedLogoDataUrl) return this.cachedLogoDataUrl;
    if (this.logoSrc && String(this.logoSrc).trim()) return this.logoSrc.trim();

    const fromWp = this.appOrWp?.logoSrc;
    if (fromWp && String(fromWp).trim()) return String(fromWp).trim();

    // Nothing from the backend and no local [logoSrc]: no logo, by design —
    // the header chip falls through to the letter-initial avatar (or
    // disappears entirely) instead of the compiled-in brand mark.
    return undefined;
  }

  public avatarSrc(role: Role): string {
    return this.cachedAvatarDataUrl[role] || '';
  }

  avatarBgFor(role: Role): string | undefined {
    const fromInput = this.roleAvatarBg || {};
    const fromApi = this.appOrWp?.roleAvatarBg || {};

    return (fromInput as any)[role] ?? (fromApi as any)[role];
  }
}
