import { Observable } from 'rxjs';
import { WidgetApp } from '../models/widget-app';
import { RetEvent } from '../../shared-library/models/model-query';

export type ChatRole = 'user' | 'assistant';

export interface HistoryMessage {
  role: ChatRole;
  content: string;
  assistantMessageKey?: string;
  feedbackStatus?: 'positive' | 'neutral' | 'negative';
  feedbackComment?: string;
  feedbackUpdatedAt?: number;
}

export const CONVERSATION_HEADER = 'x-conversation-id';

export function newConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildHeaders(meta: {
  userId?: string;
  appId?: string;
  gptId?: string;
  conversationId?: string;
  sse?: boolean;
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(meta.sse ? { 'Accept': 'text/event-stream' } : {}),
    ...(meta.userId ? { 'x-userid': String(meta.userId) } : {}),
    ...(meta.appId ? { 'x-appid': String(meta.appId) } : {}),
    ...(meta.gptId ? { 'x-gptid': String(meta.gptId) } : {}),
    ...(meta.conversationId ? { [CONVERSATION_HEADER]: String(meta.conversationId) } : {}),
  };
}

export function streamResponses(req: Request): Observable<RetEvent> {
  return new Observable<RetEvent>((subscriber) => {
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch(req, { signal: ac.signal });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          subscriber.error(new Error(`HTTP ${res.status} ${res.statusText} ${errText}`));
          return;
        }

        if (!res.body) {
          subscriber.error(new Error("No response body (stream) returned"));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            const events = block
              .split('\n')
              .filter(line => line.startsWith('data: '))
              .map(line => line.slice(6))
              .filter(line => line && line !== '[DONE]')
              .map(line => {
                try { return JSON.parse(line) as RetEvent; }
                catch { return null; }
              })
              .filter(Boolean) as RetEvent[];

            events.forEach(val => subscriber.next(val));
          }
        }

        subscriber.complete();
      } catch (err) {
        subscriber.error(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => ac.abort();
  });
}

/** STREAMING via the backend proxy */
export function subscribeResponse(urlBase: string, opts: {
  app: WidgetApp;
  prompt: string;
  history?: HistoryMessage[];
  userId?: string;
  appId?: string;
  gptId?: string;
  conversationId?: string;
  assistantMessageKey?: string;
}): Observable<RetEvent> {
  const input =
    opts.history?.length
      ? [
        ...opts.history.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.assistantMessageKey ? { assistantMessageKey: m.assistantMessageKey } : {}),
          ...(m.feedbackStatus ? { feedbackStatus: m.feedbackStatus } : {}),
          ...(m.feedbackComment ? { feedbackComment: m.feedbackComment } : {}),
          ...(m.feedbackUpdatedAt ? { feedbackUpdatedAt: m.feedbackUpdatedAt } : {}),
        })),
        { role: 'user', content: opts.prompt }
      ]
      : opts.prompt;

  const body: any = {
    input,
    stream: true,
    assistantMessageKey: opts.assistantMessageKey || '',
  };

  const req = new Request(`${urlBase}/api/responses`, {
    method: 'POST',
    headers: buildHeaders({
      userId: opts.userId,
      appId: opts.appId,
      gptId: opts.gptId,
      conversationId: opts.conversationId,
      sse: true
    }),
    body: JSON.stringify(body),
  });

  return streamResponses(req);
}

/** Non-streaming (fallback) via the backend proxy */
export function sendResponse(urlBase: string, opts: {
  app: WidgetApp;
  prompt: string;
  history?: HistoryMessage[];
  userId?: string;
  appId?: string;
  gptId?: string;
  conversationId?: string;
  assistantMessageKey?: string;
}): Observable<RetEvent> {
  return new Observable<RetEvent>((subscriber) => {
    (async () => {
      const input =
        opts.history?.length
          ? [
            ...opts.history.map(m => ({
              role: m.role,
              content: m.content,
              ...(m.assistantMessageKey ? { assistantMessageKey: m.assistantMessageKey } : {}),
              ...(m.feedbackStatus ? { feedbackStatus: m.feedbackStatus } : {}),
              ...(m.feedbackComment ? { feedbackComment: m.feedbackComment } : {}),
              ...(m.feedbackUpdatedAt ? { feedbackUpdatedAt: m.feedbackUpdatedAt } : {}),
            })),
            { role: 'user', content: opts.prompt }
          ]
          : opts.prompt;

      const body: any = {
        input,
        assistantMessageKey: opts.assistantMessageKey || '',
      };

      const req = new Request(`${urlBase}/api/responses`, {
        method: 'POST',
        headers: buildHeaders({
          userId: opts.userId,
          appId: opts.appId,
          gptId: opts.gptId,
          conversationId: opts.conversationId,
          sse: false
        }),
        body: JSON.stringify(body),
      });

      try {
        const res = await fetch(req);
        const txt = await res.text().catch(() => '');
        if (!res.ok) {
          subscriber.error(new Error(`HTTP ${res.status} ${res.statusText} ${txt}`));
          return;
        }

        let data: any = {};
        try { data = JSON.parse(txt || '{}'); } catch {}

        const out: string[] = [];
        if (Array.isArray(data?.output)) {
          for (const item of data.output) {
            for (const part of item?.content ?? []) {
              if (typeof part?.text === 'string') out.push(part.text);
              else if (part?.type === 'output_text' && typeof part?.text === 'string') out.push(part.text);
            }
          }
        }

        if (!out.length && data?.choices?.[0]?.message?.content) {
          const c = data.choices[0].message.content;
          Array.isArray(c) ? c.forEach((p: any) => p?.text && out.push(p.text)) : out.push(c);
        }

        subscriber.next({ type: 'full', delta: out.join('\n').trim() || '(empty)' });
        subscriber.complete();
      } catch (err) {
        subscriber.error(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}
