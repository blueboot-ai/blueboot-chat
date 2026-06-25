import { RoleKey, LocaleCode, TranslationsMap } from './ui-types';

export interface WidgetParams {
  backColor?: string;
  suggestions?: boolean;
  // keep legacy union if you have old data; otherwise drop 'seachfield'
  type?: 'searchfield' | 'bot' | 'seachfield';

  title?: string;
  logoSrc?: string;
  logoAlt?: string;
  robotSrc?: string;

  headerLogoBg?: string;
  headerLogoRound?: boolean;
  headerLogoInitial?: boolean;

  welcomeText?: string;

  // ✅ current language (user-selected)
  lang?: LocaleCode;

  // ✅ NEW: default language to fallback to when keys are missing
  // If not provided, we will default to "no"
  defaultLang?: LocaleCode;

  // ✅ translations for all languages
  translations?: TranslationsMap;

  roleLabels?: Partial<Record<RoleKey, string>>;
  roleAvatars?: Partial<Record<RoleKey, string>>;
  roleAvatarImages?: Partial<Record<RoleKey, string>>;
  roleAvatarBg?: Partial<Record<RoleKey, string>>;

  draggable?: boolean;
  compactWidth?: number;
  compactHeight?: number;
  sideOffset?: number;
  gap?: number;
}

export interface WidgetApp {
  appId: string;
  ownerSiteUrl?: string;
  displayName?: string;
  widgetParams: WidgetParams;   // REQUIRED
  description?: string;
  suggestions?: string[];
  siteUrl?: string
}
