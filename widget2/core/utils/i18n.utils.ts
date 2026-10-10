import { normalizeLangCode } from './lang.utils';

// A blank string ("" or whitespace) means the field was never filled in, not
// that it was deliberately set to nothing — so it must fall through to the
// next source in the chain the same way null/undefined does. Non-string
// values (e.g. roleLabels objects) are unaffected: != null is still enough
// for those.
function hasValue(v: any): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export function i18nPick<T = any>(base: any, lang: string, prop: string): T | undefined {
  const L = normalizeLangCode(lang);
  const scope = base?.i18n || base?.widgetParams?.i18n;

  if (scope?.[L] && hasValue(scope[L][prop])) return scope[L][prop] as T;
  if (hasValue(base?.widgetParams?.[prop])) return base.widgetParams[prop] as T;
  if (hasValue(base?.[prop])) return base[prop] as T;

  return undefined;
}

export function i18nPickStringArray(base: any, lang: string, prop: string): string[] {
  const L = normalizeLangCode(lang);
  const scope = base?.i18n || base?.widgetParams?.i18n;
  let v: any;

  if (scope?.[L]) {
    const node = scope[L];

    if (Array.isArray(node?.[prop])) {
      v = node[prop];
    } else if (prop === 'info' || prop === 'infoThink') {
      const it = node?.infoText;
      if (Array.isArray(it?.[prop])) v = it[prop];
    } else if (prop === 'infoText') {
      v = Array.isArray(node?.infoText) ? node.infoText : undefined;
    }
  }

  if (!v) {
    if (prop === 'info' || prop === 'infoThink') {
      const it = base?.widgetParams?.infoText || base?.infoText;
      if (Array.isArray(it?.[prop])) v = it[prop];
    } else {
      if (Array.isArray(base?.widgetParams?.[prop])) v = base.widgetParams[prop];
      else if (Array.isArray(base?.[prop])) v = base[prop];
    }
  }

  if (Array.isArray(v)) return v.map((x: any) => String(x)).filter(Boolean);
  return [];
}

// `suggestions` and `infoText` arrive either flat (['a','b'] / {info,infoThink})
// or keyed by language ({ no: [...], en: [...] }).
//
// Flat is language-agnostic and used as-is. A language map is used only if it
// has the visitor's language — otherwise nothing, and the caller falls back to
// the widget's pack. Another language is never substituted: a German visitor is
// better served by the widget's German than by the app's Norwegian.

/**
 * The app's copy for a language, from widgetParams.paramsLang, or undefined —
 * which lets the caller fall through to the flat fields, then the packs.
 */
export function pickParamsLangForLang(wp: any, lang: string): any | undefined {
  const map = wp?.paramsLang;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined;

  // paramsLang was a lone entry before it became a map, so old documents may
  // still hold that shape: copy at the top level rather than language codes.
  // Honoured only when it does not claim a different language.
  const looksLikeOneEntry =
    map.title !== undefined ||
    map.welcomeText !== undefined ||
    map.suggestions !== undefined ||
    map.infoText !== undefined;

  if (looksLikeOneEntry) {
    const claimed = normalizeLangCode(String(map.lang || ''), '');
    return !claimed || claimed === normalizeLangCode(lang) ? map : undefined;
  }

  const L = normalizeLangCode(lang);
  const entry = map[L] ?? map[String(lang || '').toLowerCase()];

  return entry && typeof entry === 'object' ? entry : undefined;
}

/** True for a plain object we can treat as a language-keyed map. */
function isLangMap(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function toStringArray(v: any): string[] {
  return Array.isArray(v)
    ? v.map((x: any) => String(x).trim()).filter((s: string) => s.length > 0)
    : [];
}

/**
 * Returns undefined — not [] — when a language map lacks `lang`, so the caller
 * can tell "said nothing" from "said: none".
 */
export function pickStringArrayForLang(value: any, lang: string): string[] | undefined {
  if (Array.isArray(value)) return toStringArray(value);

  if (isLangMap(value)) {
    const L = normalizeLangCode(lang);
    const forLang = value[L] ?? value[String(lang || '').toLowerCase()];
    return Array.isArray(forLang) ? toStringArray(forLang) : undefined;
  }

  return undefined;
}

/**
 * Flat and by-language are told apart by content, not by guessing at key names:
 * a node carrying `info` or `infoThink` is flat.
 */
export function pickInfoTextForLang(
  value: any,
  lang: string,
): { info: string[]; infoThink: string[] } | undefined {
  if (!isLangMap(value)) return undefined;

  const flat = value.info !== undefined || value.infoThink !== undefined;

  const node = flat
    ? value
    : (value[normalizeLangCode(lang)] ?? value[String(lang || '').toLowerCase()]);

  if (!isLangMap(node)) return undefined;

  return { info: toStringArray(node.info), infoThink: toStringArray(node.infoThink) };
}
