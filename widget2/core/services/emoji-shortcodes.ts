// src/app/widget2/core/services/emoji-shortcodes.ts
//
// Turning `:shortcode:` into emoji, and the grouped list the picker shows.
//
// Why this exists: a human agent answering from Slack types `:+1:` and Slack
// delivers the shortcode literally over the webhook, so without this the
// visitor reads ":+1:" where the agent meant 👍. The model writes real emoji
// already; this is for text that came from a person through a chat provider —
// and, since visitors type them too, for anything else in the feed.
//
// The names and characters themselves live in the generated emoji-data.ts —
// the complete Slack set, so anything an agent can type in Slack arrives here
// understood. This file owns only the parts a person decides: the handful of
// extra aliases below, and how a shortcode is recognised in running text.

import { EMOJI_BY_NAME, EMOJI_CATEGORIES } from './emoji-data';

/**
 * Names Slack's own dataset does not carry, kept working anyway.
 *
 * Two kinds. Some are GitHub spellings people type out of habit — `:thinking:`
 * for `thinking_face`, `:robot:` for `robot_face`. The rest are plain-language
 * aliases this widget offered before the full set landed (`:like:`, `:thanks:`),
 * and removing them would silently break messages already sent.
 *
 * Applied over the generated map, never under it: an alias must not shadow a
 * real Slack name that happens to collide with it.
 */
const EXTRA_ALIASES: Readonly<Record<string, string>> = {
  'like': '👍',
  'thanks': '🙏',
  'rofl': '🤣',
  'star_struck': '🤩',
  'hugs': '🤗',
  'thinking': '🤔',
  'raised_eyebrow': '🤨',
  'roll_eyes': '🙄',
  'facepalm': '🤦',
  'man_shrugging': '🤷‍♂️',
  'woman_shrugging': '🤷‍♀️',
  'green_circle': '🟢',
  'yellow_circle': '🟡',
  'orange_circle': '🟠',
  'robot': '🤖',
  'unicorn': '🦄',
};

/**
 * Every shortcode name this widget understands, to its character.
 *
 * The generated Slack set first, then the extras — so a Slack name always wins
 * a collision and the extras only ever fill gaps.
 */
export const EMOJI_SHORTCODES: Readonly<Record<string, string>> = {
  ...EMOJI_BY_NAME,
  ...EXTRA_ALIASES,
};

/** One picker group, resolved to the characters it can actually draw. */
export type EmojiGroup = {
  key: string;
  emojis: Array<{ name: string; char: string }>;
};

/**
 * The picker's contents: the generated categories, in Slack's own order,
 * resolved to characters.
 *
 * Primary names only — the map holds `+1`, `thumbsup` and `like` all pointing
 * at 👍 so any of them typed by an agent is understood, but a picker showing
 * 👍 three times is just a worse picker.
 *
 * Computed once at module load: the contents are static, and rebuilding this
 * every time the picker opens would be work repeated for no reason.
 */
export const EMOJI_PICKER_GROUPS: ReadonlyArray<EmojiGroup> = EMOJI_CATEGORIES
  .map(group => ({
    key: group.key,
    emojis: group.names
      .map(name => ({ name, char: EMOJI_SHORTCODES[name] }))
      // A name in the category list with nothing in the map resolves to
      // undefined — drop it rather than render an empty button.
      .filter((e): e is { name: string; char: string } => !!e.char),
  }))
  .filter(group => group.emojis.length > 0);

/**
 * A `:name:` run. Deliberately narrow: letters, digits, `_`, `+`, `-`.
 *
 * The name may begin with `+` or `-`, because `:+1:` and `:-1:` are two of the
 * most-typed shortcodes there are — an earlier version of this required a
 * leading letter or digit and silently left `:+1:` as text, which is the whole
 * complaint this feature exists to fix.
 *
 * What keeps it from mangling ordinary text is the leading guard: the match
 * must be at the start of the string or preceded by something that is neither
 * a word character nor another colon. That is what leaves `https://host`,
 * `C:\Users`, `10:30:15` and `3:2:1` intact — in every one of those the colon
 * follows a word character — while `:grin:`, ` :+1:` and `(:tada:)` still
 * match. A shortcode a person types stands on its own; one welded to a word
 * is almost always punctuation in something else.
 */
const SHORTCODE_RE = /(^|[^\w:])(:([a-z0-9+-](?:[a-z0-9_+-]*[a-z0-9+])?):)/gi;

/**
 * Replace every known `:shortcode:` in `text` with its emoji.
 *
 * Unknown names are left exactly as they were — a widget that silently ate
 * `:deploy_to_prod:` because it was not in the map would be worse than one
 * that shows the raw text, and the raw text is at least a usable hint that
 * the name needs adding here.
 */
export function replaceEmojiShortcodes(text: string): string {
  // Cheap bail-out: the overwhelming majority of messages contain no colon at
  // all, and this runs on every message on every change-detection pass.
  if (!text || text.indexOf(':') === -1) return text ?? '';

  return text.replace(SHORTCODE_RE, (whole, prefix: string, _match: string, name: string) => {
    const emoji = EMOJI_SHORTCODES[name.toLowerCase()];
    return emoji ? `${prefix}${emoji}` : whole;
  });
}
