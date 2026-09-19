// The widget's open/closed state, published for the host page.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// The widget can close itself — the Hide button in the panel header, and any
// future path that puts it away. When it does, whatever opened it needs to
// know, or the two disagree: a menu item that still believes the widget is open
// needs two clicks to reopen it, and a header that keeps a slot reserved for a
// panel that is no longer there.
//
// Inside Angular that is the `dismissed` @Output. On a plain host page — a
// WordPress theme, a server-rendered site, anything embedding the custom
// element — there is no output to bind. Those hosts need something they can
// read and something they can listen to, which is what this module is.
//
// ── What a host can rely on ─────────────────────────────────────────────────
//
// Two things, both documented as public API and both written by the same call
// so they cannot disagree:
//
//   1. A localStorage key — durable, survives a reload, answers "is it open?"
//      at any moment including before the widget has finished starting.
//
//        localStorage.getItem('bb:widget-open:<appId>')            // '1' | '0'
//        localStorage.getItem('bb:widget-open:<appId>@<assistantId>')
//
//   2. A window event — live, fires the moment the state changes in this tab.
//
//        window.addEventListener('bb:widget-open-changed', (e) => {
//          e.detail; // { appId, assistantId, open }
//        });
//
// The event matters more than it looks: the `storage` event does NOT fire in
// the tab that made the change, so a host watching storage alone would see
// every tab's changes except its own. Polling the key would work and is what a
// host would otherwise be driven to; this saves them from it.
//
// ── Deliberately separate from the widget's own key ─────────────────────────
//
// buildEmbedOverlayKey() records the same fact for the widget's own use, and
// this does not replace it. That one is internal: its name, its scoping by gpt,
// and its meaning are ours to change. This one is a promise to hosts, so it is
// keyed only on the things a host actually knows — the appId it wrote on the
// tag, and the assistantId if it set one — and its format will not move.

/** Prefix of the published key. Public: hosts read keys with this shape. */
const WIDGET_OPEN_PREFIX = 'bb:widget-open:';

/** Name of the published event. Public: hosts listen for this. */
export const WIDGET_OPEN_EVENT = 'bb:widget-open-changed';

export type WidgetOpenDetail = {
    appId: string;
    assistantId: string;
    open: boolean;
};

/**
 * The published key for one widget.
 *
 * Keyed on appId, plus assistantId when the host set one — the same '@'
 * separator the storage keys use, so a page with two widgets publishes two
 * independent states and a page with one publishes the short form.
 */
export function widgetOpenKey(appId?: string, assistantId?: string): string {
    const app = (appId || '').trim() || 'app';
    const asst = (assistantId || '').trim();

    return `${WIDGET_OPEN_PREFIX}${app}${asst ? `@${asst}` : ''}`;
}

/**
 * Record the state and announce it.
 *
 * Both, always, in that order: the key is written first so a listener reacting
 * to the event and then reading storage cannot see the old value.
 *
 * Never throws. A host that has blocked storage still gets the event, and a
 * host with no listener still gets the key — neither half is allowed to take
 * the other down, because this is a courtesy to the page and not something the
 * widget's own behaviour depends on.
 */
export function publishWidgetOpen(appId: string | undefined, assistantId: string | undefined, open: boolean): void {
    const detail: WidgetOpenDetail = {
        appId: (appId || '').trim(),
        assistantId: (assistantId || '').trim(),
        open,
    };

    try {
        localStorage.setItem(widgetOpenKey(appId, assistantId), open ? '1' : '0');
    } catch {}

    try {
        window.dispatchEvent(new CustomEvent<WidgetOpenDetail>(WIDGET_OPEN_EVENT, { detail }));
    } catch {}
}
