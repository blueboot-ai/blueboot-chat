// src/app/models/ui-types.ts
export type RoleKey = 'user' | 'assistant' | 'error';
export type LocaleCode = 'no' | 'en' | 'ar' | (string & {});

export type UIStringKey =
  | 'expand'
  | 'restore'
  | 'newChat'
  | 'closeChat'
  | 'you'
  | 'assistant'
  | 'error'
  | 'copy'
  | 'copied'
  | 'sending'
  | 'send'
  | 'madeByPrefix'
  | 'madeByLink'
  | 'more'
  | 'suggestions'
  | 'close'
  | 'useText'
  | 'feedbackTitle'
  | 'feedbackSubtitle'
  | 'feedbackPlaceholder'
  | 'feedbackSubmit'
  | 'feedbackCancel'
  | 'feedbackGroupLabel'
  | 'feedbackPositive'
  | 'feedbackNeutral'
  | 'feedbackNegative'
  | 'madeByFooter'
  | 'madeByLinkLabel';

export type TranslationsMap =
  Partial<Record<string, Partial<Record<UIStringKey, string>>>>;
