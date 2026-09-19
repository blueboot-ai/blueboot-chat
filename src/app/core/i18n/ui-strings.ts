// src/app/widget2/i18n/ui-strings.ts
//
// The widget's localized content, compiled into the bundle.
//
// Embedded rather than fetched on purpose: the widget is installed on arbitrary
// customer sites, where there is no asset path of ours to load from. A runtime
// fetch would either 404 against the host's own origin or depend on a CDN being
// reachable and CORS-configured — all risk, no benefit, for content this small.
// Compiled in, the widget reads correctly on first paint, offline, and behind a
// corporate proxy alike.
//
// One file per language, each divided into sections:
//
//   identity     title, welcomeText          -> flattened into t()
//   chrome       buttons, labels             -> flattened into t()
//   feedback     the feedback control        -> flattened into t()
//   suggestions  starter prompts             -> DEFAULT_SUGGESTIONS
//   infoText     "thinking…" ticker lines    -> DEFAULT_INFO_TEXT
//
// The three string sections are flattened into one map per language, so t()
// still does a single flat lookup while the files stay readable. Each section
// is typed separately (UiIdentityKey / UiChromeKey / UiFeedbackKey), so a pack
// missing a key fails the build and a key cannot drift into the wrong section.

import {
  UIStringKey,
  UiIdentityKey,
  UiChromeKey,
  UiFeedbackKey,
} from '../models/ui-types';

import noPack from './no.json';
import enPack from './en.json';
import frPack from './fr.json';
import arPack from './ar.json';
import dePack from './de.json';
import ukPack from './uk.json';
import svPack from './sv.json';
import daPack from './da.json';
import fiPack from './fi.json';
import itPack from './it.json';
import esPack from './es.json';
import ptPack from './pt.json';
import plPack from './pl.json';
import hePack from './he.json';
import zhPack from './zh.json';
import jaPack from './ja.json';
import koPack from './ko.json';
import ruPack from './ru.json';

export const DEFAULT_LANG = 'no';

/** The shape every language file must have. */
type LanguagePack = {
  identity: Record<UiIdentityKey, string>;
  chrome: Record<UiChromeKey, string>;
  feedback: Record<UiFeedbackKey, string>;
  suggestions: string[];
  infoText: { info: string[]; infoThink: string[] };
};

const PACKS: Record<string, LanguagePack> = {
  en: enPack,
  no: noPack,
  de: dePack,
  sv: svPack,
  da: daPack,
  fi: fiPack,
  fr: frPack,
  it: itPack,
  ar: arPack,
  es: esPack,
  pt: ptPack,
  uk: ukPack,
  pl: plPack,
  he: hePack,
  zh: zhPack,
  ja: jaPack,
  ko: koPack,
  ru: ruPack,
};

function flattenStrings(pack: LanguagePack): Record<UIStringKey, string> {
  return {
    ...pack.identity,
    ...pack.chrome,
    ...pack.feedback,
  };
}

function byLang<T>(select: (pack: LanguagePack) => T): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [lang, pack] of Object.entries(PACKS)) out[lang] = select(pack);
  return out;
}

/* ================= UI STRINGS ================= */

export const DEFAULT_UI_TRANSLATIONS: Record<string, Record<UIStringKey, string>> =
  byLang(flattenStrings);

/* ================= SUGGESTIONS ================= */

export const DEFAULT_SUGGESTIONS: Record<string, string[]> =
  byLang(pack => pack.suggestions);

/* ================= INFO TEXT ================= */

export const DEFAULT_INFO_TEXT: Record<string, { info: string[]; infoThink: string[] }> =
  byLang(pack => pack.infoText);

/* ================= HELPERS ================= */

export function pickLang<T>(
  map: Record<string, T>,
  lang?: string,
  fallback: string = DEFAULT_LANG
): T {
  return map[lang || ''] || map[fallback] || map[DEFAULT_LANG];
}
