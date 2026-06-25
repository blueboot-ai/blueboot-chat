import { Injectable } from '@angular/core';

import { WidgetApp } from '../../models/widget-app';
import { DEFAULT_LANG, DEFAULT_UI_TRANSLATIONS } from '../../../shared-library/models/ui-default';
import { Role } from '../models/chat-message.model';
import { normalizeLangCode } from '../utils/lang.utils';
import { i18nPick, i18nPickStringArray, mergeTranslations } from '../utils/i18n.utils';

export type ChatWidgetConfigInput = {
  app: WidgetApp;

  currentTitle: string;
  currentWelcomeText: string;
  currentDisplayName?: string;
  currentDescription?: string;

  lang: string;
  defaultLang?: string;
  translations?: Partial<Record<string, any>>;

  username?: string;
  userId?: string;

  roleAvatars?: Partial<Record<Role, string>>;
  roleAvatarImages?: Partial<Record<Role, string>>;

  headerIsRound: boolean;
  headerLogoInitialLocal: boolean;
  headerLogoBg?: string;

  assetsBase: string;

  sendIconDarkBundle: string;
  sendIconLightBundle: string;
};

export type ChatWidgetConfigResult = {
  feedbackEnabled?: boolean;

  apiFontFamily?: string;
  apiFontSize?: string;
  apiLineHeight?: string;

  displayName?: string;
  description?: string;

  lang: string;
  translations?: Partial<Record<string, any>>;

  title: string;
  welcomeText: string;

  suggestions: string[];

  info: string[];
  infoThink: string[];

  headerIsRound: boolean;
  headerLogoInitialLocal: boolean;
  headerLogoBg?: string;

  logoCandidate?: string;
  avatarUrls: Partial<Record<Role, string>>;

  username?: string;

  sendIconReady?: string;
};

@Injectable({
  providedIn: 'root',
})
export class ChatWidgetConfigService {
  buildConfig(input: ChatWidgetConfigInput): ChatWidgetConfigResult {
    const app = input.app;
    const wp: any = (app?.widgetParams as any) || {};

    const effectiveLang = this.getEffectiveLang(input.lang, wp);
    const apiTransAll = wp?.translations || {};

    const translations = mergeTranslations(
      input.translations,
      apiTransAll,
      input.translations
    );

    const titleL =
      i18nPick<string>(wp, effectiveLang, 'title') ??
      i18nPick<string>(app, effectiveLang, 'title');

    const welcomeL =
      i18nPick<string>(wp, effectiveLang, 'welcomeText') ??
      i18nPick<string>(app, effectiveLang, 'welcomeText');

    const title =
      typeof titleL === 'string' && titleL.trim()
        ? titleL.trim()
        : input.currentTitle;

    const welcomeText =
      typeof welcomeL === 'string'
        ? welcomeL
        : input.currentWelcomeText;

    const suggestions = this.resolveSuggestions(app, wp, effectiveLang);

    const infoArr = i18nPickStringArray(wp, effectiveLang, 'info') || [];
    const thinkArr = i18nPickStringArray(wp, effectiveLang, 'infoThink') || [];

    const headerIsRound = input.headerIsRound ?? wp?.headerLogoRound ?? true;
    const headerLogoInitialLocal = input.headerLogoInitialLocal ?? wp?.headerLogoInitial ?? true;
    const headerLogoBg = input.headerLogoBg ?? wp?.headerLogoBg;

    const avatarUrls = this.resolveAvatarUrls(app, input);

    const cleanInputName = this.sanitizeUsername(input.username);
    const apiDisplayName = this.sanitizeUsername((app as any)?.currentUser?.displayName);
    const cleanUserId = this.sanitizeUsername(input.userId);
    const username = cleanInputName || apiDisplayName || cleanUserId;

    return {
      feedbackEnabled: typeof wp?.feedbackEnabled === 'boolean' ? wp.feedbackEnabled : undefined,

      apiFontFamily: wp?.fontFamily ?? wp?.uiFontFamily,
      apiFontSize: wp?.fontSize ?? wp?.uiFontSize,
      apiLineHeight: wp?.lineHeight ?? wp?.uiLineHeight,

      displayName: app?.displayName ?? input.currentDisplayName,
      description: app?.description ?? input.currentDescription,

      lang: effectiveLang,
      translations,

      title,
      welcomeText,

      suggestions,

      info: infoArr.filter(s => !!String(s).trim()),
      infoThink: thinkArr.filter(s => !!String(s).trim()),

      headerIsRound,
      headerLogoInitialLocal,
      headerLogoBg,

      logoCandidate: typeof wp?.logoSrc === 'string' && wp.logoSrc.trim()
        ? wp.logoSrc.trim()
        : undefined,

      avatarUrls,

      username,

      sendIconReady: this.prepareSendIcon(
        input.assetsBase,
        input.sendIconDarkBundle,
        input.sendIconLightBundle
      ),
    };
  }

  getStrings(
    widgetParams: any,
    langRaw: string,
    defaultLangRaw?: string,
    translations?: Partial<Record<string, any>>
  ): Record<string, string> {
    const wp = widgetParams || {};
    const dbAll = (wp?.translations || {}) as Record<string, any>;
    const lang = this.getEffectiveLang(langRaw, wp);
    const def = this.getFallbackLang(wp, defaultLangRaw);

    const pickPack = (all: Record<string, any>, code: string) =>
      ((all?.[code] || {}) as Record<string, string>);

    const baseAll = (DEFAULT_UI_TRANSLATIONS || {}) as Record<string, any>;
    const baseLang = pickPack(baseAll, lang);
    const baseDef = pickPack(baseAll, def);

    const dbLang = pickPack(dbAll, lang);
    const dbDef = pickPack(dbAll, def);

    const hostPatchLang = ((translations as any)?.[lang] || {}) as Record<string, string>;
    const hostPatchDef = ((translations as any)?.[def] || {}) as Record<string, string>;

    return {
      ...baseDef,
      ...baseLang,
      ...dbDef,
      ...dbLang,
      ...hostPatchDef,
      ...hostPatchLang,
    };
  }

  getEffectiveLang(langRaw: string | undefined, widgetParams: any): string {
    const wp = widgetParams || {};
    return normalizeLangCode(langRaw || wp?.defaultLang || wp?.lang || DEFAULT_LANG);
  }

  getFallbackLang(widgetParams: any, defaultLang?: string): string {
    const wp = widgetParams || {};
    return normalizeLangCode(
      wp?.defaultLang || defaultLang || wp?.lang || DEFAULT_LANG
    );
  }

  sanitizeUsername(v?: string): string | undefined {
    const s = String(v || '').trim();
    if (!s) return undefined;

    const bad = ['anon', 'anonymous'];
    if (bad.includes(s.toLowerCase())) return undefined;
    if (/^user\d*$/i.test(s)) return undefined;

    return s;
  }

  private resolveSuggestions(app: WidgetApp, wp: any, effectiveLang: string): string[] {
    let suggestions: string[];

    if (wp?.suggestions === true && Array.isArray((app as any)?.suggestions)) {
      suggestions = ((app as any).suggestions as unknown[])
        .slice(0)
        .map((s: unknown) => String(s).trim())
        .filter((v: string) => v.length > 0);
    } else {
      const fromI18n = i18nPickStringArray(wp, effectiveLang, 'suggestions');
      const fromWp = Array.isArray(wp?.suggestions) ? (wp.suggestions as string[]) : [];

      suggestions = (fromI18n.length ? fromI18n : (fromWp as unknown[]))
        .map((s: unknown) => String(s).trim())
        .filter((v: string) => v.length > 0);
    }

    return suggestions.slice(0);
  }

  private resolveAvatarUrls(
    app: WidgetApp,
    input: ChatWidgetConfigInput
  ): Partial<Record<Role, string>> {
    const result: Partial<Record<Role, string>> = {};
    const host = (input.roleAvatarImages ?? input.roleAvatars) || {};
    const wp: any = (app?.widgetParams as any) || {};
    const top: any = (app as any) || {};

    const apiImgs =
      (wp?.roleAvatarImages && typeof wp.roleAvatarImages === 'object') ? wp.roleAvatarImages :
        (top?.roleAvatarImages && typeof top.roleAvatarImages === 'object') ? top.roleAvatarImages :
          {};

    const apiAvatars =
      (wp?.roleAvatars && typeof wp.roleAvatars === 'object') ? wp.roleAvatars :
        (top?.roleAvatars && typeof top.roleAvatars === 'object') ? top.roleAvatars :
          {};

    const pick = (...vals: any[]) =>
      vals.find(v => typeof v === 'string' && v.trim())?.trim() as string | undefined;

    (['user', 'assistant', 'error'] as Role[]).forEach(role => {
      const fromHost = (host as any)[role];
      const fromApiImg = (apiImgs as any)[role];
      const fromApiAvatar = (apiAvatars as any)[role];

      if (role === 'assistant') {
        result[role] = pick(
          fromHost,
          fromApiImg,
          fromApiAvatar,
          wp?.assistantSrc,
          wp?.robotSrc,
          wp?.launcherSrc,
          top?.assistantSrc,
          top?.robotSrc,
          top?.launcherSrc
        );
        return;
      }

      result[role] = pick(fromHost, fromApiImg, fromApiAvatar);
    });

    return result;
  }

  private prepareSendIcon(
    assetsBase: string,
    darkBundle: string,
    lightBundle: string
  ): string | undefined {
    const rel = this.pickSendIconRel(darkBundle, lightBundle);

    if (!rel || !String(rel).trim()) {
      return undefined;
    }

    const cleanRel = String(rel).replace(/^\.?\/*/, '');
    const base = this.normalizeBase(assetsBase);

    if (base) {
      return cleanRel.startsWith('assets/')
        ? `${base}${cleanRel}`
        : `${base}assets/${cleanRel}`;
    }

    return cleanRel.startsWith('assets/')
      ? `/${cleanRel}`
      : `/assets/${cleanRel}`;
  }

  private pickSendIconRel(darkBundle: string, lightBundle: string): string | undefined {
    const theme = this.resolveLogoTheme();

    return theme === 'dark'
      ? darkBundle
      : lightBundle;
  }

  private resolveLogoTheme(): 'dark' | 'light' {
    return 'dark';
  }

  private normalizeBase(u?: string): string {
    const s = String(u || '').trim();
    if (!s) return '';
    return s.endsWith('/') ? s : (s + '/');
  }
}
