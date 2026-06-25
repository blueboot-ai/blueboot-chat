// src/app/widget/chat-embed/chat-embed.component.ts

import {
  Component,
  ViewEncapsulation,
  ElementRef,
  NgZone,
  Input,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatComponent } from '../chat/chat.component';
import { LinkifyPipe } from '../services/LinkifyPipe';
import { MarkdownComponent } from 'ngx-markdown';
import { DEFAULT_INFO_TEXT, DEFAULT_SUGGESTIONS, pickLang } from '../../shared-library/models/ui-default';

@Component({
  selector: 'blue-search-inner-embed',
  standalone: true,
  imports: [CommonModule, FormsModule, LinkifyPipe, MarkdownComponent],
  templateUrl: './chat-embed.component.html',
  styleUrls: ['./chat-embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class ChatEmbedComponent extends ChatComponent implements OnDestroy {
  @Input() override headerIsRound: boolean = true;
  @Input() override headerLogoInitialLocal: boolean = true;
  @Input() override headerLogoBg: string = '';

  @Input() suggestionMaxVisible: number = 8;
  private readonly embedDefaultSuggestionMaxVisible = 8;

  @Input() logoVideoSrc?: string;
  @Input() logoVideoPoster?: string;
  @Input() logoVideoAutoplay: boolean = true;
  @Input() logoVideoLoop: boolean = true;
  @Input() logoVideoMuted: boolean = true;

  logoVideoVisible = true;
  onLogoVideoError() { this.logoVideoVisible = false; }

  private inputClickedOnce = false;
  private clickingSuggestion = false;

  embedUiReady = true;

  private lastAppOrWpJson?: string;

  private lastScrollMsgCount = 0;
  private didInitialScroll = false;

  private embedSuggestionsSource: string[] = [];

  constructor(
    protected override zone: NgZone,
    protected override elementRef: ElementRef<HTMLElement>,
  ) {
    super(zone, elementRef);
  }

  private applyEmbedTypographyVarsFrom(appOrWp: any) {
    try {
      const hostEl = this.elementRef?.nativeElement as HTMLElement | undefined;
      if (!hostEl) return;

      const aow = appOrWp || {};
      const wp = (aow?.widgetParams || {}) as any;

      const pick = (...vals: any[]) =>
        vals.find(v => typeof v === 'string' && v.trim())?.trim() as string | undefined;

      const fs = pick(aow.fontSize, wp.fontSize, wp.uiFontSize, this.fontSize);
      const ff = pick(aow.fontFamily, wp.fontFamily, wp.uiFontFamily, this.fontFamily);
      const lh = pick(aow.lineHeight, wp.lineHeight, wp.uiLineHeight, this.lineHeight);

      if (ff) this.fontFamily = ff;
      if (fs) this.fontSize = fs;
      if (lh) this.lineHeight = lh;

      if (ff) hostEl.style.setProperty('--bb-font-family', ff);
      if (fs) hostEl.style.setProperty('--bb-font-size', fs);
      if (lh) hostEl.style.setProperty('--bb-line-height', lh);

      const outer = hostEl.closest('blue-search-embed') as HTMLElement | null;
      if (outer) {
        if (ff) outer.style.setProperty('--bb-font-family', ff);
        if (fs) outer.style.setProperty('--bb-font-size', fs);
        if (lh) outer.style.setProperty('--bb-line-height', lh);
      }

      requestAnimationFrame(() => {
        if (ff) hostEl.style.setProperty('--bb-font-family', ff);
        if (fs) hostEl.style.setProperty('--bb-font-size', fs);
        if (lh) hostEl.style.setProperty('--bb-line-height', lh);

        if (outer) {
          if (ff) outer.style.setProperty('--bb-font-family', ff);
          if (fs) outer.style.setProperty('--bb-font-size', fs);
          if (lh) outer.style.setProperty('--bb-line-height', lh);
        }
      });
    } catch {}
  }

  override ngAfterViewInit(): void {
    try { super.ngAfterViewInit?.(); } catch {}

    this.applyEmbedTypographyVarsFrom(this.appOrWp);
    queueMicrotask(() => this.applyEmbedTypographyVarsFrom(this.appOrWp));
    requestAnimationFrame(() => this.applyEmbedTypographyVarsFrom(this.appOrWp));
  }

  override async doInit() {
    await super.doInit();

    this.showSuggestions = false;
    this.refreshEmbedSuggestionSource();

    const apply = () =>
      this.applyEmbedTypographyVarsFrom(this.appOrWp);

    apply();
    setTimeout(apply, 0);
    setTimeout(apply, 50);
    setTimeout(apply, 150);
    setTimeout(apply, 400);
    requestAnimationFrame(apply);

    this.embedUiReady = true;
  }

  private embedAutosizeTextarea() {
    const inputEl = this.inputRef?.nativeElement;
    if (!inputEl) return;

    requestAnimationFrame(() => {
      try {
        inputEl.style.height = 'auto';
        inputEl.style.height = `${inputEl.scrollHeight}px`;
      } catch {}
    });
  }

  computedLogoVideo(): string | undefined {
    if (!this.logoVideoVisible) return undefined;

    const aow = this.appOrWp || {};
    const wp = (aow?.widgetParams as any) || {};

    const pick = (...vals: any[]) =>
      vals.find(v => typeof v === 'string' && v.trim())?.trim() as string | undefined;

    return pick(
      this.logoVideoSrc,
      aow?.logoVideoSrc,
      aow?.brandVideo,
      wp?.logoVideoSrc,
      wp?.brandVideo,
    );
  }

  private refreshEmbedSuggestionSource(): void {
    const aow = this.appOrWp || {};
    const wp = (aow?.widgetParams as any) || {};
    const lang = String(this.lang || wp.lang || 'no').toLowerCase();

    const normalizeList = (arr: any): string[] =>
      (Array.isArray(arr) ? arr : [])
        .map((x: any) => String(x ?? '').trim())
        .filter(Boolean);

    const fromWp = normalizeList(wp?.suggestions);
    const fromApi = normalizeList(this.suggestions);
    const fromDefaults = normalizeList(pickLang(DEFAULT_SUGGESTIONS, lang, 'no') || []);

    const next = fromWp.length ? fromWp : (fromApi.length ? fromApi : fromDefaults);
    if (next.length) this.embedSuggestionsSource = next;
  }

  private restoreFullSuggestionsIfNeeded(): void {
    if (!this.isEmpty) return;

    if (!this.embedSuggestionsSource.length) this.refreshEmbedSuggestionSource();
    if (!this.embedSuggestionsSource.length) return;

    const cur = Array.isArray(this.suggestions) ? this.suggestions : [];
    if (cur.length !== this.embedSuggestionsSource.length) {
      this.suggestions = [...this.embedSuggestionsSource];
    }

    this.embedSuggestionsSource = [];
  }

  onEmbedInputChange() {
    this.embedAutosizeTextarea();

    const hasText = !!this.userMessage.trim();

    if (hasText) {
      this.showSuggestions = false;
    } else {
      this.refreshEmbedSuggestionSource();
      this.restoreFullSuggestionsIfNeeded();

      const inputEl = this.inputRef?.nativeElement;
      const isFocused = !!inputEl && document.activeElement === inputEl;

      this.showSuggestions =
        isFocused &&
        (this.suggestions?.length || 0) > 0;
    }
  }

  onInputMouseDown() {
    this.inputClickedOnce = true;
  }

  onInputFocus() {
    if ((this.suggestions?.length || 0) > 0) {
      this.showSuggestions = true;
    }
  }

  onInputBlur() {
    this.inputClickedOnce = false;

    setTimeout(() => {
      if (this.clickingSuggestion) return;
      if (!this.userMessage.trim()) this.showSuggestions = false;
    }, 0);
  }

  onSuggestionMouseDown() {
    this.clickingSuggestion = true;
  }

  onSuggestionClick(text: string) {
    const msg = (text || '').trim();
    this.clickingSuggestion = false;

    if (!msg || this.isSending) return;

    this.userMessage = '';
    this.embedAutosizeTextarea();
    this.sendWithMessage(msg);
  }

  override newConversation() {
    super.newConversation();

    this.showSuggestions = false;
    this.inputClickedOnce = false;
    this.clickingSuggestion = false;

    this.lastScrollMsgCount = 0;
    this.didInitialScroll = false;

    this.refreshEmbedSuggestionSource();
    if (this.embedSuggestionsSource.length) {
      this.suggestions = [...this.embedSuggestionsSource];
    }

    this.applyEmbedTypographyVarsFrom(this.appOrWp);
  }

  private scrollHistoryToBottom() {
    const historyRef = this.historyRef;
    if (!historyRef) return;

    requestAnimationFrame(() => {
      const el = historyRef.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }

  private ensureDefaultsInWidgetParams(appOrWp: any): void {
    if (!appOrWp) return;

    if (!appOrWp.widgetParams || typeof appOrWp.widgetParams !== 'object') {
      appOrWp.widgetParams = {};
    }

    const wp = appOrWp.widgetParams as any;
    const lang = String(this.lang || wp.lang || 'no').toLowerCase();

    wp.lang = wp.lang ?? lang;

    const isEmptyStringArray = (arr: any) =>
      !Array.isArray(arr) ||
      arr.length === 0 ||
      arr.every((x: any) => String(x ?? '').trim() === '');

    const isEmptyInfoText = (it: any) => {
      if (!it || typeof it !== 'object') return true;
      return isEmptyStringArray(it.info) && isEmptyStringArray(it.infoThink);
    };

    if (isEmptyStringArray(wp.suggestions) && isEmptyStringArray(this.suggestions)) {
      const defS = pickLang(DEFAULT_SUGGESTIONS, lang, 'no') || [];
      wp.suggestions = [...defS];
      if (wp.enableSuggestion !== true) wp.enableSuggestion = true;
    }

    if (isEmptyInfoText(wp.infoText)) {
      const defI = pickLang(DEFAULT_INFO_TEXT, lang, 'no');
      wp.infoText = {
        info: [...(defI?.info || [])],
        infoThink: [...(defI?.infoThink || [])],
      };
    }

    const rawSmv = (wp as any).suggestionMaxVisible;

    let parsedSmv: number | null = null;

    if (typeof rawSmv === 'number' && Number.isFinite(rawSmv)) {
      parsedSmv = rawSmv;
    } else if (typeof rawSmv === 'string') {
      const s = rawSmv.trim();
      if (s !== '' && !isNaN(Number(s))) parsedSmv = Number(s);
    }

    if (parsedSmv != null && parsedSmv >= 2) {
      this.suggestionMaxVisible = Math.floor(parsedSmv);
    } else {
      const cur = Number(this.suggestionMaxVisible);
      if (!Number.isFinite(cur) || cur < 2) {
        this.suggestionMaxVisible = this.embedDefaultSuggestionMaxVisible;
      }
    }

    if (!this.logoVideoSrc && (wp.logoVideoSrc || wp.brandVideo)) {
      this.logoVideoSrc = String(wp.logoVideoSrc || wp.brandVideo);
    }
  }

  ngDoCheck() {
    const appOrWp = this.appOrWp as any | undefined;

    if (appOrWp) {
      this.ensureDefaultsInWidgetParams(appOrWp);

      const snapshot = JSON.stringify({
        backColor: appOrWp.backColor,
        headerBg: appOrWp.headerBg,
        inputBg: appOrWp.inputBg,
        inputBorder: appOrWp.inputBorder,
        sendBg: appOrWp.sendBg,
        sendFg: appOrWp.sendFg,
        brandmark: appOrWp.brandmark,
        logoSrc: appOrWp.logoSrc ?? this.logoSrc,
        logoVideoSrc: appOrWp.logoVideoSrc ?? this.logoVideoSrc,
        enableSuggestion: appOrWp?.widgetParams?.enableSuggestion,
        suggestions: appOrWp?.widgetParams?.suggestions,
        infoText: appOrWp?.widgetParams?.infoText,
        suggestionMaxVisible: appOrWp?.widgetParams?.suggestionMaxVisible,
        wpFontFamily: appOrWp?.widgetParams?.fontFamily ?? appOrWp?.widgetParams?.uiFontFamily,
        wpFontSize: appOrWp?.widgetParams?.fontSize ?? appOrWp?.widgetParams?.uiFontSize,
        wpLineHeight: appOrWp?.widgetParams?.lineHeight ?? appOrWp?.widgetParams?.uiLineHeight,
        fontFamily: appOrWp?.fontFamily ?? null,
        fontSize: appOrWp?.fontSize ?? null,
        lineHeight: appOrWp?.lineHeight ?? null,
      });

      if (snapshot !== this.lastAppOrWpJson) {
        this.lastAppOrWpJson = snapshot;

        this.applyEmbedTypographyVarsFrom(appOrWp);

        this.refreshEmbedSuggestionSource();
        if (!this.userMessage?.trim()) this.restoreFullSuggestionsIfNeeded();
      }
    }

    const historyRef = this.historyRef;

    if (this.embedUiReady && historyRef) {
      const msgs = this.messages$?.() || [];
      const count = msgs.length;

      if (count > 0 && (!this.didInitialScroll || count !== this.lastScrollMsgCount)) {
        this.lastScrollMsgCount = count;
        this.didInitialScroll = true;
        this.scrollHistoryToBottom();
      }
    }
  }
}
