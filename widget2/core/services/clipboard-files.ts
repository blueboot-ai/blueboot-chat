/**
 * The files on a clipboard, if any.
 *
 * Reads `items` rather than `files`: a screenshot pasted from the OS arrives as
 * an item with kind "file" and, on some browsers, no entry in `files` at all —
 * so the shorter route misses exactly the case this is for.
 *
 * Only entries the clipboard itself calls a file are taken, which is what
 * separates "I copied a PDF in Explorer" from "I copied a paragraph". Text,
 * HTML and the rich-text flavours a word processor puts on the clipboard all
 * arrive with kind "string" and are ignored here, so an ordinary paste finds
 * nothing and the caller leaves the event alone.
 *
 * What is *allowed* is not decided here. Every file goes through the same
 * validation the file picker uses, which tests it against the app's configured
 * MIME types — so an admin who has not enabled PDFs does not get them by the
 * back door.
 *
 * Shared by both composers — the panel and the embed each own their own
 * textarea, and two copies of this would eventually disagree.
 */
export function filesOnClipboard(data: DataTransfer | null): File[] {
  const items = data?.items;
  if (!items?.length) return [];

  const out: File[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;

    const file = item.getAsFile();
    if (file) out.push(file);
  }

  return out;
}
