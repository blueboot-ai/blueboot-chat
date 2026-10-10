// Renders the attachments on a message — name, type and size, one row each.
//
// One component for both surfaces. It hangs off MessageBodyComponent, which
// the panel and the embed already share, so neither template has to know
// attachments exist and the two can never drift into rendering them
// differently — which is exactly what happened to the message header, where
// the panel has .who and the embed has .msg-header saying the same thing twice.
//
// Deliberately not a preview yet: name, type and size is what tells a visitor
// their file arrived. Thumbnails and players are a later decision, and the
// data they need (previewUrl, downloadUrl) is already on QueryAttachment.

import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { AttachmentKind, QueryAttachment } from '../../../shared/model-query';
import { formatFileSize } from '../attachment-upload/attachment-upload.component';

@Component({
  selector: 'app-attachment-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attachment-list.component.html',
  styleUrl: './attachment-list.component.css',
})
export class AttachmentListComponent {
  @Input() attachments: QueryAttachment[] | undefined;

  /** Localized label lookup, passed down like every other widget component. */
  @Input() t: (key: string) => string = () => '';

  /** How the upload is getting on — see Message.uploadState. Absent means
   *  stored, which is also what everything restored from storage looks like. */
  @Input() state?: 'uploading' | 'failed';

  /** Why it failed, when it did. The server writes this sentence, so the
   *  wording is the same whether the file was too large, the wrong type, or
   *  uploads are turned off for this assistant. */
  @Input() error?: string;

  get isUploading(): boolean {
    return this.state === 'uploading';
  }

  get hasFailed(): boolean {
    return this.state === 'failed';
  }

  get statusText(): string {
    if (this.isUploading) return (this.t('attachUploading') || '').trim() || 'Uploading…';
    if (this.hasFailed) return (this.error || '').trim() || (this.t('attachFailed') || '').trim() || 'Upload failed';
    return '';
  }

  /**
   * The ones that have a picture to show.
   *
   * `content` is the downscaled data URL the composer made from the visitor's
   * own bytes (see attachment-preview.ts). Its presence — not the kind — is
   * what decides: an image whose preview could not be produced has no tile to
   * draw and belongs in the rows below, where it still reads as an attachment.
   */
  get tiles(): QueryAttachment[] {
    return (this.attachments ?? []).filter(a => !!this.pictureSrc(a));
  }

  /** Everything without a picture: documents, sound, and failed previews. */
  get rows(): QueryAttachment[] {
    return (this.attachments ?? []).filter(a => !this.pictureSrc(a));
  }

  /**
   * What to draw in a tile: the local bytes if we still have them, otherwise
   * the stored copy.
   *
   * Both, because they belong to different moments. `content` is present on the
   * turn the visitor attached the file and is instant — no network, no chance
   * of a flash of nothing. It is then dropped when the conversation is written
   * to storage (see toStoredAttachments), because base64 in a 5MB quota is what
   * evicts other conversations. From that point on `docUrl` is the picture, and
   * a reloaded conversation fetches it.
   *
   * An image with neither is not a tile. That is a real state — an upload that
   * failed to store, or a preview that could not be produced — and it belongs
   * in the rows below, where it still reads as an attachment the visitor sent
   * rather than disappearing from the message.
   */
  pictureSrc(a: QueryAttachment): string {
    if (a.kind !== 'image' && a.kind !== 'video') return a.content || '';
    return a.content || a.docUrl || '';
  }

  /**
   * The address to open a document at, or '' when there is nothing to open.
   *
   * docUrl only. `content` is a data URL that would open a base64 blob in a new
   * tab, and the legacy `link`/`downloadUrl` are the Meta path's signed URLs,
   * which have usually expired by the time anyone reads the conversation back.
   */
  openUrl(a: QueryAttachment): string {
    return a.docUrl || '';
  }

  /**
   * The attachment whose download is waiting to be confirmed, if any.
   *
   * Held by identity rather than by index: the array is rebuilt on every change
   * detection pass, and an index would open the wrong file the moment an
   * attachment ahead of it changed.
   */
  confirming: QueryAttachment | null = null;

  /**
   * A click on a filename asks first.
   *
   * Two reasons, and the second is the one that made this necessary. A download
   * is not what everyone means by clicking a filename — some want to see what
   * they sent — and a file arriving in the downloads folder unannounced is a
   * surprise. But the widget also lives inside someone else's page: a click
   * that reaches the document does the composer's focus work and, in the embed,
   * touches the panel state, which is the flicker.
   *
   * preventDefault/stopPropagation stop both. The navigation is then performed
   * deliberately in confirm() rather than by the browser, which is what turns
   * an ambient side effect into an action the visitor asked for.
   */
  askDownload(event: Event, a: QueryAttachment): void {
    event.preventDefault();
    event.stopPropagation();

    this.confirming = a;
  }

  /** Not this one after all. */
  cancelDownload(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    this.confirming = null;
  }

  /** True while the bytes are being fetched, so the row can say so. */
  downloading: QueryAttachment | null = null;

  /**
   * Hand the file to the browser without opening a tab.
   *
   * window.open() was the obvious way and is the wrong one. A URL the browser
   * decides to *download* rather than render still gets a tab: it opens, the
   * download is handed to the download manager, and the tab closes again. That
   * open-and-close is the flicker — it is the browser's own window, and nothing
   * in the widget can style or prevent it.
   *
   * So the bytes are fetched instead and served from a blob URL. A blob is
   * same-origin by definition, which is what makes the `download` attribute
   * work at all: on a cross-origin URL — and the API is always cross-origin
   * from the customer's page — browsers ignore `download` and navigate, which
   * is how this ends up back at a tab.
   *
   * The cost is that the file passes through memory. Uploads are capped at 10MB
   * (MAX_FILE_SIZE_BYTES), so this is bounded, and it is the same data the page
   * would have held anyway while downloading.
   *
   * credentials are deliberately omitted: the appId travels in the query string
   * (see attachmentDownloadUrl) and there is no cookie or session involved, so
   * asking for credentials would only invite a CORS preflight failure.
   */
  async confirmDownload(event: Event, a: QueryAttachment): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const href = this.openUrl(a);
    this.confirming = null;

    if (!href || this.downloading) return;

    this.downloading = a;

    let objectUrl = '';

    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = objectUrl;
      // The name the visitor uploaded, not the sanitised one in the path.
      link.download = a.name || 'file';

      // Never added to the document. A detached anchor still dispatches a click
      // the browser honours, and appending one to the customer's page — even
      // for a frame — is a mutation of their DOM we do not need to make.
      link.click();
    } catch {
      // The fetch failed: offline, an expired file, a CORS rejection. Falling
      // back to a tab is worth the flicker here, because the alternative is a
      // click that silently does nothing.
      try {
        window.open(href, '_blank', 'noopener,noreferrer');
      } catch {}
    } finally {
      this.downloading = null;

      // Released on the next frame rather than immediately: revoking before the
      // browser has started reading the blob cancels the download it was just
      // handed. A frame is enough, and leaving it unrevoked would hold the
      // whole file in memory for as long as the page lives.
      if (objectUrl) requestAnimationFrame(() => URL.revokeObjectURL(objectUrl));
    }
  }

  /** Prompt text, with the filename in it — "this file" is not an answer when
   *  a message carries four of them. */
  confirmText(a: QueryAttachment): string {
    const name = a.name || this.label(a.kind);
    const template = (this.t('attachOpenConfirm') || '').trim();

    return template
      ? template.replace('{name}', name)
      : `Open ${name}?`;
  }

  /**
   * The short word in the badge.
   *
   * The file's own extension when it has one, because "XLSX" tells the visitor
   * more than "File" — it is the thing they recognise from their own desktop.
   * Falls back to the translated kind, so a file with no extension still says
   * something in the visitor's language rather than showing an empty square.
   */
  badge(a: QueryAttachment): string {
    const ext = (a.name || '').split('.').pop() || '';

    // Guarded on length: "backup.20250908" would put a date in the badge, and
    // a name with no dot at all returns the whole filename here.
    if (ext && ext.length <= 4 && ext !== a.name) return ext.toUpperCase();

    return this.label(a.kind);
  }

  /**
   * The category, in the visitor's language.
   *
   * Shown beside the icon because a video icon and a sound icon are only
   * obvious once you already know which is which.
   */
  label(kind: AttachmentKind | undefined): string {
    switch (kind) {
      case 'image': return (this.t('attachKindImage') || '').trim() || 'Image';
      case 'video': return (this.t('attachKindVideo') || '').trim() || 'Video';
      case 'sound': return (this.t('attachKindSound') || '').trim() || 'Sound';
      default: return (this.t('attachKindFile') || '').trim() || 'File';
    }
  }

  /** Empty when the size is unknown — the template drops the separator too,
   *  rather than rendering a stray "·" after the name. */
  size(bytes: number | undefined): string {
    return typeof bytes === 'number' ? formatFileSize(bytes) : '';
  }

  /** Attachments carry no id, and two files with the same name are a real
   *  case, so index is the honest key here. */
  trackByIndex = (i: number) => i;
}
