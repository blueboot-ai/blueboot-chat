// Copied from shared-library/src/models/widget-app.ts so widget2 can build
// without depending on the shared-library module (see widget2/shared/README.md).
//
// Two simplifications from the original, both because widget2 never reads or
// writes the affected fields:
//   - SiteInfo is inlined here as a trimmed standalone copy (from
//     shared-library/src/models/rag-app.ts) instead of importing the whole
//     rag-app module.
//     shared-library's TimestampLike, which pulls in a Firestore Timestamp
//     type.
// ConsoleWidgetApp and DemoPageApp were left out entirely: nothing in
// widget2 imports either one.

/* ---------- shared helper types for WidgetParams ---------- */
export type RoleKey = "user" | "assistant" | "error";
export type LocaleCode = "no" | "en" | string;

export type UIStringKey =
    | 'expand'
    | 'restore'
    | 'newChat'
    | 'closeChat'
    | 'you'
    | 'assistant'
    | 'error'
    | 'copy'
    | 'copied'
    | 'sending'
    | 'send'
    | 'more'
    | 'suggestions'
    | 'close'
    | 'useText'
    | 'feedbackTitle'
    | 'feedbackSubtitle'
    | 'feedbackPlaceholder'
    | 'feedbackSubmit'
    | 'feedbackCancel'
    | 'feedbackGroupLabel'
    | 'feedbackPositive'
    | 'feedbackNeutral'
    | 'feedbackNegative';

export type TranslationsMap = Partial<Record<string, Partial<Record<UIStringKey, string>>>>;

/** Thinking/status strings used while the model is preparing a reply. */
export interface InfoText {
  info?: string[];
  infoThink?: string[];
}

export interface WidgetParamsLang {
  lang?: string;
  title?: string;
  welcomeText?: string;
  suggestions?: string[];
  infoText?: InfoText;
}

/** Per-language widget copy, keyed by language code ("no", "en", …). */
export type WidgetParamsLangMap = Partial<Record<string, WidgetParamsLang>>;

/** widgetParams keys that were once stored and are now read by nothing. */
export const RETIRED_WIDGET_PARAM_FIELDS = [
  'colorTheme',
  'bluebootLogoTheme',
  'type',
  'inputBorder',
  'inputText',
] as const;

/** The route that serves widget media. Public-service; see its widgetMedia handler. */
export const WIDGET_MEDIA_PATH = '/api/public/widget-media/';

/** Trimmed standalone copy of shared-library's rag-app.ts SiteInfo — only
 *  used here as the type of WidgetApp.siteInfo. */
export interface SiteInfo {
    title?:    string;
    icon?:     string;
    type?:     string;
    country?:  string;
    lang?:     string;
    currency?: string;
    keywords?: string[];
    summary?:  string;
    checkedAt: number;
}

/** UI params for the Blue Search widget. */
export interface WidgetParams {
  backColor?: string;
  messageColor?: string;
  fontColor?: string;

  /** @deprecated Header title override — use paramsLang[lang].title. */
  title?: string;

  logoSrc?: string;
  logoAlt?: string;
  robotSrc?: string;

  headerLogoBg?: string;
  headerLogoRound?: boolean;
  headerLogoInitial?: boolean;

  headerBg?: string;

  /** @deprecated Use paramsLang[lang].welcomeText — see the note on `title`. */
  welcomeText?: string;

  paramsLang?: WidgetParamsLangMap;

  roleLabels?: Partial<Record<RoleKey, string>>;
  roleAvatars?: Partial<Record<RoleKey, string>>;       // letters/text fallback
  roleAvatarImages?: Partial<Record<RoleKey, string>>;  // URLs for images
  roleAvatarBg?: Partial<Record<RoleKey, string>>;      // CSS colors

  draggable?: boolean;
  compactWidth?: number;
  compactHeight?: number;
  sideOffset?: number;
  gap?: number;

  translations?: TranslationsMap;

  /** @deprecated Use paramsLang[lang].infoText — see the note on `title`. */
  infoText?: InfoText;

  /** Toggle to show quick-start suggestion chips in the widget UI. */
  enableSuggestion?: boolean;

  /** @deprecated Use paramsLang[lang].suggestions — see the note on `title`. */
  suggestions?: string[];

  openOnHover?: boolean;
  hoverOpenDelayMs?: number;

  // global css typography
  fontFamily?: string;
  fontSize?: string;     // e.g. "14px"
  lineHeight?: string;   // e.g. "1.45"

  enableLauncherVideo?: boolean;
  launcherVideoSrc?: string;
}

/**
 * What an unauthenticated visitor's browser is allowed to see about an app —
 * the wire shape of PublicService.getGpt() (/api/get-app).
 */
export interface WidgetApp {
  appId: string;
  appName: string;
  displayName?: string;

  widgetParams: WidgetParams;
  description?: string;
  siteUrl?: string;

  /** What the last site check observed about the site — see SiteInfo. */
  siteInfo?: SiteInfo;

  /** Sanitized view of Gpt.externalChat. */
  externalChat?: { external: boolean; name: string; type: string; askForContact?: boolean };
}
