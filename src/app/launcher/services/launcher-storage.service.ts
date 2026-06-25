import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LauncherStorageService {
  private readonly openGlobalKey = 'bb:open:last';
  private readonly openTsGlobalKey = 'bb:open:last:ts';
  private readonly reopenMaxAgeMs = 2 * 60 * 60 * 1000;

  buildHistoryStorageKey(appid?: string, gptid?: string, userid?: string): string {
    const app = appid ?? 'app';
    const gpt = gptid && gptid.trim() ? gptid.trim() : 'default';
    const usr = userid && String(userid).trim() ? String(userid).trim() : 'anon';

    return ['blueboot', app, gpt, usr].join(':');
  }

  makeOpenKey(
    appid: string | undefined,
    gptid: string | undefined,
    userid: string | undefined,
    userFallback: 'anon' | 'guest'
  ): string {
    const app = appid ?? 'app';
    const gpt = gptid && gptid.trim() ? gptid.trim() : 'default';
    const usr = userid && String(userid).trim() ? String(userid).trim() : userFallback;

    return ['blueboot', app, gpt, usr, 'open'].join(':');
  }

  setOpenFlag(isOpen: boolean, appid?: string, gptid?: string, userid?: string): void {
    try {
      const val = isOpen ? '1' : '0';

      localStorage.setItem(this.makeOpenKey(appid, gptid, userid, 'guest'), val);
      localStorage.setItem(this.makeOpenKey(appid, gptid, userid, 'anon'), val);
      localStorage.setItem(this.openGlobalKey, val);
      localStorage.setItem(this.openTsGlobalKey, isOpen ? String(Date.now()) : '');
    } catch {}
  }

  wasOpenBefore(appid?: string, gptid?: string, userid?: string): boolean {
    try {
      const cur = localStorage.getItem(this.makeOpenKey(appid, gptid, userid, 'guest')) === '1';
      const old = localStorage.getItem(this.makeOpenKey(appid, gptid, userid, 'anon')) === '1';
      const global = localStorage.getItem(this.openGlobalKey) === '1';

      const anyOpen = cur || old || global;
      if (!anyOpen) return false;

      const tsRaw = localStorage.getItem(this.openTsGlobalKey);
      const ts = tsRaw ? Number(tsRaw) : 0;

      if (!ts) return true;

      return Date.now() - ts <= this.reopenMaxAgeMs;
    } catch {
      return false;
    }
  }
}
