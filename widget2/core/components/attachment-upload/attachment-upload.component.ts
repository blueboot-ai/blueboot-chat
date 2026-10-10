// The attach control on the input-functions ruler: pick a file from disk.
//
// Picks and validates; it does not send. The chosen File is handed up whole
// rather than read into a data URL, because public-service's upload endpoint
// (responses-web-upload.ts) takes multipart form data — base64 here would be a
// third larger and would have to be undone before it could be posted.
//
// Limits come from the app config (ChatLimits, served on getApp) rather than
// being hardcoded, so an admin raising the size cap raises it here too. They
// are still re-checked server-side: this is a courtesy to the visitor, not a
// security boundary — an oversized file caught in the browser saves an upload
// that was going to be rejected anyway.

import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';

import { AttachmentKind, classifyAttachment, isMimeTypeAllowed, resolveMimeType } from '../../../shared/model-query';

/**
 * What the composer receives when the visitor picks a file.
 *
 * `kind` is the shared AttachmentKind, not a local one: the same four
 * categories the wire model and the backend use, so a video stays a video all
 * the way through instead of being flattened to "file" at the boundary.
 */
export type PickedAttachment = {
  /** The file itself — what a multipart upload actually needs. */
  file: File;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  /** Object URL for the kinds a browser can play or draw (image, video), for
   *  a thumbnail or preview. The creator revokes it (see ngOnDestroy) —
   *  whoever renders it must not. */
  previewUrl?: string;
};

/**
 * A file size a person can read: "812 B", "240 KB", "1.4 MB".
 *
 * One decimal only above a megabyte — "1.4 MB" tells the visitor what they
 * need; "1.44 MB" is precision nobody asked for. Binary units (1024), because
 * that is what the size limits are written in.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;

  return `${(kb / 1024).toFixed(1)} MB`;
}

/** The slice of ChatLimits this control needs. Partial so a caller can pass
 *  the app's chatLimits straight through without reshaping it. */
export type AttachmentLimits = {
  uploadEnabled?: boolean;
  maxFileSizeBytes?: number;
  maxFilesPerRequest?: number;
  allowedMimeTypes?: string[];
};

/** Used when the app config has not arrived yet, or omits a field. Matches
 *  defaultChatLimits in shared-backend's default-app.ts. */
const FALLBACK_MAX_BYTES = 5 * 1024 * 1024;
const FALLBACK_MAX_FILES = 3;

/** Extension to give a pasted image, by the type the clipboard reports.
 *  Only the formats a clipboard actually produces — a paste is a screenshot or
 *  a copied picture, never a TIFF. */
const EXTENSION_FOR_IMAGE_TYPE: Record<string, string> = {
  'image/png':  '.png',
  'image/jpeg': '.jpg',
  'image/gif':  '.gif',
  'image/webp': '.webp',
  'image/bmp':  '.bmp',
};

/** Document types the file dialog cannot be trusted to match by MIME alone. */
const EXTENSION_FOR_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',

  // text/plain is what every text format resolves to (see resolveMimeType), so
  // one accepted entry has to offer all of them in the dialog — otherwise a
  // .json is greyed out despite being accepted everywhere else.
  'text/plain': '.txt,.json,.csv,.md,.log,.xml',
};

/**
 * Extensions to add whenever a family is allowed at all.
 *
 * The MIME entries alone are not enough. `accept="image/png"` greys out a file
 * whose type the OS reports as something else — and the exact list names four
 * image types while the server accepts any image/… by prefix, so a .heic from
 * an iPhone or a .bmp was unpickable even though the upload would have taken
 * it. Listing the extensions restores the match, because the dialog tests them
 * against the filename rather than against the OS type database.
 */
const FAMILY_EXTENSIONS: Record<string, string[]> = {
  // PNG and JPEG only. The dialog is an offer, not the rule — the server still
  // accepts any image/… by prefix — but these are the two a visitor actually
  // attaches, and a ten-entry list of formats nobody sends is noise in the
  // "files of type" dropdown.
  image: ['.png', '.jpg', '.jpeg'],
  video: ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v', '.mpg', '.mpeg', '.wmv'],
};

@Component({
  selector: 'app-attachment-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attachment-upload.component.html',
  styleUrl: './attachment-upload.component.css',
})
export class AttachmentUploadComponent implements OnDestroy {
  @Input() t: (key: string) => string = () => '';

  @Input() disabled = false;

  /** ChatLimits off the app config. */
  @Input() limits?: AttachmentLimits;

  /** How many are already attached to this message, so the per-request cap
   *  can be enforced before the picker even opens. */
  @Input() attachedCount = 0;

  @Output() picked = new EventEmitter<PickedAttachment>();

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  /** Shown next to the button when a file is turned away. Cleared on the next
   *  pick, or after a few seconds — an error about a file the visitor has
   *  already moved on from is just noise. */
  errorText = '';
  private errorTimer: any;

  /** Object URLs handed out, so they can be released on destroy. */
  private readonly previewUrls: string[] = [];

  /** Hidden when the admin has turned uploads off for this GPT. */
  get visible(): boolean {
    return this.limits?.uploadEnabled !== false;
  }

  get maxBytes(): number {
    return this.limits?.maxFileSizeBytes ?? FALLBACK_MAX_BYTES;
  }

  get maxFiles(): number {
    return this.limits?.maxFilesPerRequest ?? FALLBACK_MAX_FILES;
  }

  /** Full up, or the composer is busy. */
  get isDisabled(): boolean {
    return this.disabled || this.attachedCount >= this.maxFiles;
  }

  /**
   * The `accept` attribute, from the configured MIME types.
   *
   * A hint to the file dialog, never a check — every browser lets the visitor
   * switch to "All files", so validate() below re-tests what actually arrives.
   */
  get acceptAttr(): string | null {
    const types = this.limits?.allowedMimeTypes;
    if (!types?.length) return null;

    // Extensions alongside the MIME types. `accept` takes either, and the
    // types alone are not enough: the dialog matches them against the OS's own
    // idea of the file's type, so on a machine that does not recognise
    // spreadsheetml the .xlsx the visitor came to attach is greyed out and
    // unpickable. An extension is matched on the name, which always works.
    const out = new Set<string>(types);

    for (const type of types) {
      const documentExt = EXTENSION_FOR_TYPE[type];
      if (documentExt) out.add(documentExt);

      // One allowed image type means every image is allowed — that is what
      // isMimeTypeAllowed() enforces on both sides — so the dialog should
      // offer them all rather than the four that happen to be named.
      const family = type.split('/')[0];
      for (const ext of FAMILY_EXTENSIONS[family] ?? []) out.add(ext);

      // A wildcard entry names a family and nothing the dialog can match, so
      // it contributes its extensions and is dropped itself.
      if (type.endsWith('/*')) out.delete(type);
    }

    return [...out].join(',');
  }

  get buttonLabel(): string {
    return (this.t('attachFile') || '').trim() || 'Attach a file';
  }

  openPicker(): void {
    if (this.isDisabled) return;
    this.clearError();
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Reset immediately, and before anything can return early: without this,
    // picking the same file twice in a row fires no change event the second
    // time, and the control looks broken.
    input.value = '';

    if (!file) return;

    this.accept(file);
  }

  /**
   * Files that arrived on the clipboard. Returns how many were taken.
   *
   * Public because the paste happens in the textarea, which this component
   * does not own — the composer catches the event and hands the files here, so
   * a pasted file goes through exactly the same limits, MIME check and preview
   * as one chosen from disk. Two validation paths for the same file would
   * eventually disagree.
   *
   * Any kind the app allows: a screenshot, but equally a PDF or a spreadsheet
   * copied in the file manager. What is allowed is not decided here —
   * validate() tests each one against the configured MIME types, so an admin
   * who has not enabled documents does not get them by the back door, and a
   * visitor who pastes something unsupported is told rather than ignored.
   */
  acceptPastedFiles(files: File[]): number {
    if (!this.visible || this.disabled) return 0;
    if (files.length === 0) return 0;

    const room = this.maxFiles - this.attachedCount;
    if (room <= 0) {
      this.showError(this.tooManyMessage());
      return 0;
    }

    let taken = 0;
    for (const file of files.slice(0, room)) {
      if (this.accept(this.named(file))) taken += 1;
    }

    // Say so rather than dropping the rest quietly — a visitor who pasted four
    // screenshots and got two has to be told which happened.
    if (files.length > room) this.showError(this.tooManyMessage());

    return taken;
  }

  /** Validate, then hand the file up. True when it was accepted. */
  private accept(file: File): boolean {
    const problem = this.validate(file);
    if (problem) {
      this.showError(problem);
      return false;
    }

    const kind = classifyAttachment(file.type, file.name);
    let previewUrl: string | undefined;

    // Only for what a browser can actually render. A sound file has nothing to
    // show, and an object URL nobody draws is a file pinned in memory for no
    // reason — see ngOnDestroy.
    if (kind === 'image' || kind === 'video') {
      previewUrl = URL.createObjectURL(file);
      this.previewUrls.push(previewUrl);
    }

    this.picked.emit({
      file,
      kind,
      name: file.name,
      // Resolved, so the feed row says "Spreadsheet" rather than falling back
      // to the generic octet-stream label for a file the browser shrugged at.
      mimeType: resolveMimeType(file.type, file.name) || 'application/octet-stream',
      size: file.size,
      ...(previewUrl ? { previewUrl } : {}),
    });

    return true;
  }

  /**
   * Give a pasted bitmap a real filename.
   *
   * A screenshot has no usable one — browsers give "image.png" at best and ""
   * often enough. That is not cosmetic: isMimeTypeAllowed() and
   * resolveMimeType() both fall back to the extension when the browser reports
   * no type, so a nameless file is judged on `type` alone and shows in the feed
   * as a blank. And three attachments all called "image.png" tell the visitor
   * nothing about which is which.
   *
   * A file copied in the file manager keeps its own name, always — that name is
   * information, and a document called "Q3-forecast.xlsx" must not arrive as
   * "pasted-20260913-014230.xlsx". Hence the bitmap-only condition: an
   * untitled image, or the placeholder name browsers use for one.
   */
  private named(file: File): File {
    const isBitmapPaste =
      file.type.startsWith('image/') && (!file.name || file.name === 'image.png');

    if (!isBitmapPaste) return file;

    const ext = EXTENSION_FOR_IMAGE_TYPE[file.type] ?? '.png';
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    return new File([file], `pasted-${stamp}${ext}`, {
      type: file.type,
      lastModified: file.lastModified,
    });
  }

  private tooManyMessage(): string {
    return (this.t('attachTooMany') || '').trim()
      || `You can attach ${this.maxFiles} file${this.maxFiles === 1 ? '' : 's'} at a time.`;
  }

  /** Null when the file is fine, otherwise the sentence to show. */
  private validate(file: File): string | null {
    if (file.size > this.maxBytes) {
      const mb = Math.max(1, Math.round(this.maxBytes / (1024 * 1024)));
      return (this.t('attachTooLarge') || '').trim() || `That file is too large — the limit is ${mb} MB.`;
    }

    // isMimeTypeAllowed(), not `allowed.includes(file.type)`. The literal test
    // rejected any file the browser could not identify: a .xlsx on a machine
    // with no Office install reports "" or application/octet-stream, matched
    // nothing in the list, and was turned away here — before the server, which
    // would have accepted it, ever saw it. The name is passed so the type can
    // be resolved from the extension in exactly that case.
    //
    // Still only a courtesy check; the server re-tests with the same function.
    if (!isMimeTypeAllowed(file.type, file.name, this.limits?.allowedMimeTypes)) {
      return (this.t('attachWrongType') || '').trim() || 'That kind of file cannot be attached.';
    }

    // A zero-byte file uploads "successfully" and produces nothing, which
    // reads as a silent failure. Better to say so here.
    if (file.size === 0) {
      return (this.t('attachEmptyFile') || '').trim() || 'That file is empty.';
    }

    return null;
  }

  private showError(text: string): void {
    this.errorText = text;
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => { this.errorText = ''; }, 6000);
  }

  private clearError(): void {
    clearTimeout(this.errorTimer);
    this.errorText = '';
  }

  ngOnDestroy(): void {
    clearTimeout(this.errorTimer);
    // Object URLs pin the file in memory until revoked, and nothing else owns
    // these — the component that created them has to let them go.
    this.previewUrls.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
  }
}
