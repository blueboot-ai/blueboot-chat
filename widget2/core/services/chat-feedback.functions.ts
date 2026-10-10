// src/app/widget2/core/services/chat-feedback.functions.ts
//
// Was ChatFeedbackService (@Injectable providedIn:'root'). It held no state,
// injected nothing, and was never doubled in a test — so the class bought
// nothing over plain module functions. Same convention as chat.functions.ts.

import { Message } from '../models/chat-message.model';

export type AssistantFeedbackReaction = 'positive' | 'neutral' | 'negative';

export type SubmitAssistantFeedbackParams = {
  baseUrl: string;
  messages: Message[];
  messageId: number;
  reaction: AssistantFeedbackReaction;
  comment?: string;
  appId?: string;
  gptId?: string;
  conversationId?: string;
};

/** Fire-and-forget POST of a thumbs up/neutral/down on one assistant message. */
export function submitAssistantFeedback(params: SubmitAssistantFeedbackParams): void {
  const message = params.messages.find(m => m.id === params.messageId);
  if (!message) return;

  const previousUserMessage = findPreviousUserMessage(
    params.messages,
    params.messageId
  );

  fetch(`${params.baseUrl}/api/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

/** The user turn that prompted `messageId`, for feedback context. */
function findPreviousUserMessage(messages: Message[], messageId: number): string | undefined {
  const idx = messages.findIndex(m => m.id === messageId);
  if (idx <= 0) return undefined;

  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content) {
      return (messages[i].content ?? '').trim();
    }
  }

  return undefined;
}
