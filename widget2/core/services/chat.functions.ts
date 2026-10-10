import { Observable } from 'rxjs';
import { RetEvent, ChatInfo, QueryMessage } from '../../shared/model-query';
import { ChatRole, HistoryMessage, InputBody } from '../../shared/model-query';

// Re-exported for existing imports; HistoryMessage is superseded by QueryMessage.
export { HistoryMessage };
export type { ChatRole, QueryMessage };

export const CONVERSATION_HEADER = 'x-conversation-id';

export function newConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// x-userid used to be sent here too. Nothing read it: no handler in
// public-service touched the header, and cleanOpenAiBody() explicitly stripped
// the matching body field before the model call. It was an identifier the
// widget collected from the host page and sent on every request for no
// consumer — which is worse than useless, because a host reading the parameter
// list reasonably assumes it does something.
function buildHeaders(meta: {
  appId?: string;
  gptId?: string;
  conversationId?: string;
  sse?: boolean;
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(meta.sse ? { 'Accept': 'text/event-stream' } : {}),
    ...(meta.appId ? { 'x-appid': String(meta.appId) } : {}),
    ...(meta.gptId ? { 'x-gptid': String(meta.gptId) } : {}),
    ...(meta.conversationId ? { [CONVERSATION_HEADER]: String(meta.conversationId) } : {}),
  };
}

function streamResponses(req: Request): Observable<RetEvent> {
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
  prompt: string;
  /** Prior turns, oldest first — sent as InputBody.history, separate from the current turn. */
  history?: QueryMessage[];
  appId?: string;
  gptId?: string;
  conversationId?: string;
  assistantMessageKey?: string;
  mode: string;
  chatInfo?: ChatInfo;
  /** The language the widget is rendering in — see InputBody.lang. Sent on
   *  every request so the backend never has to guess, and needed on the one
   *  where it cannot: the live-chat welcome, written before the visitor has
   *  typed anything to infer from. */
  lang?: string;
  /** Local send time, round-tripped so chat mode can store the message under
   *  this exact timestamp instead of minting a new one server-side. */
  timestamp?: number;
  attachments?: QueryMessage['attachments'];

  /**
   * Files to send with this turn.
   *
   * Their presence is what picks the route: with files the whole turn goes as
   * multipart to /api/responses/multi, which stores them, describes them and
   * puts the descriptors on the current turn before running the same pipeline
   * /api/responses does. Without files nothing about the request changes.
   */
  files?: File[];
}): Observable<RetEvent> {
  // The current turn is ONE QueryMessage; history goes separately as
  // InputBody.history — responses2.ts reassembles the two server-side.
  const input: QueryMessage = {
    role: 'user',
    content: opts.prompt,
    ...(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  };

  const body: InputBody = {
    input,
    ...(opts.history?.length ? { history: opts.history } : undefined),
    stream: true,
    ...(opts.assistantMessageKey ? {assistantMessageKey: opts.assistantMessageKey} : undefined),
    ...(opts.mode ? {mode: opts.mode} : undefined),
    ...(opts.chatInfo ? { chatInfo: opts.chatInfo } : undefined),
    ...(opts.lang ? { lang: opts.lang } : undefined),
  };

  const headers = buildHeaders({
    appId: opts.appId,
    gptId: opts.gptId,
    conversationId: opts.conversationId,
    sse: true
  });

  if (opts.files?.length) {
    const form = new FormData();
    // The JSON half travels as a form field — multipart has nowhere else to
    // put it. responses2.ts reads `body` (and `payload`) back out.
    form.append('body', JSON.stringify(body));
    opts.files.forEach(f => form.append('files', f, f.name));

    // Content-Type is deliberately not set: fetch writes
    // multipart/form-data *and* the boundary. Setting it by hand omits the
    // boundary and the server cannot parse the body at all.
    const { 'Content-Type': _dropped, ...multipartHeaders } = headers as Record<string, string>;

    return streamResponses(new Request(`${urlBase}/api/responses/multi`, {
      method: 'POST',
      headers: multipartHeaders,
      body: form,
    }));
  }

  return streamResponses(new Request(`${urlBase}/api/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }));
}

/** Poll for chat-mode messages. No cursor/`since` at all — every call
 *  returns every due message in the chat, oldest first (see
 *  chat-poll-handler.ts's getDueMessages()). ChatPoller's own local history
 *  already updates a message in place when it recognizes one it already has
 *  (matched by timestamp — see chat-conversation.functions.ts's
 *  applyPolledEvents()), so re-fetching the full set every time is simpler
 *  and more robust than tracking a cursor — there's nothing to get out of
 *  sync. `signal` lets the caller (ChatPoller) abort a request that's taking
 *  too long, so a hung connection can never keep the poll loop from ever
 *  ticking again. */
export async function pollChatMessages(urlBase: string, opts: {
  chatId: string;
  appId?: string;
  gptId?: string;
  /** Long polling: ask the server to hold the response open for up to this
   *  many ms, answering the moment a message actually arrives rather than
   *  immediately with whatever exists right now. Omit or 0 for a one-shot
   *  poll. The server caps this at its own MAX_WAIT_MS regardless. */
  waitMs?: number;
}, signal?: AbortSignal): Promise<{ events: RetEvent[]; chatClosed?: boolean }> {
  const params = new URLSearchParams({ chatId: opts.chatId });
  if (opts.waitMs) params.set('wait', String(opts.waitMs));

  const res = await fetch(`${urlBase}/api/chat/poll?${params.toString()}`, {
    method: 'GET',
    headers: buildHeaders({ appId: opts.appId, gptId: opts.gptId }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  return res.json();
}
