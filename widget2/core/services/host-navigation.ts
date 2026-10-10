// Tells the widget when the *host page* navigated.
//
// Only matters on single-page hosts: with full page loads the widget is torn
// down and rebuilt. There is no portable way to observe someone else's router,
// so this watches the History API — popstate, hashchange, and pushState /
// replaceState, which routers call directly and which fire no event.
//
// Patching those is intrusive, so: patch once per page, and never un-patch —
// analytics and routers patch them too, and restoring the original would
// silently remove whoever patched last. Subscribers are removed instead.
//
// window.__BLUE_SEARCH_NO_SPA = true before load skips the patch entirely,
// leaving popstate and hashchange.

const PATCH_FLAG = '__bbHistoryPatched';
const LOCATION_CHANGE = 'bb:locationchange';

/** Installs the pushState/replaceState patch, at most once per page. */
function ensureHistoryPatched(): void {
  const w = window as any;

  if (w[PATCH_FLAG]) return;
  if (w.__BLUE_SEARCH_NO_SPA) return;

  const history = window.history;
  if (!history) return;

  try {
    (['pushState', 'replaceState'] as const).forEach((name) => {
      const original = history[name];
      if (typeof original !== 'function') return;

      history[name] = function (this: History, ...args: any[]) {
        // Host's call first, result untouched: a patch that changes behaviour
        // is a patch that breaks a router.
        const result = (original as any).apply(this, args);

        try {
          window.dispatchEvent(new Event(LOCATION_CHANGE));
        } catch {}

        return result;
      } as any;
    });

    w[PATCH_FLAG] = true;
  } catch {
    // Frozen or non-writable History. popstate and hashchange still work.
  }
}

/**
 * Calls `cb` when the host page's location changes. Returns an unsubscribe.
 *
 * Only fires when the URL actually changed — routers call replaceState freely
 * to rewrite query strings, and treating that as navigation would close the
 * panel mid-read.
 */
export function onHostNavigation(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  ensureHistoryPatched();

  let lastHref = window.location.href;

  const handler = () => {
    const href = window.location.href;
    if (href === lastHref) return;

    lastHref = href;

    try {
      cb();
    } catch {}
  };

  window.addEventListener('popstate', handler);
  window.addEventListener('hashchange', handler);
  window.addEventListener(LOCATION_CHANGE, handler);

  return () => {
    window.removeEventListener('popstate', handler);
    window.removeEventListener('hashchange', handler);
    window.removeEventListener(LOCATION_CHANGE, handler);
  };
}
