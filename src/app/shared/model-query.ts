// Copied from shared-library/src/models/model-query.ts so widget2 can build
// without depending on the shared-library module (see shared/README below).
// Only the pieces widget2 actually imports are here, plus what those pieces
// need internally. Left out (unused anywhere in widget2): QueryStat,
// QueryLogEntry, QueryLogCall, StreamState, ActionResult,
// ACCEPTED_MEDIA_MIME_TYPES, ACCEPTED_MIME_TYPES, ACCEPTED_DOCUMENT_EXTENSIONS,
// DOCUMENT_ACCEPT_ATTRIBUTE, isAcceptedDocumentType, correctOfficeMimeType,
// parseDataUrl, FILE_CACHE_ROOT, attachmentStoragePath.
//
// One change from the original: ChatInfo.messageDate is typed as
// `number | Date` here instead of shared-library's TimestampLike (which
// pulls in a Firestore Timestamp type). widget2 never reads or writes that
// field, so this keeps the shape without the extra dependency.

/** What kind of thing an attachment is. */
export type AttachmentKind = "file" | "image" | "video" | "sound";

// Only consulted when the MIME type tells us nothing.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "avi", "mkv", "m4v", "mpg", "mpeg", "wmv"]);
const SOUND_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "wma", "opus"]);

/** Which category a file falls into, from its MIME type and name. */
export function classifyAttachment(mimeType?: string, name?: string): AttachmentKind {
    const mime = (mimeType || "").toLowerCase();

    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "sound";

    if (!mime || mime === "application/octet-stream") {
        const ext = (name || "").split(".").pop()?.toLowerCase() || "";
        if (IMAGE_EXTENSIONS.has(ext)) return "image";
        if (VIDEO_EXTENSIONS.has(ext)) return "video";
        if (SOUND_EXTENSIONS.has(ext)) return "sound";
    }

    return "file";
}

/** File types an attachment may be — what OpenAI accepts (documents only). */
export const ACCEPTED_DOCUMENT_MIME_TYPES: readonly string[] = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // docx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         // xlsx
    "application/vnd.ms-excel",                                                  // xls
    "text/plain",
];

/** Extension → the document type it really is, when the browser told us nothing. */
const DOCUMENT_EXTENSION_TYPES: Record<string, string> = {
    pdf:  "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls:  "application/vnd.ms-excel",
    txt:  "text/plain",
    json: "text/plain",
    csv:  "text/plain",
    md:   "text/plain",
    log:  "text/plain",
    xml:  "text/plain",
};

/** Types that *are* text but are not spelled text/plain. */
const TEXT_ALIASES = new Set([
    "application/json",
    "application/ld+json",
    "application/x-ndjson",
    "application/xml",
    "application/csv",
]);

/** The type a file really is, when the browser will not say. */
export function resolveMimeType(mimeType?: string, name?: string): string {
    const mime = (mimeType || "").toLowerCase().trim();

    if (mime && mime !== "application/octet-stream") {
        if (mime.startsWith("text/") || TEXT_ALIASES.has(mime)) return "text/plain";
        return mime;
    }

    const ext = (name || "").split(".").pop()?.toLowerCase() || "";
    if (DOCUMENT_EXTENSION_TYPES[ext]) return DOCUMENT_EXTENSION_TYPES[ext];
    if (IMAGE_EXTENSIONS.has(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
    if (VIDEO_EXTENSIONS.has(ext)) return `video/${ext}`;
    if (SOUND_EXTENSIONS.has(ext)) return `audio/${ext}`;

    return mime;
}

/** Is this type acceptable at all? The outer boundary, before per-GPT narrowing. */
export function isAcceptedMimeType(mimeType?: string, name?: string): boolean {
    const mime = resolveMimeType(mimeType, name);
    if (!mime) return false;

    if (mime.startsWith("image/") || mime.startsWith("video/")) return true;

    return ACCEPTED_DOCUMENT_MIME_TYPES.includes(mime);
}

/** Is this file allowed by a configured list — the per-GPT narrowing? */
export function isMimeTypeAllowed(
    mimeType: string | undefined,
    name: string | undefined,
    allowed?: readonly string[]
): boolean {
    const mime = resolveMimeType(mimeType, name);
    if (!mime) return false;

    if (!allowed?.length) return isAcceptedMimeType(mime, name);

    const list = allowed.map(a => a.toLowerCase().trim());
    if (list.includes(mime)) return true;

    const top = mime.split("/")[0];
    if (list.includes(`${top}/*`)) return true;

    if (top === "image" || top === "video") {
        return list.some(a => a.startsWith(`${top}/`));
    }

    return false;
}

/** The route serving stored attachments back. */
export const DOC_API_PREFIX = "/api/doc";

/** A filename safe to use as both a path segment and a URL segment. */
export function safeFileName(name?: string): string {
    const base = String(name || "").split(/[\\/]/).pop() || "file";

    return base
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[.-]+/, "")
        .slice(0, 120) || "file";
}

/** The API path for a stored file: /api/doc/<conversationId>/<filename>. */
export function attachmentApiPath(conversationId: string, fileName?: string): string {
    return `${DOC_API_PREFIX}/${encodeURIComponent(safeFileName(conversationId))}` +
        `/${encodeURIComponent(safeFileName(fileName))}`;
}

/** The full address, for a caller that knows the service's base URL. */
export function attachmentDownloadUrl(
    baseUrl: string,
    conversationId: string,
    fileName?: string,
    appId?: string,
): string {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    const url = `${base}${attachmentApiPath(conversationId, fileName)}`;

    return appId ? `${url}?appid=${encodeURIComponent(appId)}` : url;
}

export interface QueryAttachment {
    kind: AttachmentKind;
    mimeType: string;
    name?: string;
    content?: string;
    docUrl?: string;
    storagePath?: string;
    modelSeen?: boolean;
    link?: string;
    downloadUrl?: string;
    previewUrl?: string;
    size?: number;
    previewText?: string;
}

/** "model" = our AI. "chat" = a human agent on the external chat system. */
export type MsgMode = "model" | "chat";

export interface QueryMessage {
    role: "user" | "assistant" | "system";
    content: string;

    sendMode?: MsgMode;
    recvMode?: MsgMode;
    authorName?: string;

    attachments?: QueryAttachment[];

    assistantMessageKey?: string;
    feedbackStatus?: "positive" | "neutral" | "negative";
    feedbackComment?: string;
    feedbackUpdatedAt?: number;

    chatInfo?: ChatInfo;

    /** Set from the matching RetEvent.timestamp when a reply arrives. */
    timestamp?: number;
}

/** Who sent a turn, when, and which chat it belongs to. */
export interface ChatInfo {
    name?: string;
    /** Simplified from shared-library's TimestampLike — see file header. */
    messageDate?: number | Date;
    chatId?: string;
    visitorName?: string;
    contactInfo?: string;
    contactAsked?: boolean;
    recvMode?: MsgMode;
    activePassive?: boolean;
    status?: "open" | "closed";
}

export interface RetEvent {
    type?: string;
    info?: string;
    time?: number;
    delta?: string;
    urls?: string[];
    text?: string;
    image?: string;
    chatInfo?: ChatInfo;
    timestamp?: number;
    recvMode?: MsgMode;

    contactRequest?: {
        fields: Array<{ key: "name" | "info"; label: string; required?: boolean }>;
        skippable?: boolean;
        reason?: string;
    };

    status?: { stage: "connecting" | "opening" | "waiting" };

    handoff?: boolean;

    attachments?: QueryAttachment[];
}

export type ChatRole = "user" | "assistant";

/** A single conversation turn — superseded by QueryMessage, kept for the one
 *  legacy shape (a bare array) InputBody.input can still carry. */
export class HistoryMessage {
    role!: string;
    content!: string;

    sendMode?: MsgMode;
    recvMode?: MsgMode;
    authorName?: string;

    assistantMessageKey?: string;
    feedbackStatus?: "positive" | "neutral" | "negative";
    feedbackComment?: string;
    feedbackUpdatedAt?: number;

    chatInfo?: ChatInfo;
    timestamp?: number;
}

/** Request body shape for the public-service response handlers. */
export interface InputBody {
    input?: string | QueryMessage | HistoryMessage[];
    assistantMessageKey?: string;
    requestId?: string;
    stream?: boolean;
    channel?: string;
    mode?: string;
    dept?: string;
    inputText?: string;
    history?: QueryMessage[];
    chatInfo?: ChatInfo;
    lang?: string;
}
