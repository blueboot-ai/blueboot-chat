// Copied from shared-library/src/models/lang-detect.ts so widget2 can build
// without depending on the shared-library module (see shared/README below).
// Only import changed: pulls SUPPORTED_LANGS/normalizeLang from this
// widget2/shared's own ./languages instead of shared-library's.
//
// Browser-only and framework-free: localStorage, navigator. Picks a language
// when nobody has said which one.

import {
    SUPPORTED_LANGS,
    normalizeLang,
} from './languages';

/** The language to show someone we know nothing about. */
export const DEFAULT_DETECTED_LANG = 'en';

/** Where a resolved language is remembered, for every surface. */
export const LANG_STORAGE_KEY = 'preferredLang';

/** Languages the caller can actually render. */
export type LangOptions = {
    supported?: readonly string[];
    /** Returned when nothing is known. Defaults to DEFAULT_DETECTED_LANG. */
    fallback?: string;
};

function isRenderable(code: string, supported: readonly string[]): boolean {
    return !!code && supported.includes(code);
}

/** The remembered language, or undefined. */
export function readStoredLang(opts: LangOptions = {}): string | undefined {
    const supported = opts.supported ?? SUPPORTED_LANGS;

    try {
        const raw = localStorage.getItem(LANG_STORAGE_KEY);
        if (!raw) return undefined;

        const code = normalizeLang(raw, '');
        return isRenderable(code, supported) ? code : undefined;
    } catch {
        return undefined;
    }
}

/** Remember a language. Best effort. */
export function writeStoredLang(code: string, opts: LangOptions = {}): void {
    const supported = opts.supported ?? SUPPORTED_LANGS;
    const normalized = normalizeLang(code, '');
    if (!isRenderable(normalized, supported)) return;

    try {
        localStorage.setItem(LANG_STORAGE_KEY, normalized);
    } catch {
        // As above.
    }
}

/** The visitor's best renderable language from the browser, or undefined. */
export function detectBrowserLang(opts: LangOptions = {}): string | undefined {
    const supported = opts.supported ?? SUPPORTED_LANGS;

    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
        | (Navigator & { userLanguage?: string })
        | undefined;
    if (!nav) return undefined;

    const candidates = [
        ...(Array.isArray(nav.languages) ? nav.languages : []),
        nav.language,
        nav.userLanguage ?? '',
    ].filter(Boolean) as string[];

    for (const raw of candidates) {
        const code = normalizeLang(raw, '');
        if (isRenderable(code, supported)) return code;
    }

    return undefined;
}

/**
 * THE function: what language to start in. In order: a remembered answer,
 * the browser's own languages, then the fallback (DEFAULT_DETECTED_LANG by
 * default).
 */
export function resolvePreferredLang(opts: LangOptions = {}): string {
    const fallback = opts.fallback ?? DEFAULT_DETECTED_LANG;
    return readStoredLang(opts) ?? detectBrowserLang(opts) ?? fallback;
}
