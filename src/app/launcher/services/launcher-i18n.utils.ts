export function normalizeLangCode(raw?: string): string {
  const c = String(raw || '').trim().toLowerCase();

  if (!c) return 'no';
  if (c.startsWith('nb') || c.startsWith('nn') || c === 'norwegian' || c === 'no_no') return 'no';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('ar')) return 'ar';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('de')) return 'de';
  if (c.startsWith('uk') || c.startsWith('ua')) return 'uk';

  return c;
}

export function i18nPick<T = any>(base: any, lang: string, prop: string): T | undefined {
  const L = normalizeLangCode(lang);
  const scope = base?.i18n || base?.widgetParams?.i18n;

  if (scope?.[L] && scope[L][prop] != null) return scope[L][prop] as T;
  if (base?.widgetParams?.[prop] != null) return base.widgetParams[prop] as T;
  if (base?.[prop] != null) return base[prop] as T;

  return undefined;
}

export function mergeTranslations(base: any, api: any, host: any) {
  return {
    ...(base || {}),
    ...(api || {}),
    ...(host || {}),
  };
}
