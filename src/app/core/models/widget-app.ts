// This used to be a hand-maintained copy of the wire format, kept alongside
// the real one in shared-library. The two drifted: this file's WidgetParams
// typed `suggestions` as a boolean (shared-library has it as string[], the
// actual prompt chips) and was missing fields shared-library already had
// (headerBg, enableSuggestion, fontFamily/fontSize/lineHeight,
// launcher video, …), while WidgetApp here carried a `suggestions` field
// that doesn't exist on the real model at all (suggestions only ever live
// under widgetParams.suggestions).
//
// Nothing here is widget2-specific — it is the same backend wire shape
// every consumer of the app/widgetParams payload shares — so there is no
// reason for a second declaration. Re-exporting keeps every existing
// `import { WidgetApp } from './models/widget-app'` in widget2 working
// unchanged while there is only one real definition to edit.
//
// Per this repo's rules: never edit src/app/shared-library directly (it is
// a compiled copy, overwritten on every build) — edit the source at
// assist-app/shared-library/src/models/widget-app.ts instead.
export type {
  WidgetApp,
  WidgetParams,
  WidgetParamsLang,
  WidgetParamsLangMap,
  InfoText,
  RoleKey,
  LocaleCode,
  TranslationsMap,
} from '../../shared/widget-app';
