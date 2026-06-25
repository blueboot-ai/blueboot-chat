import { normalizeLangCode } from './lang.utils';

export function i18nPick<T = any>(base: any, lang: string, prop: string): T | undefined {
  const L = normalizeLangCode(lang);
  const scope = base?.i18n || base?.widgetParams?.i18n;

  if (scope?.[L] && scope[L][prop] != null) return scope[L][prop] as T;
  if (base?.widgetParams?.[prop] != null) return base.widgetParams[prop] as T;
  if (base?.[prop] != null) return base[prop] as T;

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

export function mergeTranslations(base: any, api: any, host: any) {
  return { ...(base || {}), ...(api || {}), ...(host || {}) };
}
