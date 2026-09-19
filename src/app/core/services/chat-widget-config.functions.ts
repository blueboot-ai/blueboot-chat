// src/app/widget2/core/services/chat-widget-config.functions.ts
//
// Was ChatWidgetConfigService (@Injectable providedIn:'root'). Stateless and
// dependency-free: a pure transform from the app config the backend returns
// into the resolved values the chat renders. The former `private` helpers are
// now module-private; only buildConfig/getStrings/getEffectiveLang/
// sanitizeUsername are exported, matching what is actually called from
// outside.

import { WidgetApp } from '../models/widget-app';
import { DEFAULT_LANG, DEFAULT_UI_TRANSLATIONS } from '../i18n/ui-strings';
import { Role } from '../models/chat-message.model';
import { normalizeLangCode } from '../utils/lang.utils';
import {
  i18nPick,
  i18nPickStringArray,
  pickStringArrayForLang,
  pickInfoTextForLang,
  pickParamsLangForLang,
} from '../utils/i18n.utils';

export type ChatWidgetConfigInput = {
  app: WidgetApp;

  currentTitle: string;
  currentWelcomeText: string;
  currentDisplayName?: string;
  currentDescription?: string;

  lang: string;
  defaultLang?: string;

  username?: string;

  roleAvatars?: Partial<Record<Role, string>>;
  roleAvatarImages?: Partial<Record<Role, string>>;

  // No headerIsRound / headerLogoInitialLocal / headerLogoBg here either. They
  // are not host attributes, so there was nothing for buildConfig to prefer
  // over the app — and passing them in is what stopped the app's own values
  // from ever landing. They are resolved from widgetParams below and written
  // back onto the component by applyConfig.

  // No send-icon fields. The send mark is fixed — always the compiled-in mark,
  // never anything from the app config — so it is resolved where the assets
  // live (sendIconFor in core/assets/default-logo.ts) rather than taking a
  // round trip through the backend's answer to arrive at a constant. Leaving it
  // on the config result also made it look like a setting could write it.
};

export type ChatWidgetConfigResult = {
  feedbackEnabled?: boolean;

  apiFontFamily?: string;
  apiFontSize?: string;
  apiLineHeight?: string;

  displayName?: string;
  description?: string;

  // No translations here. buildConfig used to merge and return them, and
  // applyConfig deliberately ignored the result — strings() re-merges from
  // appOrWp and the host's own overrides, because they change with the language
  // long after the config resolved. getStrings below is that merge.
  lang: string;

  title: string;
  welcomeText: string;

  suggestions: string[];

  info: string[];
  infoThink: string[];

  headerIsRound: boolean;
  headerLogoInitialLocal: boolean;
  headerLogoBg?: string;

  /** The app's role labels for this language, if it has any. */
  roleLabels?: Partial<Record<Role, string>>;

  logoCandidate?: string;
  avatarUrls: Partial<Record<Role, string>>;
  username?: string;
};

export function buildConfig(input: ChatWidgetConfigInput): ChatWidgetConfigResult {
  const app = input.app;
  const wp: any = (app?.widgetParams as any) || {};

  const effectiveLang = getEffectiveLang(input.lang);
  const def = getFallbackLang(input.defaultLang);

  // The app's own copy for this language, when it has any. First in line for
  // all four of title / welcomeText / suggestions / infoText: an app that wrote
  // German copy means it for German visitors, ahead of its language-agnostic
  // defaults and ahead of the widget's packs. Undefined when the app said
  // nothing for this language, which is what lets the chain continue.
  const forLang = pickParamsLangForLang(wp, effectiveLang);

  // A field the entry leaves blank has said nothing, so the chain continues to
  // the pack. Plain `??` would not do it: "" is neither null nor undefined, so
  // a blank entry field would swallow the pack default and blank the widget.
  const authored = (v: any): string | undefined =>
    typeof v === 'string' && v.trim() ? v : undefined;

  // paramsLang or the pack — nothing in between. The flat widgetParams.title /
  // welcomeText that used to sit here are the legacy shape: the console edits
  // paramsLang only, so a flat value was text an owner could see in the widget
  // and could not find in the settings, and it answered for every language at
  // once. The backend folds any that remain into paramsLang before the widget
  // sees them (public-service getGpt → migrateWidgetParamsLang), so an app that
  // has not been migrated in Firestore still renders correctly here.
  const titleL = authored(forLang?.title);

  const welcomeL = authored(forLang?.welcomeText);

  // Localized defaults from the compiled-in packs, for the *effective* language
  // — so switching language re-resolves them rather than keeping a stale seed.
  const packAll = (DEFAULT_UI_TRANSLATIONS || {}) as Record<string, any>;
  const packFor = (key: string): string =>
    String(packAll?.[effectiveLang]?.[key] ?? packAll?.[def]?.[key] ?? '');

  // Precedence: the app's own i18n → whatever the host explicitly set →
  // the localized pack default. currentTitle arrives empty when the component
  // is still carrying a pack default rather than a host-supplied value, which
  // is what lets the pack win here.
  const title =
    (typeof titleL === 'string' && titleL.trim())
      ? titleL.trim()
      : (input.currentTitle?.trim() || packFor('title'));

  // Same precedence as title, and blank counts as absent for the same reason.
  // i18nPick returns any value that is != null, so an app with no welcome text
  // of its own hands back "" — and testing only `typeof welcomeL === 'string'`
  // let that empty string win, blanking the widget instead of falling through
  // to the pack. The backend is not expected to supply a default: welcome text
  // for a language the app has not written is the frontend's to provide.
  //
  // Unlike title the value is not trimmed, only tested — leading or trailing
  // whitespace in a welcome someone actually wrote is theirs to keep.
  const welcomeText =
    (typeof welcomeL === 'string' && welcomeL.trim())
      ? welcomeL
      : (input.currentWelcomeText || packFor('welcomeText'));

  // paramsLang, then — by arriving empty — the packs, via
  // applyEmbeddedContentFallback. Emptiness is tested, not just absence: an
  // entry holding `suggestions: []` has written none, and the pack should fill
  // them. The flat wp.suggestions that used to sit between the two is the
  // legacy shape; see the note on titleL.
  const fromLangSuggestions = pickStringArrayForLang(forLang?.suggestions, effectiveLang);

  const suggestions = fromLangSuggestions?.length
    ? fromLangSuggestions
    : resolveSuggestions(wp, effectiveLang);

  // Same for the status lines, each half falling back on its own: an entry may
  // write `info` and leave `infoThink` to the pack. The explicit i18n scope
  // still outranks paramsLang here — it is an override someone set deliberately,
  // not a leftover shape.
  const fromLangInfo = pickInfoTextForLang(forLang?.infoText, effectiveLang);

  const infoFromScope = i18nPickStringArray(wp, effectiveLang, 'info');
  const thinkFromScope = i18nPickStringArray(wp, effectiveLang, 'infoThink');

  const infoArr =
    (infoFromScope.length && infoFromScope) ||
    (fromLangInfo?.info?.length && fromLangInfo.info) ||
    [];

  const thinkArr =
    (thinkFromScope.length && thinkFromScope) ||
    (fromLangInfo?.infoThink?.length && fromLangInfo.infoThink) ||
    [];

  /* Straight off the app, with no `input.X ??` in front of them.
   *
   * These three used to be resolved as `input.X ?? wp?.X ?? default`, on the
   * pattern the typography fields use — where `input` really is a host
   * attribute and should outrank the app. None of these is a host attribute:
   * they are plain fields on ChatCoreComponent, initialised to `true`, `true`
   * and `''`. A non-nullish left-hand side means `??` never reached the app, so
   * the admin's "Round logo chip" and "Show initial when no logo" checkboxes
   * decided nothing at all, and headerLogoBg landed on the panel (undefined
   * there) but never on the embed (`''`, which is not nullish).
   *
   * There was a second failure hiding behind the same line: applyConfig writes
   * the resolved values back onto those fields, so on any later config load the
   * left-hand side held the *previous* answer and the app's own value could not
   * change it.
   */
  /* false, not true. The backend used to seed both as false on every app, so
     false is what every widget has actually been showing; the `?? true` here
     was unreachable and disagreed with it. Now that nothing is seeded, this is
     the only default, so it has to be the one that was in effect. */
  const headerIsRound = wp?.headerLogoRound ?? false;
  const headerLogoInitialLocal = wp?.headerLogoInitial ?? false;
  const headerLogoBg = wp?.headerLogoBg || undefined;

  // Was resolved only in the launcher, which meant the embed never picked up
  // an app's role labels at all. Same shape as the rest: the app's localized
  // value, then its language-agnostic one.
  const roleLabels =
    i18nPick<Partial<Record<Role, string>>>(wp, effectiveLang, 'roleLabels') ??
    i18nPick<Partial<Record<Role, string>>>(wp, def, 'roleLabels') ??
    (wp?.roleLabels as Partial<Record<Role, string>> | undefined);

  const avatarUrls = resolveAvatarUrls(app, input);

  // userId used to sit at the end of this chain as a last-resort name. It is
  // gone with the rest of the parameter: an id is not a name, and a host that
  // wanted one shown has `username`, which says so. Falling back to it meant a
  // visitor could see a database key captioning their own messages.
  const cleanInputName = sanitizeUsername(input.username);
  const apiDisplayName = sanitizeUsername((app as any)?.currentUser?.displayName);
  const username = cleanInputName || apiDisplayName;

  return {
    feedbackEnabled: typeof wp?.feedbackEnabled === 'boolean' ? wp.feedbackEnabled : undefined,

    apiFontFamily: wp?.fontFamily ?? wp?.uiFontFamily,
    apiFontSize: wp?.fontSize ?? wp?.uiFontSize,
    apiLineHeight: wp?.lineHeight ?? wp?.uiLineHeight,

    displayName: app?.displayName ?? input.currentDisplayName,
    description: app?.description ?? input.currentDescription,

    lang: effectiveLang,

    title,
    welcomeText,

    suggestions,

    info: infoArr.filter(s => !!String(s).trim()),
    infoThink: thinkArr.filter(s => !!String(s).trim()),

    headerIsRound,
    headerLogoInitialLocal,
    headerLogoBg,

    roleLabels,

    // Only a real backend logo. `undefined` here means "backend said
    // nothing" — the caller (computedLogo()) then falls through to a local
    // [logoSrc] input, and only after that to the compiled-in default. If
    // this returned the compiled-in default whenever the backend had none,
    // it would permanently shadow a host's own local logo setting.
    logoCandidate: typeof wp?.logoSrc === 'string' && wp.logoSrc.trim()
      ? wp.logoSrc.trim()
      : undefined,

    avatarUrls,

    username,
  };
}

/**
 * Flattens the UI string packs into one lookup, in precedence order:
 *
 *   1. compiled-in defaults   (fallback lang, then active lang)
 *   2. the app's own translations from widgetParams
 *   3. host-page overrides
 *
 * All three are available synchronously — the widget's own strings are compiled
 * into the bundle rather than fetched, because it runs on arbitrary customer
 * sites where there is no asset path to fetch from.
 */
export function getStrings(
  widgetParams: any,
  langRaw: string,
  defaultLangRaw?: string,
  translations?: Partial<Record<string, any>>
): Record<string, string> {
  const wp = widgetParams || {};
  const dbAll = (wp?.translations || {}) as Record<string, any>;
  const lang = getEffectiveLang(langRaw);
  const def = getFallbackLang(defaultLangRaw);

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

/**
 * The language to render in.
 *
 * Only the caller's own value, or the built-in default. It used to fall back to
 * widgetParams.defaultLang / .lang, but the API no longer carries a language at
 * all — the visitor's browser decides, and the app's copy is then looked up for
 * whatever that turned out to be.
 */
export function getEffectiveLang(langRaw: string | undefined): string {
  return normalizeLangCode(langRaw || DEFAULT_LANG);
}

/** Module-private: only getStrings() needs it. The host may still name a
 *  fallback language; the API cannot. */
function getFallbackLang(defaultLang?: string): string {
  return normalizeLangCode(defaultLang || DEFAULT_LANG);
}

/** Drops placeholder identities ('anon', 'user7', …) so they never render as a name. */
export function sanitizeUsername(v?: string): string | undefined {
  const s = String(v || '').trim();
  if (!s) return undefined;

  const bad = ['anon', 'anonymous'];
  if (bad.includes(s.toLowerCase())) return undefined;
  if (/^user\d*$/i.test(s)) return undefined;

  return s;
}

// ============================================================
// Module-private
// ============================================================

function resolveSuggestions(wp: any, effectiveLang: string): string[] {
  // The explicit i18n scope (wp.i18n[lang].suggestions) — an override someone
  // set deliberately, unlike the flat wp.suggestions that used to be consulted
  // after it. That one was the legacy shape and is gone; see the note on
  // titleL. [] leaves the hole applyEmbeddedContentFallback fills from the pack.
  return i18nPickStringArray(wp, effectiveLang, 'suggestions');
}

function resolveAvatarUrls(
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

  // Deliberately not reading wp/top.roleAvatars here: per shared-library's
  // model that field is a letters/text fallback ("U", "A" …), not a URL —
  // using it as an <img src> just renders a broken image where an app
  // hasn't configured a real avatar. roleAvatarImages is the actual URL map.
  const pick = (...vals: any[]) =>
    vals.find(v => typeof v === 'string' && v.trim())?.trim() as string | undefined;

  // Every role resolves the same way: the host's value, then the app's avatar
  // map, then nothing.
  //
  // The assistant used to have six more fallbacks after those two —
  // assistantSrc, robotSrc and launcherSrc, on widgetParams and again at the
  // top level. robotSrc is the launcher button's icon, so removing an
  // assistant avatar did not clear it: the robot from the corner of the page
  // appeared beside every reply instead, which reads as a different assistant
  // rather than as no avatar.
  //
  // Those fields answer a different question. The launcher icon is what the
  // closed widget looks like on a page; the avatar is who is speaking in the
  // conversation. An app that set one never asked for the other.
  //
  // So an unset assistant avatar now means no avatar — a plain colour circle,
  // exactly like user and error, which is what the comment on
  // MessageComponent.showAvatar already said the rule was. The header logo is
  // unaffected: computedLogo() in chat-core still falls back to the compiled
  // mark, because a header with no logo at all would be a blank band.
  (['user', 'assistant', 'error'] as Role[]).forEach(role => {
    result[role] = pick((host as any)[role], (apiImgs as any)[role]);
  });

  return result;
}

