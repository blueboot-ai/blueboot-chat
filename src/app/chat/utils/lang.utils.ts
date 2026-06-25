import { DEFAULT_LANG } from '../../../shared-library/models/ui-default';

export function normalizeLangCode(raw?: string): string {
  const c = String(raw || '').trim().toLowerCase();
  if (!c) return DEFAULT_LANG;
  if (c.startsWith('nb') || c.startsWith('nn') || c === 'norwegian' || c === 'no_no') return 'no';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('ar')) return 'ar';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('de')) return 'de';
  if (c.startsWith('uk') || c === 'ua') return 'uk';
  return c;
}
