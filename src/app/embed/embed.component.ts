import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  ViewEncapsulation,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ChatEmbedComponent } from '../chat-embed/chat-embed.component';
import { BluebootService } from '../services/blueboot.service';
import { Settings } from '../settings';

type Q = Partial<Record<string, string>>;

function getQuery(): Q {
  const out: Q = {};
  const u = new URL(window.location.href);
  u.searchParams.forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

function normalizeLang(raw?: string, fallback = 'en'): string {
  const c = String(raw || '').trim().toLowerCase();
  if (!c) return fallback;
  if (c.startsWith('nb') || c.startsWith('nn') || c === 'norwegian' || c === 'no_no') return 'no';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('ar')) return 'ar';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('de')) return 'de';
  if (c.startsWith('uk') || c.startsWith('ua')) return 'uk';
  return c;
}

@Component({
  selector: 'blue-search-embed',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatEmbedComponent],
  templateUrl: './embed.component.html',
  styleUrls: ['./embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EmbedComponent implements OnInit, OnChanges {
  // === Inputs ===
  @Input() appid?: string;
  @Input() env?: string;
  @Input() userid?: string;
  @Input() gptid?: string;
  @Input() assistandid?: string;
  @Input() apikey?: string;

  // UI (API can override)
  @Input() title = 'Assistant';
  @Input() welcomeText = '';
  @Input() logoSrc?: string;
  @Input() logoAlt?: string;

  // i18n
  @Input() lang = 'no';
  @Input() defaultLang = 'en';

  // translations input (host / query override)
  @Input() translations?: any;

  @Input() persist: boolean = true;

  @Input() headerIsRound: boolean = true;
  @Input() headerLogoInitialLocal: boolean = true;
  @Input() headerLogoBg: string = '';

  // assets
  @Input() assetsBase: string = 'https://blueboot-cdn.web.app/blue-search/latest/';

  private blue!: BluebootService;

  constructor() {}

  private normalizeBase(u?: string): string {
    const s = String(u || '').trim();
    if (!s) return '';
    return s.endsWith('/') ? s : (s + '/');
  }

  // ============================================================
  // ✅ RESTORE HISTORY: stable key passed to inner embed
  // ============================================================
  public historyStorageKey = '';

  private recomputeHistoryKey() {
    const app = this.appid ?? 'app';
    const gpt = this.gptid && this.gptid.trim() ? this.gptid.trim() : 'default';
    const usr = this.userid && String(this.userid).trim() ? String(this.userid).trim() : 'anon';
    this.historyStorageKey = ['blueboot', app, gpt, usr].join(':');
  }

  // ============================================================
  // ✅ Translations priority + cache hygiene (your working fix)
  // Priority: cache -> API -> host
  // ============================================================

  private cachedTranslations?: any;
  private hostTranslationsSnapshot?: any;

  private cloneObj<T>(v: T): T {
    try {
      const sc = (globalThis as any).structuredClone;
      if (typeof sc === 'function') return sc(v);
      return JSON.parse(JSON.stringify(v));
    } catch {
      return v;
    }
  }

  // private uiCacheKey(): string {
  //   const app  = this.appid ?? 'app';
  //   const gpt  = this.gptid && this.gptid.trim() ? this.gptid.trim() : 'default';
  //   const lang = (this.lang || 'no').toLowerCase();
  //   return `bb-ui:v1:${app}:${gpt}:${lang}`;
  // }
  //
  // private seedUiFromCache() {
  //   try {
  //
  //     const raw = localStorage.getItem(this.uiCacheKey());
  //     if (!raw) return;
  //     const obj = JSON.parse(raw) || {};
  //
  //     // fin what app it is cached on
  //     this.cachedAppId = obj.appId || ''
  //
  //     if (obj.title)        this.title = obj.title;
  //     if (obj.welcomeText)  this.welcomeText = obj.welcomeText;
  //     if (obj.logoSrc)      this.logoSrc = obj.logoSrc;
  //     if (obj.logoAlt)      this.logoAlt = obj.logoAlt;
  //     if (obj.lang)         this.lang = String(obj.lang).toLowerCase();
  //     if (obj.defaultLang)  this.defaultLang = String(obj.defaultLang).toLowerCase();
  //
  //     // ✅ do not apply cached translations directly into this.translations
  //     if (obj.translations) this.cachedTranslations = obj.translations;
  //
  //     if (obj.headerLogoBg) this.headerLogoBg = String(obj.headerLogoBg);
  //     if (typeof obj.headerIsRound === 'boolean') this.headerIsRound = obj.headerIsRound;
  //     if (typeof obj.headerLogoInitialLocal === 'boolean') this.headerLogoInitialLocal = obj.headerLogoInitialLocal;
  //
  //     if (obj.assetsBase && typeof obj.assetsBase === 'string') {
  //       this.assetsBase = this.normalizeBase(obj.assetsBase);
  //     }
  //   } catch {}
  // }
  //
  // private writeUiCache(extra?: Partial<Record<string, any>>) {
  //   try {
  //     const prev = JSON.parse(localStorage.getItem(this.uiCacheKey()) || '{}');
  //     const out = {
  //       ...(prev || {}),
  //       lang: this.lang,
  //       defaultLang: this.defaultLang,
  //       translations: this.translations || {},
  //
  //       appId: this.appid,
  //       title: this.title,
  //       welcomeText: this.welcomeText,
  //       logoSrc: this.logoSrc,
  //       logoAlt: this.logoAlt,
  //
  //       headerLogoBg: this.headerLogoBg,
  //       headerIsRound: this.headerIsRound,
  //       headerLogoInitialLocal: this.headerLogoInitialLocal,
  //
  //       assetsBase: this.assetsBase,
  //
  //       ...(extra || {}),
  //     };
  //     localStorage.setItem(this.uiCacheKey(), JSON.stringify(out));
  //   } catch {}
  // }

  private applyTranslationsWithPriority(apiTrans: any) {
    const cachedTrans =
      (this.cachedTranslations && typeof this.cachedTranslations === 'object') ? this.cachedTranslations : {};

    const hostTrans =
      (this.hostTranslationsSnapshot && typeof this.hostTranslationsSnapshot === 'object')
        ? this.hostTranslationsSnapshot
        : {};

    const apiT =
      (apiTrans && typeof apiTrans === 'object') ? apiTrans : {};

    // ✅ Priority: cache -> API -> host override
    this.translations = { ...cachedTrans, ...apiT, ...hostTrans };
  }

  async doInit() {

    Settings.setPublicUrl(this.env);

    // ✅ recompute key early (even before API)
    this.recomputeHistoryKey();

    // Seed UI from cache (may update assetsBase too)
    //this.seedUiFromCache();

    // Normalize assetsBase
    this.assetsBase = this.normalizeBase(this.assetsBase);

      const w = window as any;
      const urlBackend = (w && w.__BLUE_SEARCH_BACKEND) || Settings.publicApiUrl() || '';
      this.blue = new BluebootService(urlBackend, this.userid, this.apikey, this.appid, this.gptid);
      this.blue.getApp().then(res => {

        if(res) {

          const app = this.blue.widgetApp as any;
          const wp  = (app?.widgetParams || {}) as any;

          this.title        = wp.title        ?? app?.displayName ?? this.title;
          this.welcomeText  = wp.welcomeText  ?? this.welcomeText;
          this.logoSrc      = wp.logoSrc      ?? app?.brandmark   ?? this.logoSrc;
          this.logoAlt      = wp.logoAlt      ?? this.logoAlt;

          this.headerLogoBg           = wp.headerLogoBg           ?? this.headerLogoBg;
          this.headerIsRound          = wp.headerIsRound          ?? this.headerIsRound;
          this.headerLogoInitialLocal = wp.headerLogoInitialLocal ?? this.headerLogoInitialLocal;

          if (wp.defaultLang || app?.defaultLang) {
            this.defaultLang = normalizeLang(wp.defaultLang ?? app?.defaultLang, this.defaultLang || 'en');
          } else {
            this.defaultLang = normalizeLang(this.defaultLang || 'en', 'en');
          }

          const apiLang = wp.lang ?? app?.lang;
          if (apiLang) this.lang = normalizeLang(apiLang, this.defaultLang);

          // ✅ translations fix
          this.applyTranslationsWithPriority(wp.translations);

          // ✅ assetsBase priority
          const fromApi = wp.assetsBase;
          if (fromApi && String(fromApi).trim()) {
            this.assetsBase = this.normalizeBase(fromApi);
          }

          // ✅ recompute key again now that ids are definitely final
          this.recomputeHistoryKey();
          //this.writeUiCache();

        }

      }).catch(e => {
        console.warn('Embed: failed to fetch app config', e);
        this.assetsBase = this.normalizeBase(this.assetsBase);
        this.applyTranslationsWithPriority(undefined);
        // still keep a stable history key
        this.recomputeHistoryKey();

      });

  }

  ngOnChanges(changes: SimpleChanges) {
    // if (changes['appid'] || changes['userid'] || changes['env'] || changes['gptid']) {
    //   this.recomputeHistoryKey();
    //   this.doInit();
    // }
  }

  async ngOnInit() {

    const q = getQuery();

    this.appid       = q['appid']       ?? this.appid;
    this.env         = q['env']         ?? this.env;
    this.userid      = q['userid']      ?? this.userid;
    this.gptid       = q['gptid']       ?? this.gptid;
    this.assistandid = q['assistandid'] ?? this.assistandid;
    this.apikey      = q['apikey']      ?? this.apikey;

    this.title       = (q['title']       ?? this.title).trim();
    this.welcomeText = (q['welcometext'] ?? this.welcomeText).trim();
    this.logoSrc     = q['logosrc'] ?? this.logoSrc;
    this.logoAlt     = q['logoalt'] ?? this.logoAlt;

    const qBase = q['assetsbase'] ?? (q as any)['assetsBase'];
    if (qBase && String(qBase).trim()) {
      this.assetsBase = this.normalizeBase(qBase);
    } else {
      this.assetsBase = this.normalizeBase(this.assetsBase);
    }

    if (q['defaultlang']) this.defaultLang = normalizeLang(q['defaultlang']!, 'en');
    if (q['lang']) this.lang = normalizeLang(q['lang']!, this.defaultLang);

    // ✅ snapshot host overrides ONCE
    if (!this.hostTranslationsSnapshot) {
      let hostT: any = this.translations;
      if (q['translations']) {
        try { hostT = JSON.parse(q['translations']!); } catch {}
      }
      this.hostTranslationsSnapshot = this.cloneObj(hostT || {});
    }

    if (q['translations']) {
      try { this.translations = JSON.parse(q['translations']!); } catch {}
    }

    // ✅ compute stable history key before init
    this.recomputeHistoryKey();
    await this.doInit();
  }
}
