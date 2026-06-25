export type InFlight = Promise<string | undefined>;

export class BbImgCacheMini {
  private mem = new Map<string, string>();
  private inflight = new Map<string, InFlight>();
  private static TTL = 7 * 24 * 60 * 60 * 1000;
  private NS = 'bb-imgcache:v2';
  private MAX = 24;
  private static HISTORY_ONLY = true;

  constructor(private scopeKey = 'shared') { }

  private k(url: string) {
    return [this.NS, this.scopeKey, url].join('|');
  }

  private listKey() {
    return `${this.NS}:keys:${this.scopeKey}`;
  }

  get(url?: string): string | undefined {
    if (!url) return undefined;
    const m = this.mem.get(url);
    if (m) return m;
    if (BbImgCacheMini.HISTORY_ONLY) return undefined;

    try {
      const raw = localStorage.getItem(this.k(url));
      if (!raw) return undefined;
      const obj = JSON.parse(raw) as { ts: number; v: string };
      if (!obj?.v || !obj?.ts) return undefined;
      if (Date.now() - obj.ts > BbImgCacheMini.TTL) return undefined;
      this.mem.set(url, obj.v);
      return obj.v;
    } catch {
      return undefined;
    }
  }

  private touch(url: string) {
    if (BbImgCacheMini.HISTORY_ONLY) return;

    try {
      const lk = this.listKey();
      const raw = localStorage.getItem(lk);
      let keys: string[] = raw ? JSON.parse(raw) : [];
      keys = [url, ...keys.filter(k => k !== url)];

      if (keys.length > this.MAX) {
        keys = keys.slice(0, this.MAX);
      }

      localStorage.setItem(lk, JSON.stringify(keys));
    } catch { }
  }

  private prune() {
    if (BbImgCacheMini.HISTORY_ONLY) return;

    try {
      const lk = this.listKey();
      const raw = localStorage.getItem(lk);
      let keys: string[] = raw ? JSON.parse(raw) : [];

      if (keys.length <= this.MAX) return;

      const toRemove = keys.slice(this.MAX);
      toRemove.forEach(u => localStorage.removeItem(this.k(u)));

      keys = keys.slice(0, this.MAX);
      localStorage.setItem(lk, JSON.stringify(keys));
    } catch { }
  }

  put(url: string, v: string) {
    if (!url || !v) return;

    this.mem.set(url, v);

    if (BbImgCacheMini.HISTORY_ONLY) return;

    try {
      localStorage.setItem(this.k(url), JSON.stringify({ ts: Date.now(), v }));
      this.touch(url);
      this.prune();
    } catch { }
  }

  private async fetchAsDataUrl(url: string): Promise<string | undefined> {
    try {
      if (/^(data:|blob:)/i.test(url)) return url;

      const res = await fetch(url, {
        credentials: 'omit',
        cache: 'force-cache',
        referrerPolicy: 'no-referrer',
      });

      if (!res.ok) return undefined;

      const blob = await res.blob();

      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  }

  async ensure(url?: string): Promise<string | undefined> {
    const u = (url || '').trim();
    if (!u) return undefined;
    if (BbImgCacheMini.HISTORY_ONLY) return u;

    const c = this.get(u);
    if (c) return c;

    const inflight = this.inflight.get(u);
    if (inflight) return inflight;

    const p = this.fetchAsDataUrl(u)
      .then(v => {
        if (v) this.put(u, v);
        return v ?? u;
      })
      .finally(() => this.inflight.delete(u));

    this.inflight.set(u, p);

    return p;
  }
}

export function getGlobalMini(scope = 'shared'): BbImgCacheMini {
  const w = window as any;

  if (!w.__BB_IMG_CACHE_MINI) {
    w.__BB_IMG_CACHE_MINI = {};
  }

  if (!w.__BB_IMG_CACHE_MINI[scope]) {
    w.__BB_IMG_CACHE_MINI[scope] = new BbImgCacheMini(scope);
  }

  return w.__BB_IMG_CACHE_MINI[scope] as BbImgCacheMini;
}
