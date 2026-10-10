import { DEFAULT_WIDGET_THEME } from './default-widget-theme';

/**
 * Picking header text that can be read on the header it sits on.
 *
 * headerBg and headerText are two independent settings with two independent
 * defaults, and the default pair is a navy background with near-white text. An
 * app that sets only its background — the common case, since the background is
 * the visible brand choice and the text colour is not something anyone thinks
 * to pick — got its own white header with #f5f8ff text still on it. White on
 * white: the title greys out, and the icons, which inherit that colour at
 * opacity .85, disappear entirely. It reads as though something is dimming the
 * header, and nothing is.
 *
 * So an unset headerText is derived from the background actually in use rather
 * than defaulted on its own.
 *
 * A configured headerText is honoured too — but only while it can be read. The
 * same white text is stored on plenty of apps from when the header was navy,
 * and "keep the owner's choice" would mean keeping white icons on a white
 * header: the setting is still there, the header is simply blank. Nobody picks
 * an unreadable header on purpose, so below a 3:1 ratio this treats the pair as
 * a leftover rather than a decision and flips the text. Anything readable is
 * left exactly as chosen, including combinations no one would call pretty.
 */

const LIGHT_TEXT = DEFAULT_WIDGET_THEME.headerText;
const DARK_TEXT = '#11223f';

/** Perceived lightness 0–1, or undefined when the string holds no colour we can read. */
export function backgroundLuminance(bg: string | undefined): number | undefined {
    const value = String(bg || '').trim().toLowerCase();
    if (!value) return undefined;

    const rgb = firstColor(value);
    if (!rgb) return undefined;

    // Rec. 709 luma. Good enough to answer "is this dark or light", which is the
    // only question being asked — full WCAG contrast ratios would need both
    // colours, and one of them is what we are trying to choose.
    const [r, g, b] = rgb;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * The first colour in a background string.
 *
 * headerBg may be a full CSS gradient, not just a colour, so this takes the
 * first stop rather than requiring the whole value to be a colour. A gradient
 * that starts light and ends dark will pick text for its light end; that is a
 * design someone chose deliberately and can override deliberately.
 */
function firstColor(value: string): [number, number, number] | undefined {
    const hex = value.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
    if (hex) {
        const h = hex[1];
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        return [
            parseInt(full.slice(0, 2), 16),
            parseInt(full.slice(2, 4), 16),
            parseInt(full.slice(4, 6), 16),
        ];
    }

    const rgb = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

    // The handful of keywords worth knowing. Anything else falls through to
    // undefined, and the caller keeps the default pair.
    if (/\bwhite\b/.test(value)) return [255, 255, 255];
    if (/\bblack\b/.test(value)) return [0, 0, 0];
    if (/\btransparent\b/.test(value)) return [255, 255, 255];

    return undefined;
}

/** WCAG relative luminance, 0–1. Gamma-corrected, unlike the luma above. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
    const channel = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrastRatio(a: string, b: string): number | undefined {
    const ca = firstColor(String(a || '').trim().toLowerCase());
    const cb = firstColor(String(b || '').trim().toLowerCase());
    if (!ca || !cb) return undefined;

    const la = relativeLuminance(ca);
    const lb = relativeLuminance(cb);

    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever the background can carry. */
function derivedFor(background: string): string {
    const luminance = backgroundLuminance(background);
    if (luminance === undefined) return DEFAULT_WIDGET_THEME.headerText;

    // 0.62 rather than 0.5: near-white text starts failing on mid-tones well
    // before they are objectively "light", and a dark title on a mid blue reads
    // better than a washed-out one.
    return luminance > 0.62 ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * The colour the header's text and icons should use.
 *
 * `configured` is widgetParams.headerText. `background` is the header
 * background already resolved through its own default, so this sees what will
 * actually be painted.
 *
 * Unset → derived from the background. Set → kept, unless it cannot be read on
 * that background, in which case it is treated as a leftover from an earlier
 * background and replaced. 3:1 is the WCAG AA floor for large text, which is
 * what a header title and 18px icons are.
 */
export function resolveHeaderText(configured: string | null | undefined, background: string): string {
    const chosen = String(configured || '').trim();
    if (!chosen) return derivedFor(background);

    const ratio = contrastRatio(chosen, background);

    // Unreadable, or a value neither side could be parsed from — a keyword or
    // a gradient this does not know. Unparseable is not evidence of a problem,
    // so it keeps what was chosen.
    if (ratio === undefined || ratio >= 3) return chosen;

    return derivedFor(background);
}
