

export type Role = 'user' | 'assistant' | 'error';

export type FeedbackType = 'positive' | 'neutral' | 'negative';

export type Message = {
  id: number;
  role: Role;
  content?: string;
  info?: string;
  completed?: boolean;
  messageKey?: string;
  feedback?: {
    status?: FeedbackType;
    comment?: string;
    submitted?: boolean;
  };
};

export type StoredHistory = {
  storeTime?: number;
  conversationId?: string;
  messages?: Message[];
  inputHistory?: string[];
};
