import {
  Component, AfterViewInit, signal,
  OnInit, OnDestroy,
  ElementRef, ViewChild, ViewChildren,
  QueryList, NgZone, Input, ViewEncapsulation, OnChanges, SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BluebootService } from '../services/blueboot.service';
import { Subscription } from 'rxjs';
import { newConversationId } from '../services/chat.functions';
import { WidgetApp } from '../models/widget-app';
import { Settings } from '../settings';
import { DEFAULT_LANG } from '../../shared-library/models/ui-default';

import { FeedbackType, Message, Role } from './models/chat-message.model';
import { normalizeLangCode } from './utils/lang.utils';
import { BbImgCacheMini, getGlobalMini } from './utils/image-cache.utils';

import { ChatHeaderComponent } from './components/chat-header/chat-header.component';
import { ChatMessageComponent } from './components/chat-message/chat-message.component';
import { ChatComposerComponent } from './components/chat-composer/chat-composer.component';
import { ChatSuggestionsComponent } from './components/chat-suggestions/chat-suggestions.component';

import { ChatStorageService } from './services/chat-storage.service';
import { ChatFeedbackService } from './services/chat-feedback.service';
import { ChatConversationService } from './services/chat-conversation.service';
import { ChatWidgetConfigService } from './services/chat-widget-config.service';

enum callTo { App, Rag, Assistant, Direct }

@Component({
  selector: 'blue-search',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ChatHeaderComponent,
    ChatMessageComponent,
    ChatComposerComponent,
    ChatSuggestionsComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class ChatComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input('env') env?: string;
  @Input('userid') userId?: string;
  @Input('appid') appId?: string;
  @Input('gptid') gptId?: string;
  @Input('assistandid') assistantId?: string;
  @Input() feedbackEnabled: boolean = true;
  @Input() title: string = 'Assistant';
  @Input() mode: 'compact' | 'full' = 'compact';
  @Input() render: 'markdown' | 'linkify' = 'markdown';

  @Input() logoSrc?: string;
  @Input() logoAlt?: string;

  @Input() welcomeText: string = '';
  @Input() persist: boolean = true;
  @Input() storageKey?: string;
  @Input() lang: string = DEFAULT_LANG;
  @Input() translations?: Partial<Record<string, any>>;
  @Input() defaultLang?: string;
  @Input() username?: string;
  @Input() roleLabels?: Partial<Record<Role, string>>;
  @Input() roleAvatars?: Partial<Record<Role, string>>;
  @Input() roleAvatarImages?: Partial<Record<Role, string>>;
  @Input() roleAvatarBg?: Partial<Record<Role, string>>;
  @Input() headerLogoBg?: string;
  @Input() headerLogoRound?: boolean;
  @Input() headerLogoInitial?: boolean;
  @Input() assetsBase: string = 'https://blueboot-cdn.web.app/blue-search/latest/';
  @Input() fontFamily?: string;
  @Input() fontSize?: string;
  @Input() lineHeight?: string;

  @ViewChild('historyRef') historyRef?: ElementRef<HTMLDivElement>;
  @ViewChild(ChatComposerComponent) chatComposer?: ChatComposerComponent;

  get inputRef(): ElementRef<HTMLTextAreaElement> | undefined {
    return this.chatComposer?.inputRef;
  }

  get composerRef(): ElementRef<HTMLElement> | undefined {
    return this.chatComposer?.composerRef;
  }

  @ViewChildren('msgItem', { read: ElementRef })
  msgItems!: QueryList<ElementRef<HTMLElement>>;

  private ro?: ResizeObserver;
  private msgItemsSub?: Subscription;
  private scrollRAF?: number;

  logoVisible = true;
  onLogoError() { this.logoVisible = false; }

  @Input() autoFocusOnInit: boolean = true;

  displayName: string | undefined = undefined;
  description: string | undefined = undefined;
  useInterface: callTo = callTo.Rag;
  messages$ = signal<Message[]>([]);
  trackById = (_: number, m: Message) => m.id;
  msgId = 1;

  feedbackModalOpen = false;
  feedbackTargetMessageId: number | null = null;
  feedbackComment = '';
  private activeAssistantMessageId: number | null = null;

  private conversationId?: string;
  private ensureConversationId(): string {
    if (!this.conversationId) this.conversationId = newConversationId();
    return this.conversationId;
  }

  private pendingScrollOnOpen = false;
  userMessage = '';
  isSending = false;
  copiedIndex: number | null = null;
  private copyTimer: any;

  private inputHistory: string[] = [];
  private inputHistoryIndex = -1;
  private inputHistoryDraft = '';

  selectionActionVisible = false;
  selectionActionX = 0;
  selectionActionY = 0;
  protected selectedAssistantText = '';

  protected readonly onSelectionMouseUp = () => this.updateSelectionAction();
  protected readonly onSelectionKeyUp = () => this.updateSelectionAction();
  protected readonly onDocumentSelectionChange = () => this.updateSelectionAction();
  protected readonly onWindowResize = () => this.hideSelectionAction();
  protected readonly onWindowScroll = () => this.hideSelectionAction();

  private hasInitialized = false;
  private initRunId = 0;

  suggestions: string[] = [];

  animateSwap = false;
  currentSuggestion = '';
  showSuggestions: boolean | undefined = true;
  selectedModel = 'gpt-5.4-nano';

  infoText = {
    infoIdx: 0,
    thinkIdx: 0,
    info: [] as string[],
    infoThink: [] as string[],
  };

  headerIsRound = true;
  headerLogoInitialLocal = true;
  private blueBoot: BluebootService | undefined;

  private get cacheScope() { return this.appId ?? 'app'; }
  private _cache?: BbImgCacheMini;
  private get cache(): BbImgCacheMini {
    if (!this._cache) this._cache = getGlobalMini(this.cacheScope);
    return this._cache;
  }

  private cachedLogoDataUrl?: string;
  private cachedAvatarDataUrl: Partial<Record<Role, string>> = {};
  private avatarBlobUrls: Partial<Record<Role, string>> = {};
  private imgPolicy = { checked: false, dataOk: true, blobOk: true };

  private readonly SEND_ICON_DARK_BUNDLE = 'img/Bluesearch_forstørrelsesglass_gråblå.png';
  private readonly SEND_ICON_LIGHT_BUNDLE = 'img/Bluesearch_forstørrelsesglass_hvit.png';
  sendIconReady?: string;

  private apiFontFamily?: string;
  private apiFontSize?: string;
  private apiLineHeight?: string;

  protected chatStorage = inject(ChatStorageService);
  protected chatFeedback = inject(ChatFeedbackService);
  protected chatConversation = inject(ChatConversationService);
  protected chatWidgetConfig = inject(ChatWidgetConfigService);

  constructor(
    protected zone: NgZone,
    protected elementRef: ElementRef<HTMLElement>,
  ) {
    Settings.setPublicUrl(this.env);
  }

  private applyTypographyVars() {
    try {
      const hostEl = this.elementRef.nativeElement as HTMLElement;
      const ff = (this.fontFamily?.trim() || this.apiFontFamily?.trim() || '');
      const fs = (this.fontSize?.trim() || this.apiFontSize?.trim() || '');
      const lh = (this.lineHeight?.trim() || this.apiLineHeight?.trim() || '');

      if (ff) hostEl.style.setProperty('--bb-font-family', ff);
      if (fs) hostEl.style.setProperty('--bb-font-size', fs);
      if (lh) hostEl.style.setProperty('--bb-line-height', lh);
    } catch {}
  }

  private getSessionFallbackKey(): string {
    return `${this.getKey()}:fallback`;
  }

  private clearInputHistory() {
    this.inputHistory = [];
    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';
  }

  private rememberInputHistory(value: string) {
    const v = String(value || '').trim();
    if (!v) return;

    if (this.inputHistory[this.inputHistory.length - 1] !== v) {
      this.inputHistory.push(v);
      if (this.inputHistory.length > 50) this.inputHistory.shift();
    }

    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';
  }

  private rebuildInputHistoryFromMessages(messages: Message[]): string[] {
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

  private handleInputHistoryKey(e: KeyboardEvent): boolean {
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

      const assistantSelector = '.msg.ai, .msg-assistant';
      const startMsg = startEl.closest(assistantSelector);
      const endMsg = endEl.closest(assistantSelector);
      const startText = startEl.closest('.text');
      const endText = endEl.closest('.text');

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

      let x = rect.left + (rect.width / 2);
      let y = rect.top - 42;

      if (y < 8) y = rect.bottom + 8;
      x = Math.max(56, Math.min(window.innerWidth - 56, x));

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

  private getEffectiveLang(): string {
    return this.chatWidgetConfig.getEffectiveLang(
      this.lang,
      this.appOrWp
    );
  }

  private strings(): Record<string, string> {
    return this.chatWidgetConfig.getStrings(
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

  private getKey(): string {
    if (this.storageKey) return this.storageKey;

    const app = this.appId ?? 'app';
    const gpt = this.gptId && this.gptId.trim() ? this.gptId.trim() : 'default';
    const usr = this.userId ?? 'anon';

    return ['blueboot', app, gpt, usr].join(':');
  }

  private loadUiExtras() { }

  private getOpenKey(): string {
    const app = this.appId ?? 'app';
    const gpt = this.gptId && this.gptId.trim() ? this.gptId.trim() : 'default';
    const usr = this.userId ?? 'anon';

    return ['blueboot', app, gpt, usr, 'open'].join(':');
  }

  private rememberOpen(isOpen: boolean) {
    try {
      localStorage.setItem(this.getOpenKey(), isOpen ? '1' : '0');
    } catch {}
  }

  private clearedMarkerKeyGlobal(): string {
    const app = this.appId ?? 'app';
    const gpt = (this.gptId && this.gptId.trim()) ? this.gptId.trim() : 'default';

    return `bb:cleared:v3:${app}:${gpt}`;
  }

  private markClearedGlobal() {
    try {
      localStorage.setItem(this.clearedMarkerKeyGlobal(), '1');
    } catch {}
  }

  private unmarkClearedGlobal() {
    try {
      localStorage.removeItem(this.clearedMarkerKeyGlobal());
    } catch {}
  }

  private isClearedGlobal(): boolean {
    try {
      return localStorage.getItem(this.clearedMarkerKeyGlobal()) === '1';
    } catch {
      return false;
    }
  }

  private clearAllHistoriesForAppGpt() {
    const app = this.appId ?? 'app';
    const gpt = (this.gptId && this.gptId.trim()) ? this.gptId.trim() : 'default';
    const prefix = `blueboot:${app}:${gpt}:`;

    this.chatStorage.clearAllHistoriesByPrefix(prefix);
  }

  private loadFromStorage() {
    this.messages$.set([]);
    this.conversationId = undefined;
    this.activeAssistantMessageId = null;
    this.inputHistory = [];
    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';

    if (this.isClearedGlobal()) {
      this.clearAllHistoriesForAppGpt();
      this.chatStorage.removeSessionKey(this.getSessionFallbackKey());
      this.messages$.set([]);
      return;
    }

    let loadedMessages: Message[] = [];
    let loadedInputHistory: string[] = [];

    const data = this.chatStorage.loadBestHistory(
      this.getKey(),
      this.getSessionFallbackKey()
    );

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
    }

    if (loadedMessages.length > 0) {
      this.messages$.set(loadedMessages);
    }

    this.inputHistory = loadedInputHistory.length
      ? loadedInputHistory
      : this.rebuildInputHistoryFromMessages(loadedMessages);

    this.inputHistoryIndex = -1;
    this.inputHistoryDraft = '';

    try {
      const wasOpen = localStorage.getItem(this.getOpenKey()) === '1';
      if (wasOpen) requestAnimationFrame(() => this.scrollToBottomNow());
      else this.pendingScrollOnOpen = true;
    } catch (error) {
      console.error(error);
    }
  }

  private saveToStorage() {
    if (!this.persist) return;

    const payload = this.chatStorage.buildStoredHistory(
      this.conversationId,
      [...this.messages$()],
      [...this.inputHistory]
    );

    this.chatStorage.saveHistory(
      this.getKey(),
      this.getSessionFallbackKey(),
      payload
    );
  }

  private scrollToBottomNow() {
    const el = this.historyRef?.nativeElement;
    if (!el) return;

    el.scrollTop = el.scrollHeight;
  }

  private scrollToBottom(immediate = false) {
    const el = this.historyRef?.nativeElement;
    if (!el) return;

    if (immediate) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    if (this.scrollRAF) cancelAnimationFrame(this.scrollRAF);

    this.scrollRAF = requestAnimationFrame(() =>
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    );
  }

  private scrollSoon() {
    if (this.scrollRAF) cancelAnimationFrame(this.scrollRAF);
    this.scrollRAF = requestAnimationFrame(() => this.scrollToBottom());
  }

  private scrollOnNextOpen() {
    requestAnimationFrame(() => requestAnimationFrame(() => this.scrollToBottomNow()));
  }

  newConversation() {
    this.hideSelectionAction();
    this.clearInputHistory();
    this.messages$.set([]);
    this.userMessage = '';
    this.conversationId = undefined;
    this.activeAssistantMessageId = null;

    if (this.persist) {
      this.chatStorage.removeLocalKey(this.getKey());
      this.chatStorage.removeLocalKey(this.getOpenKey());
      this.chatStorage.removeSessionKey(this.getSessionFallbackKey());
    }

    this.markClearedGlobal();
    this.clearAllHistoriesForAppGpt();
    this.rememberOpen(false);
    this.showSuggestions = true;
    this.scrollSoon();
    this.focusInput();
  }

  private async detectImgPolicy(): Promise<void> {
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

  private async dataImageToBlobUrl(dataUrl: string): Promise<string | undefined> {
    try {
      const res = await fetch(dataUrl);
      if (!res.ok) return undefined;

      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return undefined;
    }
  }

  private async applyAvatar(role: Role, src: string) {
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

  doInitApp(app: WidgetApp) {
    const config = this.chatWidgetConfig.buildConfig({
      app,

      currentTitle: this.title,
      currentWelcomeText: this.welcomeText,
      currentDisplayName: this.displayName,
      currentDescription: this.description,

      lang: this.lang,
      defaultLang: this.defaultLang,
      translations: this.translations,

      username: this.username,
      userId: this.userId,

      roleAvatars: this.roleAvatars,
      roleAvatarImages: this.roleAvatarImages,

      headerIsRound: this.headerIsRound,
      headerLogoInitialLocal: this.headerLogoInitialLocal,
      headerLogoBg: this.headerLogoBg,

      assetsBase: this.assetsBase,

      sendIconDarkBundle: this.SEND_ICON_DARK_BUNDLE,
      sendIconLightBundle: this.SEND_ICON_LIGHT_BUNDLE,
    });

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

    this.lang = config.lang;
    this.translations = config.translations;

    this.title = config.title;
    this.welcomeText = config.welcomeText;

    this.suggestions = config.suggestions;

    this.infoText.info = config.info;
    this.infoText.infoThink = config.infoThink;

    this.headerIsRound = config.headerIsRound;
    this.headerLogoInitialLocal = config.headerLogoInitialLocal;
    this.headerLogoBg = config.headerLogoBg;

    if (config.logoCandidate) {
      this.cache.ensure(config.logoCandidate).then(du => {
        const best = du || config.logoCandidate;

        if (best && this.cachedLogoDataUrl !== best) {
          this.zone.run(() => {
            this.cachedLogoDataUrl = best;
          });
        }
      });
    }

    (['user', 'assistant', 'error'] as Role[]).forEach(role => {
      const url = config.avatarUrls[role];
      if (!url) return;

      this.applyAvatar(role, url);

      this.cache.ensure(url).then(du => {
        const best = du || url;
        this.applyAvatar(role, best);
      });
    });

    this.username = config.username;

    this.useInterface = callTo.App;
    this.sendIconReady = config.sendIconReady;

    const isOpen = localStorage.getItem(this.getOpenKey()) === '1';

    if (isOpen) requestAnimationFrame(() => this.scrollToBottomNow());
    else this.pendingScrollOnOpen = true;
  }

  async doInit() {
    const runId = ++this.initRunId;

    this.clearInputHistory();
    this.hideSelectionAction();
    this.loadUiExtras();

    this.blueBoot = new BluebootService(
      Settings.publicApiUrl(),
      this.userId,
      undefined,
      this.appId,
      this.gptId
    );

    this.blueBoot.getApp()
      .then((res) => {
        if (runId !== this.initRunId) return;
        if (!res) return;

        const app = this.blueBoot?.widgetApp;
        if (app) this.doInitApp(app);
      })
      .catch(console.error);

    if (runId !== this.initRunId) return;

    this.applyTypographyVars();
    requestAnimationFrame(() => this.applyTypographyVars());

    this.loadFromStorage();
    if (runId !== this.initRunId) return;

    this.showSuggestions = this.messages$().length === 0;

    const arr = this.messages$();
    const maxId = arr.reduce((max, m) => Math.max(max, m.id || 0), 0);

    this.msgId = maxId || 0;
  }

  ngOnInit() {
    this.hasInitialized = true;
    this.doInit();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['fontFamily'] || changes['fontSize'] || changes['lineHeight']) {
      this.applyTypographyVars();
      requestAnimationFrame(() => this.applyTypographyVars());
    }

    if (!this.hasInitialized) return;

    if (changes['appId'] || changes['gptId'] || changes['userId'] || changes['storageKey']) {
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

    const onLangChanged = (e: any) => {
      const { lang, translations } = (e?.detail || {});

      this.zone.run(() => {
        if (lang) this.lang = normalizeLangCode(lang);

        if (translations && typeof translations === 'object') {
          const app = this.blueBoot?.widgetApp as any;

          if (app?.widgetParams) {
            app.widgetParams.lang = lang;
            app.widgetParams.translations = translations;
            this.doInitApp(app);
          }
        }
      });
    };

    host.addEventListener('bbc-lang-changed', onLangChanged as any);

    if (this.mode === 'compact') {
      this.scrollToBottom(true);

      this.msgItemsSub = this.msgItems.changes.subscribe(() => {
        const isOpen = localStorage.getItem(this.getOpenKey()) === '1';

        if (isOpen) this.scrollToBottom();
        else this.pendingScrollOnOpen = true;
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
      this.pendingScrollOnOpen = false;

      this.applyTypographyVars();
      requestAnimationFrame(() => this.applyTypographyVars());
    });

    host.addEventListener('bbc-closed', () => this.rememberOpen(false));
  }

  ngOnDestroy() {
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

    const max = (this.mode === 'full') ? 420 : 360;
    const next = Math.min(ta.scrollHeight, max);

    ta.style.height = next + 'px';
    ta.style.overflowY = (ta.scrollHeight > max) ? 'auto' : 'hidden';
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

    this.chatConversation.sendWithMessage({
      msg,

      blueBoot: this.blueBoot,
      useAppInterface: this.useInterface === callTo.App,
      selectedModel: this.selectedModel,

      userId: this.userId,
      appId: this.appId,
      gptId: this.gptId,
      conversationId,

      messages$: this.messages$,
      msgId: this.msgId,
      setMsgId: id => {
        this.msgId = id;
      },

      infoText: this.infoText,
      sendingText: this.t('sending') || '',

      isClearedGlobal: () => this.isClearedGlobal(),
      unmarkClearedGlobal: () => this.unmarkClearedGlobal(),
      rememberInputHistory: value => this.rememberInputHistory(value),

      saveToStorage: () => this.saveToStorage(),
      scrollSoon: () => this.scrollSoon(),
      focusInput: () => this.focusInput(),

      setIsSending: value => {
        this.isSending = value;
      },

      setShowSuggestions: value => {
        this.showSuggestions = value;
      },

      setActiveAssistantMessageId: value => {
        this.activeAssistantMessageId = value;
      },
    });
  }

  onAssistantFeedback(m: Message, status: FeedbackType) {
    const enabled = (this.appOrWp?.feedbackEnabled ?? this.feedbackEnabled) === true;
    if (!enabled) return;
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

  private submitAssistantFeedback(
    messageId: number,
    reaction: 'positive' | 'neutral' | 'negative',
    comment?: string
  ) {
    this.chatFeedback.submitAssistantFeedback({
      baseUrl: Settings.queryBase(),
      messages: this.messages$(),
      messageId,
      reaction,
      comment,
      userId: this.userId,
      appId: this.appId,
      gptId: this.gptId,
      conversationId: this.conversationId,
    });
  }

  get isEmpty(): boolean {
    return this.messages$().length === 0;
  }

  get isComposing(): boolean {
    return this.userMessage.trim().length > 0;
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

  labelFor(role: Role): string {
    const override = this.roleLabels?.[role];
    if (override) return override;

    if (role === 'user') {
      const uname = this.chatWidgetConfig.sanitizeUsername(this.username);
      return uname || (this.t('you') || '').trim() || 'You';
    }

    if (role === 'assistant') {
      return (this.t('assistant') || '').trim() || (this.title || this.displayName || 'Assistant');
    }

    return (this.t('error') || '').trim() || 'Error';
  }

  computedLogo(): string | undefined {
    if (this.cachedLogoDataUrl) return this.cachedLogoDataUrl;
    if (this.logoSrc && String(this.logoSrc).trim()) return this.logoSrc.trim();

    const fromWp = this.appOrWp?.logoSrc;
    if (fromWp && String(fromWp).trim()) return String(fromWp).trim();

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

  onToggleFullscreenClick(el: HTMLElement) {
    const pressed = el.getAttribute('aria-pressed') === 'true';
    const next = !pressed;

    el.setAttribute('aria-pressed', String(next));

    this.elementRef.nativeElement.dispatchEvent(new CustomEvent('bbc-toggle-fullscreen', {
      detail: { on: next },
      bubbles: true,
      composed: true,
    }));
  }

  onCloseClick() {
    this.hideSelectionAction();
    this.clearInputHistory();

    this.elementRef.nativeElement.dispatchEvent(
      new CustomEvent('bbc-close', { bubbles: true, composed: true })
    );
  }
}
