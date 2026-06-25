import { Injectable } from '@angular/core';
import { Message } from '../models/chat-message.model';

export type AssistantFeedbackReaction = 'positive' | 'neutral' | 'negative';

export type SubmitAssistantFeedbackParams = {
  baseUrl: string;
  messages: Message[];
  messageId: number;
  reaction: AssistantFeedbackReaction;
  comment?: string;
  userId?: string;
  appId?: string;
  gptId?: string;
  conversationId?: string;
};

@Injectable({
  providedIn: 'root',
})
export class ChatFeedbackService {
  submitAssistantFeedback(params: SubmitAssistantFeedbackParams): void {
    const message = params.messages.find(m => m.id === params.messageId);
    if (!message) return;

    const previousUserMessage = this.findPreviousUserMessage(
      params.messages,
      params.messageId
    );

    fetch(`${params.baseUrl}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.userId ? { 'x-userid': params.userId } : {}),
        ...(params.appId ? { 'x-appid': params.appId } : {}),
        ...(params.gptId ? { 'x-gptid': params.gptId } : {}),
        ...(params.conversationId ? { 'x-conversation-id': params.conversationId } : {}),
      },
      body: JSON.stringify({
        messageId: params.messageId,
        reaction: params.reaction,
        comment: params.comment || '',
        assistantMessage: message.content || '',
        assistantMessageKey: message.messageKey || '',
        previousUserMessage,
        timestamp: Date.now(),
      }),
    }).catch(err => console.error('Feedback send failed', err));
  }

  private findPreviousUserMessage(messages: Message[], messageId: number): string | undefined {
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx <= 0) return undefined;

    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].content) {
        return (messages[i].content ?? '').trim();
      }
    }

    return undefined;
  }
}
