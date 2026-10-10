// Copied from shared-library/src/models/languages.ts so widget2 can build
// without depending on the shared-library module (see shared/README below).
// Kept verbatim: this file has no imports of its own, so nothing here needed
// trimming.
//
// The languages this product speaks, in one place.
//
// Deliberately data only: no detection, no storage, no Angular. What is
// shared is the answer to "which languages exist and what is each one
// called", which is the same everywhere.

/** Every language code the product supports. */
export const SUPPORTED_LANGS = [
    'en', 'no', 'de', 'sv', 'da', 'fi', 'fr', 'it',
    'ar', 'es', 'pt', 'uk', 'pl', 'he', 'zh', 'ja', 'ko',
    'ru'
];

/** The name of each language, written in that language (endonyms). */
export const LANG_ENDONYMS: Record<string, string> = {
    no: 'Norsk',
    en: 'English',
    de: 'Deutsch',
    sv: 'Svenska',
    da: 'Dansk',
    fi: 'Suomi',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    he: 'עברית',
    pl: 'Polski',
    it: 'Italiano',
    uk: 'Українська',
    ja: '日本語',
    ko: '한국어',
    ar: 'العربية',
    zh: '中文',
    ru: 'Русский',
};

/** A country's most likely language, for the IP-based *offer*. */
export const COUNTRY_LANG_MAP: Record<string, string> = {
    NO: 'no', SJ: 'no',
    DE: 'de', AT: 'de', CH: 'de', LI: 'de',
    SE: 'sv',
    DK: 'da',
    FI: 'fi',
    FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
    IT: 'it',
    ES: 'es', MX: 'es', AR: 'es',
    BR: 'pt', PT: 'pt',
    RU: 'ru',
    UA: 'uk',
    PL: 'pl',
    IL: 'he',
    CN: 'zh', TW: 'zh', HK: 'zh',
    JP: 'ja',
    KR: 'ko',
    SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar',
    JO: 'ar', LB: 'ar', IQ: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', LY: 'ar', YE: 'ar',
    GB: 'en', US: 'en', IE: 'en', CA: 'en', AU: 'en', NZ: 'en', ZA: 'en', IN: 'en',
};

/** The name to show for a language code. Falls back to the code itself. */
export function langEndonym(code: string): string {
    return LANG_ENDONYMS[code] || String(code || '').toUpperCase();
}

/** Does the product ship this language? */
export function isSupportedLang(code: string): boolean {
    return SUPPORTED_LANGS.includes(code);
}

/** The language used when nothing else is known. */
export const DEFAULT_APP_LANG = 'no';

/** A stored or incoming language code, reduced to one of SUPPORTED_LANGS. */
export function normalizeLang(value: unknown, fallback: string = DEFAULT_APP_LANG): string {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;

    const code = raw.split(/[-_]/)[0];

    const mapped =
        code === 'nb' || code === 'nn' ? 'no' :
        code === 'ua' ? 'uk' :
        code;

    return isSupportedLang(mapped) ? mapped : fallback;
}

/** The language to offer a visitor in a given country, or undefined. */
export function offerLanguageForCountry(countryCode?: string | null): string | undefined {
    const key = String(countryCode ?? '').trim().toUpperCase();
    if (!key) return undefined;

    const lang = COUNTRY_LANG_MAP[key];
    return lang && isSupportedLang(lang) ? lang : undefined;
}
