// Moving and resizing the embed's overlay panel.
//
// Embed only. The launcher panel docks itself against its button
// (launcher-position.service.ts) and must not gain a second, conflicting idea
// of where it belongs.
//
// The panel is normally position:absolute against the embed's own host element
// — that is what pins it to the inline box the visitor was typing in, and what
// makes it track page scroll with no measuring. A panel someone has *placed*
// wants the opposite: to stay where it was put. So a moved panel switches to
// position:fixed, and this module owns that state.

/** Where a placed panel sits, in viewport coordinates. */
export type EmbedWindowBox = {
    x: number;
    y: number;
    w: number;

    /**
     * The height the visitor chose, kept even while it is not in use.
     *
     * An empty panel sizes to its contents whatever this says — see
     * heightIsAuto() — so this is the height waiting for a conversation to
     * fill it, not necessarily the height on screen.
     */
    h: number;
};

/** Below this the panel stops being usable rather than merely small. */
export const MIN_W = 280;
export const MIN_H = 220;

/** How much of the panel must stay on screen vertically.
 *
 *  Only the header needs to be reachable — that is the drag handle, so as long
 *  as it is visible the panel can always be pulled back up. */
const KEEP_VISIBLE_Y = 34;

/**
 * Air kept between the panel and the left and right edges of the viewport.
 *
 * Horizontally the panel stays inside the viewport entirely; it used to be
 * allowed to hang off either side with 80px still showing. Off the right is
 * where content goes to be lost — text runs into the edge, the scrollbar sits
 * over it — and off the left is worse, because that is the side the message
 * text starts on.
 *
 * So rather than sliding out, the panel stops at the margin and narrows.
 * 15px is enough to read as a margin rather than a clipping error, and small
 * enough that a visitor pushing the panel aside still gets most of what they
 * asked for.
 */
const EDGE_MARGIN = 15;

export function clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
}

/**
 * Pull a box back until it can still be grabbed.
 *
 * Applied on restore and on window resize, not only on drop: the viewport the
 * panel was placed in is not the one it comes back to. A panel saved on a wide
 * monitor and reopened on a laptop would otherwise be parked off-screen with no
 * way to retrieve it.
 */
export function clampBox(
    box: EmbedWindowBox,
    vw: number,
    vh: number,
): EmbedWindowBox {
    const h = clamp(box.h, MIN_H, Math.max(MIN_H, vh));

    // The furthest right the panel's right edge may reach.
    const maxRight = Math.max(MIN_W + EDGE_MARGIN, vw - EDGE_MARGIN);

    // x first, because the width that fits depends on where the panel starts.
    //
    // Both bounds are hard now. The lower one is the left margin; the upper one
    // is the point where a minimum-width panel still fits inside the right
    // margin, because past that there is nothing left to shrink and moving
    // further would push the panel back out of the margin being enforced.
    const x = clamp(box.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, maxRight - MIN_W));

    // Then the width, shrunk to whatever is left between x and the margin.
    // A panel dragged rightwards therefore narrows instead of sliding off, and
    // one restored on a screen narrower than the one it was placed on arrives
    // already fitted rather than hanging over the edge.
    const w = clamp(box.w, MIN_W, Math.max(MIN_W, maxRight - x));

    // The viewport is the only ceiling. The panel used to be held below the
    // host's sticky chrome as well, which stopped a visitor pulling it up to
    // where they wanted it on every page that has a fixed menu.
    return {
        w,
        h,
        x,
        y: clamp(box.y, 0, vh - KEEP_VISIBLE_Y),
    };
}

/**
 * Can position:fixed be trusted on this page?
 *
 * A `transform`, `filter`, `perspective`, `backdrop-filter` or `will-change` on
 * any ancestor makes fixed positioning resolve against *that element* rather
 * than the viewport. The widget sits inside someone else's DOM and cannot stop
 * them doing it, so a dragged panel would land somewhere arbitrary and the
 * visitor would have no idea why.
 *
 * Checked once, when the panel opens, and drag is simply not offered when the
 * answer is no. Degrading to "this page does not have the feature" is far
 * better than offering a control that puts the panel somewhere unreachable.
 */
export function canUseFixed(el: Element | null | undefined): boolean {
    if (!el || typeof getComputedStyle !== 'function') return false;

    let node: Element | null = el.parentElement;

    while (node && node !== document.documentElement) {
        const s = getComputedStyle(node);

        if (
            (s.transform && s.transform !== 'none') ||
            (s.perspective && s.perspective !== 'none') ||
            (s.filter && s.filter !== 'none') ||
            (s.backdropFilter && s.backdropFilter !== 'none') ||
            (s.contain && /paint|layout|strict|content/.test(s.contain)) ||
            (s.willChange && /transform|perspective|filter/.test(s.willChange))
        ) {
            return false;
        }

        node = node.parentElement;
    }

    return true;
}

// Persistence used to live here, as readWindowBox()/writeWindowBox() against a
// key of their own. It moved to core/services/chat-storage.functions.ts —
// loadWindowBox() / saveWindowBox() — because the placement now shares one
// cache entry, and one 24-hour clock, with the visitor's own details.
//
// The two belong together: both describe the person who is here now rather than
// the conversation, and both should lapse when that visit does. Separate keys
// meant a panel could come back placed exactly where a different visitor left
// it, while the name that would have identified them had already expired.
//
// This module keeps the geometry: the box type, the minimums, clamping, and the
// position:fixed safety check. Those are decisions about layout, not storage.
