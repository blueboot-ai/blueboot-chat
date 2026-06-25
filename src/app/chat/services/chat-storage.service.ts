import { Injectable } from '@angular/core';
import { Message, StoredHistory } from '../models/chat-message.model';

@Injectable({
  providedIn: 'root',
})
export class ChatStorageService {
  private readonly HISTORY_TTL_MS = 10 * 60 * 1000;
  private readonly STORAGE_PREFIX = 'blueboot:';
  private readonly OPEN_KEY_SUFFIX = ':open';

  buildStoredHistory(
    conversationId: string | undefined,
    messages: Message[],
    inputHistory: string[]
  ): StoredHistory {
    return {
      storeTime: Date.now(),
      conversationId,
      messages,
      inputHistory,
    };
  }

  readStoredHistory(storage: Storage, key: string): StoredHistory | undefined {
    try {
      const raw = storage.getItem(key);
      if (!raw) return undefined;

      const data = JSON.parse(raw) as StoredHistory;
      const storeTime = Number(data?.storeTime || 0);

      if (!storeTime) return undefined;
      if ((Date.now() - storeTime) >= this.HISTORY_TTL_MS) return undefined;

      return data;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  loadBestHistory(localKey: string, sessionFallbackKey: string): StoredHistory | undefined {
    const localData = this.readStoredHistory(localStorage, localKey);
    const sessionData = this.readStoredHistory(sessionStorage, sessionFallbackKey);

    if (localData && sessionData) {
      const localTs = Number(localData.storeTime || 0);
      const sessionTs = Number(sessionData.storeTime || 0);
      return sessionTs > localTs ? sessionData : localData;
    }

    return localData || sessionData;
  }

  saveHistory(localKey: string, sessionFallbackKey: string, payload: StoredHistory): void {
    const raw = JSON.stringify(payload);

    try {
      sessionStorage.setItem(sessionFallbackKey, raw);
    } catch (error) {
      console.error(error);
    }

    const tryWriteLocal = (): boolean => {
      try {
        localStorage.setItem(localKey, raw);
        return true;
      } catch (error) {
        if (!this.isQuotaError(error)) console.error(error);
        return false;
      }
    };

    if (tryWriteLocal()) return;

    try {
      this.cleanupExpiredStoredHistories();
    } catch (error) {
      console.error(error);
    }

    if (tryWriteLocal()) return;

    try {
      const candidates: Array<{ key: string; storeTime: number }> = [];

      for (const key of this.listStoredHistoryKeys()) {
        if (key === localKey) continue;

        const rawItem = localStorage.getItem(key);

        if (!rawItem) {
          try {
            localStorage.removeItem(key);
          } catch {}
          continue;
        }

        try {
          const data = JSON.parse(rawItem) as StoredHistory;
          candidates.push({
            key,
            storeTime: Number(data?.storeTime || 0),
          });
        } catch {
          try {
            localStorage.removeItem(key);
          } catch {}
        }
      }

      candidates.sort((a, b) => a.storeTime - b.storeTime);

      for (const item of candidates) {
        try {
          localStorage.removeItem(item.key);
        } catch {}

        if (tryWriteLocal()) return;
      }
    } catch (error) {
      console.error(error);
    }
  }

  removeLocalKey(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  removeSessionKey(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }

  clearAllHistoriesByPrefix(prefix: string): void {
    try {
      const toRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith(prefix)) toRemove.push(key);
      }

      toRemove.forEach(key => {
        try {
          localStorage.removeItem(key);
        } catch {}
      });
    } catch {}
  }

  private isQuotaError(err: unknown): boolean {
    const e = err as any;

    return !!e && (
      (e instanceof DOMException && (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )) ||
      e?.code === 22 ||
      e?.code === 1014
    );
  }

  private listStoredHistoryKeys(): string[] {
    const keys: string[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (!key.startsWith(this.STORAGE_PREFIX)) continue;
        if (key.endsWith(this.OPEN_KEY_SUFFIX)) continue;
        keys.push(key);
      }
    } catch (error) {
      console.error(error);
    }

    return keys;
  }

  private cleanupExpiredStoredHistories(): void {
    const now = Date.now();

    try {
      for (const key of this.listStoredHistoryKeys()) {
        const raw = localStorage.getItem(key);

        if (!raw) {
          localStorage.removeItem(key);
          continue;
        }

        try {
          const data = JSON.parse(raw) as StoredHistory;
          const ts = Number(data?.storeTime || 0);

          if (!ts || (now - ts) > this.HISTORY_TTL_MS) {
            localStorage.removeItem(key);
          }
        } catch {
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
}
