// Frontend-only defaults for the widget's own colours (header background,
// header text, chat/body background, header logo chip background).
//
// widget2/chat and widget2/embed both read these fields straight off the
// backend's widgetParams via `appOrWp` — there is no server-side default for
// any of them. Before this file, each renderer picked its own ad hoc
// fallback when a field was unset ('#fff' here, '#ffffff' there, plain
// `null`/CSS-default somewhere else), so an app with no colours configured
// could look different in the launcher than in the inline embed. This is the
// single default palette both should fall back to, and the same one the
// admin's widget-layout page offers as its "Navy" colour preset — so the
// picker, the preview and the actual widget never disagree.
//
// Navy header with a light body: a dark navy header carries the brand mark
// and title in near-white text, while the conversation area stays light so
// message bubbles and text stay easy to read.
export const DEFAULT_WIDGET_THEME = {
  headerBg: '#25518f',
  headerText: '#f5f8ff',
  backColor: '#c3daf7',
  headerLogoBg: '#e3ebf6',

  /* The bubbles and the box the visitor writes in. White rather than a tint of
     backColor: bubbles that inherit the card colour are invisible against it,
     which is the whole reason this is its own setting. Matches the fallback the
     widgets already carry for --bb-msg-back. */
  messageColor: '#ffffff',

  /* The conversation's text. Both widgets already carry this exact value as
     their --bb-text fallback, so naming it here changes nothing about what an
     unconfigured widget paints — it only gives the admin's picker the same
     value to show, instead of inventing a black the widget never uses.

     Not the header's or the toolbar's text: those derive from the surface
     behind them (resolveHeaderText), which is why headerText is a separate
     field and this one has no say over it. */
  fontColor: '#111827',
} as const;

export type DefaultWidgetThemeKey = keyof typeof DEFAULT_WIDGET_THEME;
