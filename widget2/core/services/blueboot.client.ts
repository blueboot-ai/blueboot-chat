// src/app/widget2/core/services/blueboot.client.ts
import { WidgetApp } from '../models/widget-app';
// The path the media route is mounted at, from shared-library so the console,
// the upload route and this resolver cannot drift apart on a string literal.
// Same crossing chat-core.component.ts already makes for ChatInfo.
import { WIDGET_MEDIA_PATH } from '../../shared/widget-app';

/**
 * Which half of the app config a call wants.
 *
 *   'text'  — copy, translations, colours, flags. Small, stable, cacheable.
 *   'media' — logos, avatars, video. Large, often inlined, never cached.
 *
 * Sent as ?include=. The backend does not honour it yet, so both scopes return
 * everything — the stripping and merging below tolerate that.
 */
export type AppConfigScope = 'text' | 'media';

export class BluebootClient {
  /**
   * Collapses concurrent calls for the same key.
   *
   * The launcher and the panel it renders both fetch in the same tick, so
   * without this every launcher load makes two identical requests. Released as
   * soon as the fetch settles — appCache is what spans time.
   */
  private static inflight = new Map<string, Promise<WidgetApp | undefined>>();

  /**
   * Text-only payload cache, per app+gpt.
   *
   * Media never goes in: logoSrc and the avatar maps can carry `data:` URLs
   * that would dwarf everything else. Stripped on the way in, re-fetched every
   * load. localStorage-backed so it survives page loads, with an in-memory map
   * in front; bounded and TTL'd in both layers.
   */
  private static appCache = new Map<string, WidgetApp>();
  private static readonly APP_CACHE_MAX = 4;

  /**
   * Deliberately NOT under 'blueboot:' — chat-storage.functions sweeps that
   * prefix to evict conversations and would eat these. Versioned so a shape
   * change invalidates old entries rather than having to understand them.
   */
  private static readonly LS_PREFIX = 'bb:appcfg:v1:';

  /**
   * Not a freshness control — every hit fires a background refresh. This only
   * bounds how stale the copy may be when it is all we have: offline, or a
   * failed refresh.
   *
   * Five minutes rather than a day: the cache is served synchronously on the
   * first load after a settings change, so anything longer means an admin
   * toggles a switch, reloads, and sees no difference — with no indication
   * that a stale copy is the reason. Bounding it to minutes makes "reload and
   * try again" actually work. The offline case it exists for is not much
   * worse off, since a widget that cannot reach the backend at all has bigger
   * problems than a slightly older config.
   */
  private static readonly LS_TTL_MS = 5 * 60 * 1000;

  /**
   * Turn the config's relative media paths into absolute URLs.
   *
   * The backend stores and serves `/api/public/widget-media/{appId}/{file}`
   * without an origin, and that is on purpose: the media lives on the same
   * service that just answered this request, so the origin is something the
   * caller already knows and the backend would only have to be told. A stored
   * absolute URL would also have to be rewritten the day the service moves
   * domain; a path does not.
   *
   * Resolving it here rather than at each <img> means every consumer gets it
   * for free — logo, robot, the three avatars, the launcher video — and the
   * admin console's preview, which runs this same client against the same
   * endpoint, resolves it to the same place without knowing anything special.
   *
   * Only strings that are exactly a media path are touched — not every string
   * starting with "/". That distinction matters: this walks the whole config,
   * which carries the app's own copy, and a suggestion like "/help" or a
   * welcome line beginning with a slash would otherwise be rewritten into a
   * URL and shown to the visitor that way.
   *
   * `data:` URIs (apps that still keep their images inline), absolute URLs
   * (apps configured before the move to the media route) and everything else
   * pass through untouched, so both storage models keep working.
   */

  private static absolutizeMedia(app: WidgetApp, endpoint: string): WidgetApp {
    let origin = '';
    try {
      origin = new URL(endpoint, location.href).origin;
    } catch {
      return app;
    }
    if (!origin) return app;

    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;

      for (const key of Object.keys(node)) {
        const value = node[key];

        if (typeof value === 'string') {
          if (value.startsWith(WIDGET_MEDIA_PATH)) {
            node[key] = origin + value;
          }
          continue;
        }

        walk(value);
      }
    };

    walk(app);
    return app;
  }

  /**
   * A stored string longer than this is dropped from the cached copy.
   *
   * 2 KB clears every URL by a wide margin and no inlined image by any: a
   * base64 logo is hundreds of KB, and localStorage gives the whole origin
   * about 5 MB.
   */
  private static readonly MAX_CACHED_VALUE_CHARS = 2 * 1024;

  /**
   * Drop the values too big to be worth caching.
   *
   * This was a list of key NAMES — logoSrc, robotSrc, roleAvatarImages and six
   * others — because get-app used to inline every image as base64 and those
   * were the fields it landed in. Two problems with that. It had to be kept in
   * step by hand, exactly like the widgetParams allowlist did, and it is now
   * wrong: get-app serves storage URLs, so those fields hold a few dozen bytes
   * each and stripping them means a cache hit renders with no branding until
   * the background refresh lands — a visible flash of an unstyled header for
   * the one case the cache exists to serve.
   *
   * Measuring the value instead needs no maintenance and stays correct through
   * the migration: an app still holding an inlined `data:` URI — anything
   * configured on the project details page — is dropped on size, exactly as
   * before, while an app on storage URLs keeps its branding in the cache.
   */
  private static stripHeavy(app: WidgetApp): WidgetApp {
    const clone = JSON.parse(JSON.stringify(app));

    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;

      for (const key of Object.keys(node)) {
        const value = node[key];

        if (typeof value === 'string') {
          if (value.length > BluebootClient.MAX_CACHED_VALUE_CHARS) delete node[key];
          continue;
        }

        walk(value);
      }
    };

    walk(clone);
    return clone;
  }

  /**
   * TEMPORARY — testing switch. With this on, the config cache is bypassed
   * and wiped on every read, so the widget always runs against the settings
   * as they are right now.
   *
   * Here rather than in the backend: a stale cached config was what made
   * settings changes appear not to work, and forcing the *behaviour*
   * server-side only papered over that while hiding whether the real setting
   * had arrived. Emptying the cache tests the actual thing.
   *
   * Set to false before shipping — every load then costs a config fetch
   * before anything renders.
   */
  private static readonly DEV_BYPASS_APP_CACHE = false;

  /** Anything unparseable, wrong-shaped or expired is deleted, not returned. */
  private static readStored(key: string): WidgetApp | undefined {
    const lsKey = BluebootClient.LS_PREFIX + key;

    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return undefined;

      const entry = JSON.parse(raw) as { storedAt?: number; app?: unknown };
      const age = Date.now() - Number(entry?.storedAt || 0);

      if (!entry?.storedAt || age > BluebootClient.LS_TTL_MS || !isWidgetApp(entry.app)) {
        localStorage.removeItem(lsKey);
        return undefined;
      }

      return entry.app;
    } catch {
      try { localStorage.removeItem(lsKey); } catch {}
      return undefined;
    }
  }

  /** Persists the light copy. Never throws — caching is an optimisation. */
  private static writeStored(key: string, light: WidgetApp): void {
    const lsKey = BluebootClient.LS_PREFIX + key;
    const raw = JSON.stringify({ storedAt: Date.now(), app: light });

    try {
      localStorage.setItem(lsKey, raw);
    } catch {
      // Out of quota, or blocked entirely (Safari private mode throws on
      // write). Drop our own stale entries and try once more; if it still
      // fails, carry on with the in-memory cache alone.
      BluebootClient.pruneStored();
      try { localStorage.setItem(lsKey, raw); } catch {}
    }
  }

  /** Removes expired entries, then the oldest until within APP_CACHE_MAX. */
  private static pruneStored(): void {
    try {
      const mine: Array<{ key: string; storedAt: number }> = [];

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(BluebootClient.LS_PREFIX)) continue;

        let storedAt = 0;
        try {
          storedAt = Number(JSON.parse(localStorage.getItem(k) || '{}')?.storedAt || 0);
        } catch {}

        if (!storedAt || Date.now() - storedAt > BluebootClient.LS_TTL_MS) {
          localStorage.removeItem(k);
          continue;
        }

        mine.push({ key: k, storedAt });
      }

      mine.sort((a, b) => a.storedAt - b.storedAt);

      while (mine.length > BluebootClient.APP_CACHE_MAX) {
        const oldest = mine.shift();
        if (oldest) localStorage.removeItem(oldest.key);
      }
    } catch {}
  }

  /** Stores the light copy, in memory and in localStorage. */
  private static rememberApp(key: string, app: WidgetApp): void {
    const light = BluebootClient.stripHeavy(app);

    BluebootClient.appCache.delete(key);
    BluebootClient.appCache.set(key, light);

    while (BluebootClient.appCache.size > BluebootClient.APP_CACHE_MAX) {
      const oldest = BluebootClient.appCache.keys().next().value;
      if (oldest === undefined) break;
      BluebootClient.appCache.delete(oldest);
    }

    BluebootClient.writeStored(key, light);
    BluebootClient.pruneStored();
  }

  /**
   * The cached config for a key, memory first then localStorage.
   *
   * The in-memory map is a read-through front for the stored copy: it avoids
   * re-parsing on every widget instance within a page, while localStorage is
   * what carries the entry across loads.
   */
  private static recallApp(key: string): WidgetApp | undefined {
    // The bypass belongs here, not in readStored(): this is the only entry
    // point, and the in-memory map is consulted first — a warm hit returned
    // before the stored copy was ever looked at, so a flag further down never
    // ran at all.
    if (BluebootClient.DEV_BYPASS_APP_CACHE) {
      BluebootClient.clearAppCache();
      return undefined;
    }

    const hot = BluebootClient.appCache.get(key);
    if (hot) return hot;

    const stored = BluebootClient.readStored(key);
    if (stored) BluebootClient.appCache.set(key, stored);

    return stored;
  }

  /** Drops every cached payload, in memory and on disk. */
  static clearAppCache(): void {
    BluebootClient.appCache.clear();

    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(BluebootClient.LS_PREFIX)) keys.push(k);
      }
      keys.forEach(k => {
        try { localStorage.removeItem(k); } catch {}
      });
    } catch {}
  }

  /** Own enumerable properties whose value is not undefined. */
  private static defined<T extends object>(o: T | undefined): Partial<T> {
    const out: any = {};
    for (const [k, v] of Object.entries(o ?? {})) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /**
   * Layers a payload onto what this client already holds.
   *
   * The media response is expected to carry only the heavy fields, so it must
   * add to the text response rather than replace it — and it must not blank a
   * text field just by omitting it, hence the undefined filtering. Written to
   * survive the interim where the backend ignores ?include= and returns
   * everything both times: merging a full payload over an identical one is a
   * no-op.
   */
  private static mergeApp(base: WidgetApp | undefined, incoming: WidgetApp): WidgetApp {
    if (!base) return incoming;

    return {
      ...base,
      ...BluebootClient.defined(incoming),
      widgetParams: {
        ...(base.widgetParams ?? {}),
        ...BluebootClient.defined(incoming.widgetParams ?? {}),
      },
    } as WidgetApp;
  }

  /**
   * Fires only when a background refresh brings back something different from
   * what the cache served — confirming a match and re-rendering would be churn.
   */
  onRefresh?: (app: WidgetApp) => void;

  headers: Record<string, string> = {};

  /**
   * The accumulated config for this client: the text half, plus the media half
   * once it lands. Built by merging, so the two calls compose in either order.
   */
  widgetApp?: WidgetApp;

  constructor(
    private url: string,
    private appId: string | undefined,
    private gptId: string | undefined,
  ) {
    this.headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(this.appId  ? { 'x-appid':  String(this.appId)  } : {}),
      ...(this.gptId  ? { 'x-gptid':  String(this.gptId)  } : {}),
    };

    console.debug('[BluebootClient:ctor]', {
      url: this.url, appId: this.appId, gptId: this.gptId, headers: this.headers
    });
  }

  /**
   * Identity of a request, for the in-flight dedupe and the cache.
   *
   * No language in it: the response is language-independent — the backend hands
   * back everything the app has and the widget picks per visitor — so keying by
   * language would store the identical payload once per language tried, and
   * evict real entries against APP_CACHE_MAX to do it.
   */
  private cacheKey(scope: AppConfigScope): string {
    const u = (this.url || '').replace(/\/+$/, '');
    const a = String(this.appId || '').trim();
    const g = String(this.gptId || '').trim();
    return `${u}::${a}::${g}::${scope}`;
  }

  /**
   * The cached 'text' config, if any — synchronously, with no network call.
   *
   * getApp() already serves a cache hit instantly, but only from *inside* the
   * promise it returns, so the caller can't apply it until at least one
   * microtask later. This lets a caller check the cache and apply it — set
   * title, welcome text, suggestions, logo — before getApp() is even issued,
   * so cached branding is on screen in the same synchronous pass that
   * constructs this client, not the next tick.
   *
   * Deliberately doesn't touch `widgetApp` or fire `onRefresh`: it's a pure
   * peek. getApp() still does its own (idempotent) merge and cache bookkeeping
   * when it's called right after.
   */
  peekCachedApp(): WidgetApp | undefined {
    return BluebootClient.recallApp(this.cacheKey('text'));
  }


  /**
   * Last resort against a socket that never closes, not the primary timeout.
   * Without it a hung request keeps its in-flight entry forever, and a retry
   * joins the dead promise instead of opening a new connection.
   */
  private static readonly FETCH_TIMEOUT_MS = 20000;

  private async fetchApp(
    endpoint: string,
    headers: Record<string, string>,
    key: string,
  ): Promise<WidgetApp | undefined> {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : undefined;

    const timer = controller
      ? setTimeout(() => controller.abort(), BluebootClient.FETCH_TIMEOUT_MS)
      : undefined;

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller?.signal,
      });
      console.debug('[BluebootClient:getApp] status', res.status);
      if (!res.ok) {
        console.error('getApp http error:', res.status, res.statusText, await safePeekText(res));
        return undefined;
      }
      const data = await safeJson(res);
      console.debug('[BluebootClient:getApp] payload', data);
      if (isWidgetApp(data)) {
        return BluebootClient.absolutizeMedia(data, endpoint);
      }
      console.error('getApp payload is not a valid WidgetApp.');
      return undefined;
    } catch (e) {
      console.warn('getApp failed:', e);
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);

      // Always release the key, whether the fetch succeeded, failed or was
      // aborted — a stale entry would make every later caller join a promise
      // that can never produce anything.
      BluebootClient.inflight.delete(key);
    }
  }

  /**
   * Stale-while-revalidate: nothing waits on this. It exists so a customer's
   * edits land on the next load rather than whenever the entry expires.
   * Skipped when a request for the key is already running.
   */
  private revalidateText(key: string, endpoint: string, headers: Record<string, string>): void {
    if (BluebootClient.inflight.has(key)) return;

    const before = JSON.stringify(BluebootClient.appCache.get(key) ?? null);

    const p = this.fetchApp(endpoint, headers, key);
    BluebootClient.inflight.set(key, p);

    p.then((result) => {
      if (!result) return;

      BluebootClient.rememberApp(key, result);
      this.widgetApp = BluebootClient.mergeApp(this.widgetApp, result);

      const after = JSON.stringify(BluebootClient.appCache.get(key) ?? null);
      if (after !== before && this.widgetApp) this.onRefresh?.(this.widgetApp);
    });
  }

  /**
   * 'text' is cache-first and refreshed in the background; 'media' is always
   * fetched. Either way the result is merged into widgetApp, so whichever
   * lands second adds to the first instead of erasing it.
   */
  async getApp(scope: AppConfigScope = 'text'): Promise<boolean> {
    if (!this.appId || !String(this.appId).trim()) {
      console.error('[BluebootClient:getApp] MISSING appId — pass [appid]="\'YourAppId\'".');
      return false;
    }
    if (!this.url) {
      console.error('[BluebootClient:getApp] MISSING urlBackend (environment.urlBackend).');
      return false;
    }

    const key = this.cacheKey(scope);
    const base = this.url.replace(/\/+$/, '');
    const endpoint = `${base}/api/get-app?include=${encodeURIComponent(scope)}`;
    const headers = { ...this.headers, 'x-appid': String(this.appId) };

    // Text only: served from cache when we have it, no request at all.
    if (scope === 'text') {
      const cached = BluebootClient.recallApp(key);
      if (cached) {
        this.widgetApp = BluebootClient.mergeApp(this.widgetApp, cached);
        console.debug('[BluebootClient:getApp] text from cache, refreshing');
        this.revalidateText(key, endpoint, headers);
        return true;
      }
    }

    // Join an in-flight request for the same scope, if one is running.
    const existing = BluebootClient.inflight.get(key);
    if (existing) {
      const data = await existing;
      if (data) {
        this.widgetApp = BluebootClient.mergeApp(this.widgetApp, data);
        return true;
      }
      return false;
    }

    console.debug('[BluebootClient:getApp] FETCH →', endpoint, headers);

    const p = this.fetchApp(endpoint, headers, key);
    BluebootClient.inflight.set(key, p);

    const result = await p;
    if (!result) return false;

    this.widgetApp = BluebootClient.mergeApp(this.widgetApp, result);

    // Text plus whatever else is small enough to be worth keeping — which now
    // includes the branding URLs, so a cache hit renders the right header
    // rather than a bare one. stripHeavy still bounds the size even while the
    // backend ignores ?include= and hands back everything.
    if (scope === 'text') BluebootClient.rememberApp(key, result);

    return true;
  }
}

/* helpers */
async function safePeekText(res: Response): Promise<string> {
  try { return await res.clone().text(); } catch { return ''; }
}
async function safeJson(res: Response): Promise<any | undefined> {
  try {
    const t = await res.clone().text();
    if (!t || !t.trim()) return undefined;
    return JSON.parse(t);
  } catch { return undefined; }
}
function isWidgetApp(x: any): x is WidgetApp {
  return !!x && typeof x === 'object' && typeof x.appId === 'string' && typeof x.widgetParams === 'object';
}
