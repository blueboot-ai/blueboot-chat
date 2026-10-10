import { clearStoredWidgetDataForAssistant } from './chat-storage.functions';

/**
 * The assistantId every *preview* widget in our own system runs under.
 *
 * Three of them share it, and they share it on purpose: the console's test
 * page, the demo's try-it step, and the /widget preview. All three are pointed
 * at a succession of different apps by someone evaluating or configuring, so
 * all three hold data that is stale the moment the app changes.
 *
 * One id rather than three because they are one *kind* of thing, and the clear
 * below wants all of them. What matters is only that it differs from every
 * real installation's — notably the BB Assistant in our own header, which uses
 * 'BB' and 'BBSITE' and holds conversations somebody actually wants.
 *
 * Must match the assistantid attribute on each of those three widgets.
 */
export const PREVIEW_ASSISTANT_ID = 'bb-preview';

/**
 * Forget what the browser holds for one installation of the widget.
 *
 * Scoped by assistantId, deliberately. localStorage is per-origin, so a
 * customer's site was never in reach of this — but our own site is the same
 * origin as the console, and the BB Assistant in the header is an ordinary
 * installation living there. An earlier version cleared every app on every
 * console app-switch and took an admin's own conversation with it each time.
 *
 * The assistant id is the only thing that separates one widget's stored data
 * from another's on a shared origin, so it is what this takes. There is no
 * "clear everything" variant on purpose: the situations that seem to want one
 * are the situations that caused that bug.
 *
 * @param assistantId  Which installation to forget. Usually
 *                     PREVIEW_ASSISTANT_ID.
 */
export function clearWidgetCacheForAssistant(assistantId: string): void {
  clearStoredWidgetDataForAssistant(assistantId);

  // BluebootClient.clearAppCache() used to be called here as well, and did
  // nothing worth doing. That cache is keyed by app: switching to app B looks
  // up B's key, so A's entry is never in the way — there is no stale frame to
  // prevent. It also could not have been scoped to one assistant, since the
  // console's test embed and the BB Assistant may be reading the same app.
  //
  // Where a stale config *can* actually show is different: after saving widget
  // settings, the cached payload for that same app is out of date until the
  // background refresh lands. If that becomes a visible problem, the fix is to
  // drop that app's entry when the console saves — not when it switches away.
}
