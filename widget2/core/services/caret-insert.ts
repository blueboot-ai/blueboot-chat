// Inserting text into a textarea at the caret.
//
// Shared by both composers so the emoji picker behaves identically on the
// panel and the embed — and because getting this wrong is invisible until
// someone tries it mid-sentence, at which point the character lands at the end
// of the message instead of where they were typing.

/**
 * Insert `text` at the caret of `el`, replacing any selection.
 *
 * Returns the resulting value; the caller owns pushing it back through
 * ngModel, since the element and the model are two different things and only
 * the caller knows which model this element is bound to.
 *
 * The caret is restored just after the inserted text, on the next frame.
 * Immediately would be wrong: Angular writes the new value into the element
 * during the change-detection pass that follows this call, and a selection set
 * before that write is discarded by it — leaving the caret at the end of the
 * message, which is exactly the bug this function exists to avoid.
 */
export function insertAtCaret(el: HTMLTextAreaElement | HTMLInputElement | undefined, text: string): string {
  if (!el) return text;

  const value = el.value ?? '';
  // selectionStart/End are null on input types that don't support selection.
  // Falling back to the end of the value keeps this a no-op-ish append rather
  // than throwing or inserting at position 0.
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;

  const next = value.slice(0, start) + text + value.slice(end);
  const caret = start + text.length;

  requestAnimationFrame(() => {
    // The element may be gone (widget closed between click and frame), and
    // focus is part of the point: after picking, the visitor should be able to
    // keep typing without clicking back into the box.
    if (!el.isConnected) return;
    el.focus();
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      // Some input types reject setSelectionRange; the text is in either way.
    }
  });

  return next;
}

