import { Injectable } from '@angular/core';

import { buildHistoryKey, buildOpenKey, buildLauncherVideoFramePreviewKey } from '../../core/services/chat-storage.functions';

@Injectable({ providedIn: 'root' })
export class LauncherStorageService {
  private readonly openGlobalKey = 'bb:open:last';
  private readonly openTsGlobalKey = 'bb:open:last:ts';
  private readonly reopenMaxAgeMs = 2 * 60 * 60 * 1000;

  // The key format is owned by core/services/chat-storage.functions.ts. It used
  // to be spelled out here too, which mattered: this key is handed to
  // <blue-search> as [storageKey], and the chat's own eviction scan finds
  // conversations by that same prefix.
  //
  // Keys are no longer user-scoped, so the open flag lives under one key. This
  // previously had to be written under both ':anon:open' and ':guest:open' and
  // read back from both, because the user segment changed spelling as the host
  // page's auth state moved and a session saved under one spelling was invisible
  // to the other. With a stable key there is nothing left to reconcile.

  buildHistoryStorageKey(appid?: string, gptid?: string): string {
    return buildHistoryKey({ appId: appid, gptId: gptid });
  }

  makeOpenKey(appid: string | undefined, gptid: string | undefined): string {
    return buildOpenKey({ appId: appid, gptId: gptid });
  }

  setOpenFlag(isOpen: boolean, appid?: string, gptid?: string): void {
    try {
      const val = isOpen ? '1' : '0';

      localStorage.setItem(this.makeOpenKey(appid, gptid), val);
      localStorage.setItem(this.openGlobalKey, val);
      localStorage.setItem(this.openTsGlobalKey, isOpen ? String(Date.now()) : '');
    } catch {}
  }

  wasOpenBefore(appid?: string, gptid?: string): boolean {
    try {
      const scoped = localStorage.getItem(this.makeOpenKey(appid, gptid)) === '1';
      const global = localStorage.getItem(this.openGlobalKey) === '1';

      if (!scoped && !global) return false;

      const tsRaw = localStorage.getItem(this.openTsGlobalKey);
      const ts = tsRaw ? Number(tsRaw) : 0;

      if (!ts) return true;

      return Date.now() - ts <= this.reopenMaxAgeMs;
    } catch {
      return false;
    }
  }

  /**
   * A still frame from this app's launcher video, cached the last time it
   * was fully downloaded and decoded here. undefined if there is none yet
   * (first-ever visit) or storage is unavailable (private browsing, quota).
   */
  readVideoFramePreview(appid?: string, gptid?: string, assistantid?: string): string | undefined {
    try {
      const raw = localStorage.getItem(
        buildLauncherVideoFramePreviewKey({ appId: appid, gptId: gptid, assistantId: assistantid }),
      );
      return raw || undefined;
    } catch {
      return undefined;
    }
  }

  /** Best-effort only: a failed write (quota, private browsing) just means
   *  the next visit falls back to the default mark, same as it does today. */
  writeVideoFramePreview(dataUrl: string, appid?: string, gptid?: string, assistantid?: string): void {
    try {
      localStorage.setItem(
        buildLauncherVideoFramePreviewKey({ appId: appid, gptId: gptid, assistantId: assistantid }),
        dataUrl,
      );
    } catch {}
  }
}
