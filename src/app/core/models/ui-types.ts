// src/app/models/ui-types.ts
export type RoleKey = 'user' | 'assistant' | 'error';
export type LocaleCode = 'no' | 'en' | 'ar' | (string & {});

/* ================= UI STRING KEYS =================
 *
 * Split to mirror the sections of the per-language JSON packs in
 * widget2/i18n, so each section stays individually type-checked: a pack
 * missing a key fails the build, and a key can't quietly land in the wrong
 * section. UIStringKey remains the flat union the lookup uses — t() sees one
 * flat map, the files stay readable.
 */

/** Who the widget is: header title and the welcome / placeholder line. */
export type UiIdentityKey =
  | 'title'
  | 'welcomeText';

/** Buttons, labels and affordances around the conversation. */
export type UiChromeKey =
  | 'expand'
  | 'restore'
  | 'newChat'
  | 'closeChat'
  | 'hideChat'
  | 'helpPrompt'
  | 'close'
  | 'you'
  | 'assistant'
  | 'error'
  | 'errorMessage'
  /** The two failures a visitor can do something about, told apart from the
   *  general apology. Everything else still falls back to errorMessage — a
   *  visitor cannot act on a dropped socket, so naming it only worries them. */
  | 'errorFileUnreadable'
  | 'errorBusy'
  | 'configErrorMessage'
  | 'copy'
  | 'copied'
  | 'sending'
  | 'send'
  | 'more'
  | 'suggestions'
  | 'useText'
  | 'switchLang'
  /** The language picker on the tools ruler. Distinct from switchLang, which
   *  is the IP offer's "Continue in <language>" sentence written in the target
   *  language — this one is a control's label, in the current one. */
  | 'langPicker'
  | 'madeByFooter'
  | 'madeByLinkLabel'
  | 'chatModeAi'
  | 'chatModeAgent';

/** The thumbs up/neutral/down control and its modal. */
export type UiFeedbackKey =
  | 'feedbackTitle'
  | 'feedbackSubtitle'
  | 'feedbackPlaceholder'
  | 'feedbackSubmit'
  | 'feedbackCancel'
  | 'feedbackGroupLabel'
  | 'feedbackPositive'
  | 'feedbackNeutral'
  | 'feedbackNegative';

/** Every string key t() can resolve — the three sections flattened. */
export type UIStringKey = UiIdentityKey | UiChromeKey | UiFeedbackKey;

export type TranslationsMap =
  Partial<Record<string, Partial<Record<UIStringKey, string>>>>;
