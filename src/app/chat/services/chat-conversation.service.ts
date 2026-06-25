import { Injectable, WritableSignal } from '@angular/core';
import { of } from 'rxjs';

import { BluebootService } from '../../services/blueboot.service';
import { HistoryMessage, subscribeResponse } from '../../services/chat.functions';
import { WidgetApp, WidgetParams } from '../../models/widget-app';
import { Settings } from '../../settings';
import { RetEvent } from '../../../shared-library/models/model-query';
import { Message } from '../models/chat-message.model';

type InfoTextState = {
  infoIdx: number;
  thinkIdx: number;
  info: string[];
  infoThink: string[];
};

export type ChatConversationSendParams = {
  msg: string;

  blueBoot?: BluebootService;
  useAppInterface: boolean;
  selectedModel: string;

  userId?: string;
  appId?: string;
  gptId?: string;
  conversationId: string;

  messages$: WritableSignal<Message[]>;
  msgId: number;
  setMsgId: (id: number) => void;

  infoText: InfoTextState;
  sendingText: string;

  isClearedGlobal: () => boolean;
  unmarkClearedGlobal: () => void;
  rememberInputHistory: (value: string) => void;

  saveToStorage: () => void;
  scrollSoon: () => void;
  focusInput: () => void;

  setIsSending: (value: boolean) => void;
  setShowSuggestions: (value: boolean) => void;
  setActiveAssistantMessageId: (value: number | null) => void;
};

@Injectable({
  providedIn: 'root',
})
export class ChatConversationService {
  sendWithMessage(params: ChatConversationSendParams): void {
    const msg = params.msg.trim();
    if (!msg) return;

    if (params.isClearedGlobal()) {
      params.unmarkClearedGlobal();
    }

    params.rememberInputHistory(msg);

    params.setIsSending(true);
    params.setShowSuggestions(false);

    params.saveToStorage();
    params.scrollSoon();

    const history = this.buildApiHistory(params.messages$());
    const assistantMessageKey = this.newAssistantMessageKey();

    const request$ = (() => {
      if (params.useAppInterface && params.blueBoot) {
        const app = params.blueBoot.widgetApp;

        if (app) {
          return subscribeResponse(Settings.queryBase(), {
            app,
            prompt: msg,
            history,
            userId: params.userId,
            appId: params.appId,
            gptId: params.gptId,
            conversationId: params.conversationId,
            assistantMessageKey,
          });
        }

        const appEmpty = {
          appId: '',
          widgetParams: {} as WidgetParams,
          model: params.selectedModel,
        } as WidgetApp;

        return subscribeResponse(Settings.queryBase(), {
          app: appEmpty,
          prompt: msg,
          history,
          userId: params.userId,
          appId: params.appId,
          gptId: params.gptId,
          conversationId: params.conversationId,
          assistantMessageKey,
        });
      }

      return of({} as RetEvent).pipe();
    })();

    let nextMsgId = params.msgId + 1;
    params.setMsgId(nextMsgId);

    params.messages$.update(arr => [
      ...arr,
      {
        id: nextMsgId,
        role: 'user',
        content: msg,
      },
    ]);

    params.saveToStorage();

    let content: string | undefined = undefined;

    const infoLineRaw = this.nextInfoLine(params.infoText);
    const thinkLineRaw = this.nextThinkingLine(params.infoText, params.sendingText);

    let swapped = !infoLineRaw;
    let baseLine = swapped ? thinkLineRaw : infoLineRaw;
    let info: string | undefined = baseLine;

    const assistantMsgId = nextMsgId + 1;
    params.setActiveAssistantMessageId(assistantMsgId);
    params.setMsgId(assistantMsgId);

    params.messages$.update(arr => [
      ...arr,
      {
        id: assistantMsgId,
        role: 'assistant',
        content,
        info,
        completed: false,
        messageKey: assistantMessageKey,
      },
    ]);

    params.saveToStorage();

    const swapTimer = setTimeout(() => {
      if (!content && !swapped) {
        swapped = true;
        baseLine = thinkLineRaw;
        info = baseLine;

        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, content, info, completed: false }
              : m
          )
        );
      }
    }, 1200);

    let cnt = 0;

    const grow = () => {
      if (content) return;

      cnt += 1;
      const dots = '.'.repeat(((cnt - 1) % 3) + 1);
      info = `${baseLine}${dots}`;

      params.messages$.update(arr =>
        arr.map(m =>
          m.id === assistantMsgId
            ? { ...m, content, info, completed: false }
            : m
        )
      );
    };

    const growTimer = setInterval(grow, 500);

    const clearTimers = () => {
      clearInterval(growTimer);
      clearTimeout(swapTimer);
    };

    request$.subscribe({
      next: (reply: RetEvent) => {
        params.setIsSending(false);

        if (reply.delta) {
          content = (content || '') + reply.delta;
          info = undefined;

          params.messages$.update(arr =>
            arr.map(m =>
              m.id === assistantMsgId
                ? { ...m, content, info, completed: false }
                : m
            )
          );

          params.saveToStorage();
          params.scrollSoon();
        }

        if (reply.text) {
          info = undefined;
          content = reply.text;

          params.messages$.update(arr =>
            arr.map(m =>
              m.id === assistantMsgId
                ? { ...m, content, info: undefined, completed: true }
                : m
            )
          );

          params.saveToStorage();
          params.scrollSoon();
        }

        if (!content) {
          grow();
        } else {
          clearTimers();
        }
      },

      error: (err: any) => {
        clearTimers();

        const errorText = err?.error?.error?.message ?? err?.message ?? 'API error';

        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? {
                ...m,
                role: 'error',
                content: String(errorText),
                info: undefined,
                completed: true,
              }
              : m
          )
        );

        params.saveToStorage();
        params.setActiveAssistantMessageId(null);
        params.setIsSending(false);
      },

      complete: () => {
        clearTimers();

        params.messages$.update(arr =>
          arr.map(m =>
            m.id === assistantMsgId
              ? { ...m, completed: true, info: undefined }
              : m
          )
        );

        params.saveToStorage();

        params.setActiveAssistantMessageId(null);
        params.setIsSending(false);
        params.scrollSoon();
        params.focusInput();
      },
    });
  }

  private buildApiHistory(messages: Message[]): HistoryMessage[] {
    const cleaned = messages
      .filter(m =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
      )
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content!.trim(),
        ...(m.role === 'assistant' && m.messageKey ? { assistantMessageKey: m.messageKey } : {}),
        ...(m.role === 'assistant' && m.feedback?.status ? { feedbackStatus: m.feedback.status } : {}),
        ...(m.role === 'assistant' && m.feedback?.comment ? { feedbackComment: m.feedback.comment } : {}),
        ...(m.role === 'assistant' && m.feedback?.submitted ? { feedbackUpdatedAt: Date.now() } : {}),
      }));

    const dedup: HistoryMessage[] = [];

    for (const item of cleaned) {
      const last = dedup[dedup.length - 1];

      const same =
        !!last &&
        last.role === item.role &&
        last.content === item.content &&
        (last.assistantMessageKey || '') === (item.assistantMessageKey || '');

      if (!same) dedup.push(item);
    }

    return dedup;
  }

  private newAssistantMessageKey(): string {
    return `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private nextInfoLine(infoText: InfoTextState): string {
    const list = (infoText.info || []).filter(s => !!String(s).trim());
    if (!list.length) return '';

    const i = infoText.infoIdx % list.length;
    const out = String(list[i]).trim();

    infoText.infoIdx = (infoText.infoIdx + 1) % list.length;

    return out;
  }

  private nextThinkingLine(infoText: InfoTextState, fallback: string): string {
    const list = (infoText.infoThink || []).filter(s => !!String(s).trim());
    if (!list.length) return fallback || '';

    const i = infoText.thinkIdx % list.length;
    const out = String(list[i]).trim() || fallback || '';

    infoText.thinkIdx = (infoText.thinkIdx + 1) % list.length;

    return out;
  }
}
