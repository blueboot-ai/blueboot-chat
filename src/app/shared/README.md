# widget2/shared

Local copies of the shared-library symbols widget2 actually uses, so this
module can build on its own without a dependency on `shared-library`
(`src/app/shared-library`, itself a compiled copy of the top-level
`shared-library/src`).

Files here mirror their shared-library origin:

- `languages.ts` — from `shared-library/src/models/languages.ts`, copied verbatim.
- `lang-detect.ts` — from `shared-library/src/models/lang-detect.ts`, verbatim
  apart from importing `./languages` from this folder instead.
- `model-query.ts` — from `shared-library/src/models/model-query.ts`, trimmed
  to only what widget2 imports (`AttachmentKind`, `classifyAttachment`,
  `resolveMimeType`, `isMimeTypeAllowed`, `attachmentDownloadUrl`,
  `QueryAttachment`, `MsgMode`, `QueryMessage`, `ChatInfo`, `RetEvent`,
  `ChatRole`, `HistoryMessage`, `InputBody`) plus what those need internally.
  `ChatInfo.messageDate` is typed `number | Date` here instead of
  shared-library's `TimestampLike`, since widget2 never reads or writes it.
- `widget-app.ts` — from `shared-library/src/models/widget-app.ts`, trimmed to
  `WidgetApp`, `WidgetParams` and the types they need (`SiteInfo` is inlined
  from `rag-app.ts` rather than pulling that whole module in). `UsageLog` is
  kept for parity but unused anywhere in widget2 today.

If shared-library gains a fix or a new field that widget2 needs, it has to be
copied over here by hand — these are not re-exports, they're independent
copies. Regenerating this folder means re-diffing it against the current
shared-library source rather than trusting it stayed in sync.
