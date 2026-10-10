import { DEFAULT_LANG } from '../i18n/ui-strings';

/**
 * Maps a raw locale onto a code the widget ships a pack for.
 *
 * `fallback` is what a blank input resolves to — the embed passes its own when
 * parsing ?lang=, where absent means "keep what the caller had".
 */
export function normalizeLangCode(raw?: string, fallback: string = DEFAULT_LANG): string {
  const c = String(raw || '').trim().toLowerCase();
  if (!c) return fallback;
  if (c.startsWith('nb') || c.startsWith('nn') || c === 'norwegian' || c === 'no_no') return 'no';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('ar')) return 'ar';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('de')) return 'de';
  // 'ua' is the country code, 'uk' the language code; match the whole ua* range.
  if (c.startsWith('uk') || c.startsWith('ua')) return 'uk';
  return c;
}
