import { Pipe, PipeTransform } from '@angular/core';

import { replaceEmojiShortcodes } from './emoji-shortcodes';

/**
 * Draws `:shortcode:` names in the feed as emoji — `:grin:` as 😁.
 *
 * Display only. The stored message keeps the text exactly as it arrived, so
 * history, what is relayed back to the agent, and what the backend recorded
 * all still hold the original — turning this off changes nothing about the
 * data, and nothing has to be migrated.
 *
 * Pure (the Angular default), so it re-runs only when the string identity
 * changes rather than on every change-detection pass.
 */
@Pipe({
  name: 'emoji',
  standalone: true,
})
export class EmojiPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    return replaceEmojiShortcodes(text ?? '');
  }
}
