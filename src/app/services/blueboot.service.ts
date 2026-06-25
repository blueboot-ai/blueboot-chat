// src/app/services/blueboot.service.ts
import { WidgetApp } from '../models/widget-app';

export class BluebootService {
  /** ---- Cross-instance cache & in-flight dedupe ---- */
  // private static appCache = new Map<string, WidgetApp>();
  private static inflight = new Map<string, Promise<WidgetApp | undefined>>();

  headers: Record<string, string> = {};
  widgetApp?: WidgetApp;
  localKey?: string;

  constructor(
    private url: string,
    private userId: string | undefined,
    private appKey: string | undefined,
    private appId: string | undefined,
    private gptId: string | undefined,
  ) {
    this.headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(this.userId ? { 'x-userid': String(this.userId) } : {}),
      ...(this.appKey ? { 'x-appkey': String(this.appKey) } : {}),
      ...(this.appId  ? { 'x-appid':  String(this.appId)  } : {}),
      ...(this.gptId  ? { 'x-gptid':  String(this.gptId)  } : {}),
    };

    // If someone already fetched for the same key, hydrate immediately
    // const cached = BluebootService.appCache.get(this.cacheKey());
    // if (cached) {
    //   this.widgetApp = cached;
    //   this.localKey = (cached as any)?.modelKey;
    // }

    console.debug('[BluebootService:ctor]', {
      url: this.url, userId: this.userId, appKey: this.appKey, appId: this.appId, gptId: this.gptId, headers: this.headers
    });
  }

  /** Unique key per backend/app (adjust if you want userid/gpt to matter) */
  private cacheKey(): string {
    const u = (this.url || '').replace(/\/+$/, '');
    const a = String(this.appId || '').trim();
    const g = String(this.gptId || '').trim();
    return `${u}::${a}::${g}`;
  }


  /** Optional: allow external priming (e.g., from Launcher) */
  // static prime(url: string, appId: string, app: WidgetApp) {
  //   const key = `${(url || '').replace(/\/+$/, '')}::${appId}`;
  //   BluebootService.appCache.set(key, app);
  // }

  private async fetchApp(
    endpoint: string,
    headers: Record<string, string>,
    key: string,
  ): Promise<WidgetApp | undefined> {
    try {
      const res = await fetch(endpoint, { method: 'GET', headers });
      console.debug('[BluebootService:getApp] status', res.status);
      if (!res.ok) {
        console.error('getApp http error:', res.status, res.statusText, await safePeekText(res));
        return undefined;
      }
      const data = await safeJson(res);
      console.debug('[BluebootService:getApp] payload', data);
      if (isWidgetApp(data)) {
        //BluebootService.appCache.set(key, data);
        return data;
      }
      console.error('getApp payload is not a valid WidgetApp.');
      return undefined;
    } catch (e) {
      console.warn('getApp failed:', e);
      return undefined;
    } finally {
      BluebootService.inflight.delete(key);
    }
  }

  async getApp(): Promise<boolean> {
    if (!this.appId || !String(this.appId).trim()) {
      console.error('[BluebootService:getApp] MISSING appId — pass [appid]="\'YourAppId\'".');
      return false;
    }
    if (!this.url) {
      console.error('[BluebootService:getApp] MISSING urlBackend (environment.urlBackend).');
      return false;
    }

    const key = this.cacheKey();

    // 1) Served from memory cache?
    // const cached = BluebootService.appCache.get(key);
    // if (cached) {
    //   this.widgetApp = cached;
    //   this.localKey = (cached as any)?.modelKey;
    //   console.debug('[BluebootService:getApp] served from cache');
    //   return true;
    // }

    // 2) Join in-flight request if any
    const existing = BluebootService.inflight.get(key);
    if (existing) {
      const data = await existing;
      if (data) {
        this.widgetApp = data;
        this.localKey = (data as any)?.modelKey;
        return true;
      }
      return false;
    }

    // 3) Start a new fetch and publish as in-flight
    const endpoint = `${this.url.replace(/\/+$/,'')}/api/get-app`;
    const headers = { ...this.headers, 'x-appid': String(this.appId) };

    console.debug('[BluebootService:getApp] FETCH →', endpoint, headers);

    const p = this.fetchApp(endpoint, headers, key);
    BluebootService.inflight.set(key, p);
    const result = await p;
    if (result) {
      this.widgetApp = result;
      this.localKey = (result as any)?.modelKey;
      return true;
    }
    return false;
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
