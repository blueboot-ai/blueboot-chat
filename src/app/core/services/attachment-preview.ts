// Turning a picked file into something the feed can actually draw.
//
// The feed renders straight from QueryAttachment.content — a data URL made
// here, from the visitor's own bytes. Nothing is fetched: there is no server
// copy of an attachment any more (see describeUploadedFile in
// response-file-utils.ts), so the bytes in the browser are the only source
// there will ever be, and a picture that needs a network round-trip to appear
// would be a picture that never appears again after a reload.
//
// It is a *downscaled* copy, not the original. A phone photo is 4-6 MB, which
// becomes ~8 MB as base64 — past localStorage's whole quota for one image, so
// storing it would throw and take the conversation down with it. At 512px the
// same photo is 30-60 KB and looks identical at the size the bubble draws it.

/** Longest edge of the stored preview, in pixels. */
const MAX_EDGE = 512;

/** How much of a text file to keep. Enough to tell two exports apart. */
const MAX_PREVIEW_CHARS = 600;
const MAX_PREVIEW_LINES = 12;

/** Only ever read this much off disk — a log file can be enormous, and the
 *  snippet is short whatever the file is. Slicing the Blob first means the
 *  rest is never decoded. */
const READ_BYTES = 16 * 1024;

/**
 * The opening lines of a text file, for the feed to show.
 *
 * Undefined for anything that is not text — a PDF read as text is a page of
 * binary noise, which is worse than showing nothing.
 *
 * JSON is pretty-printed when it parses. A minified export is one enormous
 * line, so the raw first 600 characters would be a single unbroken string
 * telling the visitor nothing; indented, the same budget shows the top-level
 * shape, which is exactly what identifies the file.
 */
export async function makeTextPreview(file: File, mimeType: string): Promise<string | undefined> {
    if (mimeType !== 'text/plain') return undefined;

    try {
        const head = await file.slice(0, READ_BYTES).text();
        if (!head.trim()) return undefined;

        return clip(prettyIfJson(head, file.size));
    } catch {
        return undefined;
    }
}

/** Indented JSON when the whole file parsed, the raw text otherwise. */
function prettyIfJson(head: string, fileSize: number): string {
    // Only when the slice is the entire file. A truncated JSON document never
    // parses, and trying to repair one here would be guesswork.
    if (fileSize > READ_BYTES) return head;

    try {
        return JSON.stringify(JSON.parse(head), null, 2);
    } catch {
        return head;
    }
}

/** Both limits, whichever bites first. The ellipsis is the honest signal that
 *  there is more — without it a truncated file reads as a complete one. */
function clip(text: string): string {
    const lines = text.replace(/\r\n/g, '\n').split('\n').slice(0, MAX_PREVIEW_LINES);
    let out = lines.join('\n');

    if (out.length > MAX_PREVIEW_CHARS) out = out.slice(0, MAX_PREVIEW_CHARS);

    return out.length < text.length ? `${out.trimEnd()}\n…` : out;
}

/** WebP quality. High enough that a screenshot's text stays legible. */
const QUALITY = 0.82;

/**
 * A data URL to draw for this file, or undefined when there is nothing to see.
 *
 * Images and video only — a PDF has no visual the browser can produce without
 * a renderer, and a sound file has none at all. Those get the typed card in
 * the feed instead, which is the right answer rather than a fallback.
 *
 * Never rejects. A preview is decoration: a file that cannot be drawn must
 * still send, so every failure path returns undefined and the caller shows the
 * card.
 */
export async function makePreviewDataUrl(file: File, kind: string): Promise<string | undefined> {
    try {
        if (kind === 'image') return await previewFromImage(file);
        if (kind === 'video') return await previewFromVideo(file);
        return undefined;
    } catch {
        return undefined;
    }
}

/** Decode, shrink, re-encode. */
async function previewFromImage(file: File): Promise<string | undefined> {
    const url = URL.createObjectURL(file);

    try {
        const img = new Image();
        // Object URLs are same-origin, so the canvas stays untainted and
        // toDataURL() is allowed. A remote URL here would throw on export.
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('decode failed'));
            img.src = url;
        });

        return drawScaled(img, img.naturalWidth, img.naturalHeight);
    } finally {
        // Released whatever happened — this URL pins the whole file in memory,
        // and the data URL we return does not depend on it.
        URL.revokeObjectURL(url);
    }
}

/**
 * A poster frame, from a little way in.
 *
 * Seeking to 0 often lands on a black or blank first frame, which is a preview
 * that shows nothing. A fraction of a second in is almost always real picture.
 */
async function previewFromVideo(file: File): Promise<string | undefined> {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');

    try {
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';

        await new Promise<void>((resolve, reject) => {
            // A codec the browser cannot decode never fires seeked, and the
            // visitor would wait on a spinner forever. Give up and use the card.
            const timer = setTimeout(() => reject(new Error('video timeout')), 3000);

            video.onloadedmetadata = () => {
                video.currentTime = Math.min(0.2, (video.duration || 1) / 2);
            };
            video.onseeked = () => { clearTimeout(timer); resolve(); };
            video.onerror = () => { clearTimeout(timer); reject(new Error('video failed')); };
            video.src = url;
        });

        return drawScaled(video, video.videoWidth, video.videoHeight);
    } finally {
        URL.revokeObjectURL(url);
        video.src = '';
    }
}

/** Shared scale-and-encode for both sources. */
function drawScaled(
    source: CanvasImageSource,
    width: number,
    height: number
): string | undefined {
    if (!width || !height) return undefined;

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    // WebP first: roughly a third smaller than JPEG at this quality, and it
    // keeps transparency, so a logo with a clear background does not come back
    // on a black square. Browsers that cannot encode it silently hand back a
    // PNG data URL from toDataURL, which is why the result is tested rather
    // than trusted — PNG of a photo is large, so JPEG is the better fallback.
    const webp = canvas.toDataURL('image/webp', QUALITY);
    if (webp.startsWith('data:image/webp')) return webp;

    return canvas.toDataURL('image/jpeg', QUALITY);
}
