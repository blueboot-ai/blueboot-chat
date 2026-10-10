// Holding the host page still while the embed's panel is open on a phone.
//
// Embed only, and mobile only. On a phone the open panel covers the screen
// (see the max-width:600px block in embed.component.css), so a touch that
// misses the conversation scrolls the customer's page behind it instead — the
// panel appears to sit still while the world slides underneath, and a visitor
// who scrolls too far has to find their way back to a widget that has not
// moved. On desktop the panel is a window on a page the visitor can still see
// and use, and locking there would be taking something away for no reason.
//
// This is the one place the widget touches the host page's own elements. Two
// consequences follow from that, and both are handled below rather than
// assumed away: the styles we overwrite are saved and put back exactly, and a
// second widget on the same page must not unlock while the first still needs
// the lock.

/** What the page looked like before we touched it. */
type SavedBodyStyle = {
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflow: string;
    scrollY: number;
};

let saved: SavedBodyStyle | null = null;

/**
 * How many widgets currently want the page held.
 *
 * A page can mount more than one embed — the marketing site does. Without a
 * count, the first one to close would unlock while the other is still covering
 * the screen, and worse, would restore a scroll position captured before the
 * other one opened.
 */
let holders = 0;

/** The widget's own definition of mobile — the same 600px the stylesheet uses.
 *  One breakpoint, so the lock and the full-screen layout can never disagree
 *  about which one is in effect. */
export const MOBILE_QUERY = '(max-width: 600px)';

export function isMobileViewport(): boolean {
    try {
        return matchMedia(MOBILE_QUERY).matches;
    } catch {
        // No matchMedia is old enough that it is not a phone we are serving a
        // full-screen panel to. Not locking is the safe answer either way: the
        // page keeps working, it just scrolls.
        return false;
    }
}

/**
 * Stop the page behind the panel from scrolling.
 *
 * `overflow: hidden` on its own is not enough — iOS Safari scrolls the body
 * regardless — so the body is taken out of flow at a negative offset equal to
 * the current scroll position. That freezes the page exactly where it was
 * while keeping it looking untouched, which the naive version does not: a bare
 * `position: fixed` throws the visitor back to the top of the page and then
 * leaves them there when the panel closes.
 *
 * Idempotent. Calling it twice takes one lock and one snapshot, not two.
 */
export function lockBodyScroll(): void {
    if (typeof document === 'undefined') return;

    holders += 1;
    if (saved) return;

    const body = document.body;
    if (!body) return;

    const scrollY = window.scrollY || window.pageYOffset || 0;

    saved = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        scrollY,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    // Explicit width: a fixed body no longer takes its width from the flow, and
    // some pages end up shrink-to-fit without this.
    body.style.width = '100%';
    body.style.overflow = 'hidden';
}

/**
 * Give the page back, and put the visitor where they were.
 *
 * The scroll restore is the part that matters. The body has been sitting at a
 * negative top, so releasing it without scrolling back lands the page at the
 * top — the visitor closes the widget and finds themselves somewhere they
 * never navigated to.
 *
 * Every field is restored to the string it held before, empty string included:
 * assigning '' removes the inline declaration and lets the page's own
 * stylesheet apply again, which is not the same as writing 'static' over it.
 */
export function unlockBodyScroll(): void {
    if (typeof document === 'undefined') return;

    holders = Math.max(0, holders - 1);
    if (holders > 0 || !saved) return;

    const body = document.body;
    const prev = saved;
    saved = null;

    if (!body) return;

    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    body.style.overflow = prev.overflow;

    // Instant, not smooth: this is putting things back, not a journey. A
    // smooth scroll here animates the page under a widget that has already
    // gone, which reads as the page moving on its own.
    try {
        window.scrollTo({ top: prev.scrollY, behavior: 'instant' as ScrollBehavior });
    } catch {
        window.scrollTo(0, prev.scrollY);
    }
}

/** True when this module is currently holding the page. Lets a caller ask
 *  rather than track a flag of its own that could drift out of step. */
export function bodyScrollIsLocked(): boolean {
    return !!saved;
}
