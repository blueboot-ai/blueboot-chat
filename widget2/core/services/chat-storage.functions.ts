// src/app/widget2/core/services/chat-storage.functions.ts
//
// Was ChatStorageService (@Injectable providedIn:'root'). It held no state
// beyond three constants and injected nothing — every method operates on the
// localStorage global. The constants are module-level now, and
// the former `private` helpers are genuinely module-private (not exported)
// rather than private-by-TypeScript-only.

import { Message, StoredHistory } from '../models/chat-message.model';
import { ChatInfo, MsgMode, attachmentDownloadUrl } from '../../shared/model-query';

/**
 * The conversation itself has no expiry.
 *
 * It used to be dropped after ten idle minutes, which is what made closing the
 * widget and coming back start from nothing — and in chat mode it also threw
 * away the chatId, so a human agent's reply had nowhere to land. A conversation
 * ends when the visitor ends it (newConversation(), which wipes these keys
 * outright), not when a timer runs out.
 *
 * The short-lived cache is the visitor themselves — their details and where
 * they put the panel — see VISITOR_CACHE_TTL_MS.
 */
const STORAGE_PREFIX = 'blueboot:';
const OPEN_KEY_SUFFIX = ':open';
const CLEARED_MARKER_PREFIX = 'bb:cleared:v3:';

// ============================================================
// Key builders
//
// These live here, beside the constants, because the eviction scan in
// saveHistory() finds conversations by STORAGE_PREFIX and skips
// OPEN_KEY_SUFFIX. When the key format was built by hand in the component,
// the writer and the scanner agreed only by coincidence — change one and
// eviction silently stops finding entries, which surfaces only as a quota
// error under storage pressure. One file now owns the format.
// ============================================================

/**
 * The identity a storage key is scoped to.
 *
 * Deliberately NOT scoped by user. localStorage is already partitioned per
 * browser profile and per origin, so a user segment separates nothing that can
 * actually coexist — it only adds cardinality, and it changed spelling
 * ('anon' / 'guest' / a real id) as the host page's auth state moved, which
 * orphaned history: an anonymous visitor who logged in lost the conversation
 * they were in the middle of.
 *
 * The userId parameter that segment came from no longer exists at all — see the
 * note in chat-core.component.ts. What separates two widgets on one page is
 * assistantId below, which is about the installation rather than the person.
 */
export type StorageScope = {
  appId?: string;
  gptId?: string;

  /**
   * Which installation of the widget this is, when a page has more than one.
   *
   * Two embeds of the same app and gpt on one site are otherwise the same
   * conversation: same history key, same open flag, same visitor cache, so
   * typing in one appears in the other and clearing one clears both. A support
   * widget in the footer and a sales widget on the pricing page are not the
   * same conversation, and this is what says so.
   *
   * Optional, and absent means "the only one" — a site with a single widget
   * keeps the keys it already has, so upgrading does not orphan anyone's
   * history.
   */
  assistantId?: string;
};

/**
 * The key segments for a scope.
 *
 * `asst` is a suffix rather than another colon-delimited segment, and the
 * separator is deliberately '@'. Storage keys used to carry a user segment in
 * exactly that position — `blueboot:<app>:<gpt>:<usr>` — and
 * clearScopedHistories() still sweeps `blueboot:<app>:<gpt>:` to clean those
 * up. With a colon here, a widget that has no assistantId would sweep away the
 * histories of every widget that does. '@' is outside that pattern, so the two
 * cannot be confused for each other.
 */
function scopeParts(scope: StorageScope): { app: string; gpt: string; asst: string } {
  const asst = (scope.assistantId || '').trim();

  return {
    app: scope.appId ?? 'app',
    gpt: scope.gptId && scope.gptId.trim() ? scope.gptId.trim() : 'default',
    asst: asst ? `@${asst}` : '',
  };
}

/** `blueboot:<app>:<gpt>[@<assistant>]` — the conversation history entry. */
export function buildHistoryKey(scope: StorageScope): string {
  const { app, gpt, asst } = scopeParts(scope);
  return `${STORAGE_PREFIX}${app}:${gpt}${asst}`;
}

// buildSessionFallbackKey() was here, naming the sessionStorage twin of a
// history entry. The widget no longer writes one — see loadBestHistory().

/** `blueboot:<app>:<gpt>:<usr>:open` — the panel's open/closed flag. */
export function buildOpenKey(scope: StorageScope): string {
  return `${buildHistoryKey(scope)}${OPEN_KEY_SUFFIX}`;
}

/** `bb:cleared:v3:<app>:<gpt>` — deliberately outside STORAGE_PREFIX so the
 *  eviction scan never treats the marker as a conversation. */
/**
 * Whether the embed's overlay was left open.
 *
 * Deliberately NOT buildOpenKey(): that one is the chat panel's, and a site
 * running both the launcher and the embed for the same app would otherwise have
 * them writing each other's state. Same scope, separate meaning, separate key.
 */
export function buildEmbedOverlayKey(scope: StorageScope): string {
  const { asst } = scopeParts(scope);
  return `blueboot:embed-open:${scope.appId || ''}:${scope.gptId || ''}${asst}`;
}

/**
 * `bb:launcher-frame:<app>:<gpt>[@<assistant>]` — a small cached still of the
 * launcher video's first frame, saved the last time it was fully downloaded
 * and decoded on this browser.
 *
 * The launcher video has to be fetched in full before any of it can play
 * (see LauncherComponent.downloadLauncherVideo()'s comment on why), which on
 * a fresh load can take a few seconds. This cache lets a later visit — most
 * commonly a page refresh during development, or a returning visitor — show
 * a real frame from that visitor's own video immediately, instead of the
 * generic default mark, while the actual video re-downloads behind it.
 *
 * Deliberately outside STORAGE_PREFIX, same reasoning as
 * buildEmbedOverlayKey(): this is not a conversation and must never be
 * picked up by the history eviction scan. It still carries the assistant
 * suffix so clearStoredWidgetDataForAssistant() finds and removes it along
 * with everything else that installation owns.
 */
export function buildLauncherVideoFramePreviewKey(scope: StorageScope): string {
  const { app, gpt, asst } = scopeParts(scope);
  return `bb:launcher-frame:${app}:${gpt}${asst}`;
}

export function buildClearedMarkerKey(scope: StorageScope): string {
  const { app, gpt, asst } = scopeParts(scope);
  return `${CLEARED_MARKER_PREFIX}${app}:${gpt}${asst}`;
}

// ── The visitor cache: their details, and where they put the panel ──────────

/**
 * `bb:contact:<app>:<gpt>` — everything remembered about the current visitor.
 *
 * The name is historical: this held only the contact details when it was
 * written, and it now also carries the panel's placement. Kept as-is rather
 * than renamed so that installs upgrading to this build keep reading the entry
 * they already have — a rename would silently orphan it and re-ask everyone
 * mid-visit. The shape is versioned by its own fields: an entry with no
 * `contact` key is the old flat one and is lifted into the new shape on read,
 * in loadVisitorCache().
 *
 * Outside STORAGE_PREFIX on purpose, for the same reason as the cleared
 * marker: the eviction scan walks that prefix looking for conversations, and
 * this is not one. It also means clearing the conversation does not silently
 * forget the person — those are different things, and "start a new chat"
 * should not mean "type your phone number again".
 */
export function buildContactKey(scope: StorageScope): string {
  const { app, gpt, asst } = scopeParts(scope);
  return `bb:contact:${app}:${gpt}${asst}`;
}

export type StoredContact = { name?: string; info?: string };

/**
 * Where the visitor put the floating panel, in viewport coordinates.
 *
 * Structurally the same as EmbedWindowBox in embed-window.functions.ts, and
 * deliberately re-declared rather than imported: this module is the core's
 * storage layer and the embed is one of its callers, so importing upward would
 * make the panel widget depend on a type that only the embed uses. The shape is
 * four numbers and is validated on read either way.
 */
export type StoredWindowBox = { x: number; y: number; w: number; h: number };

/**
 * One cache entry per app+gpt holding everything about *this visitor's current
 * visit*: who they said they are, and where they put the panel.
 *
 * One object rather than two keys because they share a lifetime. Both are
 * conveniences for the person who is here now — neither is worth keeping, and
 * both are mildly wrong to keep, once that visit is over. Two entries with two
 * clocks meant a panel could come back placed exactly where a different person
 * left it while their name had already expired, which is the confusing half of
 * both behaviours at once.
 *
 * The conversation history is deliberately NOT in here: it has no expiry (see
 * the note at the top of this file) and it is the one thing a returning visitor
 * does want back.
 */
/**
 * How big the visitor dragged the launcher's chat panel, in CSS pixels.
 *
 * Only a size, where the embed's box is a size and a position: the panel is
 * anchored to the launcher button, so where it sits is never the visitor's to
 * choose. Dragging its top-left corner changes how big it is and nothing else.
 */
export type StoredPanelSize = { w: number; h: number };

type StoredVisitorCache = {
  contact?: StoredContact;
  box?: StoredWindowBox;
  /**
   * The chat panel's size. Deliberately NOT reusing `box` above: that one is
   * the embed's, and a site running both the launcher and the embed for the
   * same app would otherwise have them overwriting each other — the same
   * reasoning that gives the embed its own overlay key.
   */
  panel?: StoredPanelSize;
  // `lang` and `langChosen` were here. The visitor's language is not a fact
  // about this visit any more: it lives in LANG_STORAGE_KEY, shared with every
  // other surface — see the note in the Language section below. Entries written
  // by an earlier build may still carry both keys and, because saveVisitorCache
  // merges over whatever it read, will keep carrying them. They are inert: no
  // code path reads either one, and the entry expires on its own clock.
  /** When the entry was last written. Absent means "written by a build that
   *  had no clock", which is treated as expired — there is no evidence. */
  storedAt?: number;
};

/**
 * How long the visitor cache stays usable.
 *
 * Raised from ten minutes to twenty-four hours, at the site owner's request.
 * The tradeoff moved with it and is worth stating plainly: ten minutes meant
 * the form came back for anyone returning later the same day; a day means a
 * name and phone number typed on a shared or public machine are still there
 * tomorrow morning. Expiry is still the safe failure — nothing is lost when it
 * lapses, the visitor just types again — but the window in which those details
 * can be served to somebody else is now considerably wider.
 *
 * One clock for the whole object, so *any* write refreshes it: a visitor who
 * drags the panel has demonstrated they are still here, which is the same
 * evidence re-confirming their details would give.
 */
const VISITOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * TEMPORARY — testing switch. With this on, remembered contact details are
 * ignored and wiped on read, so every chat starts as an unknown visitor.
 *
 * Needed because the two caches suppress the form for different reasons, and
 * only one of them is the app config: seedContactFromMemory() sends whatever
 * is remembered, the backend then sees a visitor it already knows, and
 * correctly decides not to ask. Clearing the config cache does nothing about
 * that. Set to false to go back to remembering people.
 */
const DEV_BYPASS_CONTACT_CACHE = false;

/**
 * Read the remembered details, or undefined if there are none.
 *
 * Never throws: storage can be unavailable (private browsing, blocked cookies,
 * a locked-down embed) and can hold whatever a previous version wrote. A
 * convenience that fails must degrade to an empty form, not a broken widget.
 */
/** Where the combined entry lives. One key for the whole object. */
function visitorCacheKey(scope: StorageScope, storageKey?: string): string {
  return storageKey ? `${storageKey}:visitor` : buildContactKey(scope);
}

/**
 * Read the whole cache entry, or undefined when there is nothing usable.
 *
 * The expiry check lives here, once, so every field in the object shares it —
 * there is no path that reads the box while skipping the clock.
 *
 * Never throws: storage can be unavailable (private browsing, blocked cookies,
 * a locked-down embed) and can hold whatever a previous version wrote. A
 * convenience that fails must degrade to an empty form and an unplaced panel,
 * not a broken widget.
 */
function loadVisitorCache(scope: StorageScope, storageKey?: string): StoredVisitorCache | undefined {
  try {
    const raw = localStorage.getItem(visitorCacheKey(scope, storageKey));
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as StoredVisitorCache;

    // Expired, or written before this carried a timestamp at all — either way
    // there is no evidence this is still the current visitor.
    // Removed rather than merely ignored, so the next read is a plain miss.
    const storedAt = Number(parsed?.storedAt || 0);
    if (!storedAt || (Date.now() - storedAt) >= VISITOR_CACHE_TTL_MS) {
      clearVisitorCache(scope, storageKey);
      return undefined;
    }

    if (!parsed || typeof parsed !== 'object') return undefined;

    // Migration from the flat shape this key used to hold: `{ name, info,
    // storedAt }`, with no `contact` wrapper and no `box`. Without this every
    // visitor who already had details saved silently lost them on upgrade —
    // the read found no `contact` field, returned nothing, and the form came
    // back empty as if they had never filled it in.
    //
    // Lifted rather than rewritten in place: the next saveContact() persists
    // the new shape anyway, and a write here would mean a read function with a
    // side effect on storage.
    const legacy = parsed as StoredVisitorCache & StoredContact;
    if (!legacy.contact && (typeof legacy.name === 'string' || typeof legacy.info === 'string')) {
      return {
        ...parsed,
        contact: {
          ...(typeof legacy.name === 'string' ? { name: legacy.name } : {}),
          ...(typeof legacy.info === 'string' ? { info: legacy.info } : {}),
        },
      };
    }

    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Merge a patch into the entry and restart the clock.
 *
 * Merged at the top level, so writing a box cannot drop the contact and vice
 * versa. Reading first through loadVisitorCache() means an expired entry is not
 * resurrected by a partial write — it is gone, and this begins a fresh one.
 */
function saveVisitorCache(
  scope: StorageScope,
  patch: Partial<StoredVisitorCache>,
  storageKey?: string,
): void {
  try {
    const next: StoredVisitorCache = {
      ...(loadVisitorCache(scope, storageKey) ?? {}),
      ...patch,
      storedAt: Date.now(),
    };
    localStorage.setItem(visitorCacheKey(scope, storageKey), JSON.stringify(next));
  } catch {
    // Full, disabled, or otherwise unavailable. Everything in here is a
    // convenience; the conversation itself is unaffected.
  }
}

/** Drop the whole entry — both the details and the placement. */
function clearVisitorCache(scope: StorageScope, storageKey?: string): void {
  try {
    localStorage.removeItem(visitorCacheKey(scope, storageKey));
  } catch {}
}

export function loadContact(scope: StorageScope, storageKey?: string): StoredContact | undefined {
  if (DEV_BYPASS_CONTACT_CACHE) {
    // Wiped, not just ignored — otherwise the entry is still there to be
    // served the moment the flag goes back off.
    clearContact(scope, storageKey);
    return undefined;
  }

  const contact = loadVisitorCache(scope, storageKey)?.contact;
  if (!contact) return undefined;

  const name = typeof contact.name === 'string' ? contact.name : undefined;
  const info = typeof contact.info === 'string' ? contact.info : undefined;

  return name || info ? { ...(name ? { name } : {}), ...(info ? { info } : {}) } : undefined;
}

/**
 * Remember what the visitor just shared, merged over whatever was there.
 *
 * Merged, not replaced: a form that only captured a phone number must not wipe
 * a name given earlier. Writing nothing at all when the visitor shared nothing
 * is deliberate too — declining to give details is not an instruction to
 * forget the details they gave a moment ago.
 *
 * Each write restarts the clock (see VISITOR_CACHE_TTL_MS): the visitor
 * confirming their details is exactly the evidence the timestamp records.
 */
export function saveContact(scope: StorageScope, contact: StoredContact, storageKey?: string): void {
  const name = contact.name?.trim();
  const info = contact.info?.trim();
  if (!name && !info) return;

  saveVisitorCache(
    scope,
    {
      contact: {
        ...(loadContact(scope, storageKey) ?? {}),
        ...(name ? { name } : {}),
        ...(info ? { info } : {}),
      },
    },
    storageKey,
  );
}

/**
 * Forget the remembered details. Wired to the same places that wipe history
 * for good — see clearAllHistoriesForAppGpt() callers.
 *
 * Clears the field, not the entry: "forget who I am" and "forget where I put
 * the window" are different requests, and the paths that call this mean only
 * the first. The placement expires on its own clock like everything else here.
 */
export function clearContact(scope: StorageScope, storageKey?: string): void {
  const cached = loadVisitorCache(scope, storageKey);
  if (!cached) return;

  if (cached.box) saveVisitorCache(scope, { contact: undefined }, storageKey);
  else clearVisitorCache(scope, storageKey);
}

// ── Panel placement ─────────────────────────────────────────────────────────

/**
 * Where the visitor last put the floating panel, if that is still current.
 *
 * Every field is re-validated rather than trusted: this is localStorage on a
 * page we do not control, and a NaN reaching the style binding produces a panel
 * with no position at all.
 */
export function loadWindowBox(scope: StorageScope, storageKey?: string): StoredWindowBox | undefined {
  const box = loadVisitorCache(scope, storageKey)?.box;
  if (!box) return undefined;

  const nums = [box.x, box.y, box.w, box.h];
  if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) return undefined;

  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Remember the placement. Passing undefined forgets it without touching the
 *  visitor's details — the mirror of clearContact(). */
export function saveWindowBox(
  scope: StorageScope,
  box: StoredWindowBox | null | undefined,
  storageKey?: string,
): void {
  saveVisitorCache(scope, { box: box ?? undefined }, storageKey);
}

/**
 * The size the visitor last gave the chat panel, if that is still current.
 *
 * Same contract as loadWindowBox() above and validated the same way: a NaN
 * reaching a CSS custom property produces a panel with no width at all, and
 * this is localStorage on a page we do not control. Non-positive values are
 * rejected too — a zero here would render the panel invisible, which reads as
 * the widget being broken rather than as a bad stored value.
 */
export function loadPanelSize(scope: StorageScope, storageKey?: string): StoredPanelSize | undefined {
  const panel = loadVisitorCache(scope, storageKey)?.panel;
  if (!panel) return undefined;

  const { w, h } = panel;
  const ok = (n: any) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!ok(w) || !ok(h)) return undefined;

  return { w, h };
}

/** Remember the panel's size. Passing undefined puts it back to the app's
 *  configured default without touching anything else in the entry. */
export function savePanelSize(
  scope: StorageScope,
  size: StoredPanelSize | null | undefined,
  storageKey?: string,
): void {
  saveVisitorCache(scope, { panel: size ?? undefined }, storageKey);
}

// ── Language ────────────────────────────────────────────────────────────────
//
// loadVisitorLang(), saveVisitorLang() and hasChosenLang() were here, keeping
// the visitor's language in this cache beside their details and on its 24-hour
// clock. The language now lives in one key for every surface — see
// LANG_STORAGE_KEY / readStoredLang() / writeStoredLang() in
// shared-library/models/lang-detect.ts. Two stores for one question meant the
// widget and the page around it could disagree, and the widget's copy expired
// while the page's did not.

/**
 * Wipes the stored trace of *this* installation: its history entry and its open
 * flag. Two exact keys, nothing swept.
 *
 * It used to also clear `blueboot:<app>:<gpt>:*` by prefix, as a migration for
 * keys that once carried a user segment (`blueboot:<app>:<gpt>:<usr>`). That is
 * gone: with more than one widget on a page the prefix is no longer unambiguous
 * enough to delete by. Clearing the support chat must not reach into the sales
 * chat beside it, and a sweep is one careless key format away from doing
 * exactly that — the '@' separator on the assistant id keeps them apart today,
 * but relying on a punctuation choice to bound a delete is not a property worth
 * depending on.
 *
 * The migration it performed is not worth that risk. Those rows are inert:
 * nothing reads them, they only occupy quota, and the eviction path in
 * saveHistory() already reclaims stale conversations when space runs short. A
 * browser that never runs low simply carries a few forgotten keys.
 */
export function clearScopedHistories(scope: StorageScope): void {
  const historyKey = buildHistoryKey(scope);

  removeLocalKey(historyKey);
  removeLocalKey(buildOpenKey(scope));
}

/**
 * Everything this browser holds for **one installation of the widget**, across
 * every app and gpt it has been pointed at.
 *
 * Scoped by assistantId, and that is the whole safety property. Every key this
 * module writes carries `@<assistantId>` (see scopeParts) — history, open flag,
 * embed overlay flag, cleared marker, remembered contact, panel placement — so
 * matching on that segment reaches one widget's data and nothing else's.
 *
 * It exists because one installation, ours, is pointed at a succession of
 * different apps: the console's test embed. Everywhere else appId is fixed for
 * the life of the page, and the leftovers this clears would be a live
 * conversation rather than an admin's previous test.
 *
 * Sweeping by *app* was tried first and was wrong in a way worth recording.
 * localStorage is per-origin, so a customer's site was never at risk — but our
 * own site is the same origin as the console, and the BB Assistant in the
 * header is a normal installation living there. Clearing every app wiped an
 * admin's own conversation with it every time they switched apps in the
 * console. Scoping by assistant is what separates our test widget from every
 * other widget on our own domain.
 *
 * Refuses an empty id rather than falling back to "everything": that fallback
 * is exactly the bug above, and a caller that cannot say which installation it
 * means has no business clearing one.
 */
export function clearStoredWidgetDataForAssistant(assistantId: string): void {
  const asst = (assistantId || '').trim();
  if (!asst) return;

  // The segment as it appears in a key. '@' is not part of any app or gpt id,
  // so this cannot collide with one — see the note on scopeParts().
  const marker = `@${asst}`;

  try {
    const doomed: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);

      // endsWith would miss the open flag and the other suffixed keys;
      // includes() catches every key this module builds for that assistant.
      if (k && k.includes(marker)) doomed.push(k);
    }

    doomed.forEach(k => removeLocalKey(k));
  } catch {
    // No storage, nothing to clear. Never worth failing a navigation over.
  }
}

/**
 * What the widget needs to address a stored file: the API it uploaded to, and
 * the app it is.
 */
export type DocUrlContext = { appId?: string; baseUrl?: string };

/**
 * The largest `content` that may reach storage without a docUrl behind it.
 *
 * A backstop, not a policy. The normal path removes the bytes entirely once the
 * file is stored; this exists for the paths where that could not happen — no
 * baseUrl configured, an attachment with no filename, a send that never
 * completed — because those are exactly the cases where nobody notices until a
 * visitor's localStorage is full.
 *
 * The number matters less than the fact of it: a base64 data URL is ~1.37x the
 * file, browsers give an origin about 5MB, and a single 4MB PDF is therefore
 * already over budget on its own. 48KB is enough for a small thumbnail and far
 * too little to be a document.
 *
 * What is lost when it bites is a preview, not a file — the bytes were only
 * ever a local copy for drawing. What is avoided is saveHistory() failing its
 * quota and evicting other conversations to make room.
 */
const MAX_STORED_CONTENT_CHARS = 48 * 1024;

/**
 * Swap each attachment's bytes for the address of the stored copy.
 *
 * Two things at once, and they have to happen together: the base64 `content` is
 * removed, and `docUrl` is written. Removing the bytes is the point — a couple
 * of PDFs is several megabytes of base64 in a ~5MB localStorage quota, which is
 * why saveHistory() below has an eviction path that throws away *other*
 * conversations to make room. Writing the address first is what makes that
 * safe: the file is still reachable, just not carried.
 *
 * The URL is constructed, not received. The upload response does not echo the
 * descriptors, and it does not need to: the backend derives the path from the
 * conversation id and the filename using attachmentStoragePath(), and this
 * builds the matching address from the same shared functions. That agreement is
 * the whole reason those functions live in shared-library rather than being
 * written twice.
 *
 * The honest cost: this assumes the upload stored the file. The backend refuses
 * the turn outright when it cannot (see storeAttachments), so a conversation
 * that got a reply has its files; a link that 404s means something went wrong
 * after that, and the download route answers with a reason rather than a bare
 * 404.
 *
 * Nothing large reaches storage on any path. With an address the bytes go
 * because they are redundant; without one they go because they do not fit. See
 * MAX_STORED_CONTENT_CHARS.
 */
function toStoredAttachments(
  messages: Message[],
  conversationId: string | undefined,
  ctx?: DocUrlContext
): Message[] {
  if (!conversationId) return messages;

  return messages.map(m => {
    if (!m.attachments?.length) return m;

    return {
      ...m,
      attachments: m.attachments.map(a => {
        // Nothing to swap. An attachment with no bytes has either been through
        // here already or never had them.
        if (!a.content) return a;

        const docUrl = a.docUrl
          || (a.name && ctx?.baseUrl
            ? attachmentDownloadUrl(ctx.baseUrl, conversationId, a.name, ctx.appId)
            : '');

        const { content, ...rest } = a;

        // The ordinary case: the file is reachable, so the local copy is
        // redundant and goes.
        if (docUrl) return { ...rest, docUrl };

        // No address could be built — no baseUrl, or an attachment with no
        // name. Small previews are kept, because they are the only copy and
        // they cost little. Anything large is dropped anyway: this is the path
        // that has no upper bound, and one document here fills the quota and
        // makes saveHistory() start evicting other conversations.
        if (content.length <= MAX_STORED_CONTENT_CHARS) return a;

        console.warn(
          `[chat-storage] dropping ${content.length} bytes of attachment content with no docUrl` +
          ` (${a.name || 'unnamed'}) — it would not fit in storage`,
        );

        return rest;
      }),
    };
  });
}

/**
 * Write `docUrl` onto the messages the widget is actually showing.
 *
 * Separate from toStoredAttachments() above, and it has to be: that one
 * produces the copy destined for localStorage, so anything it derives is
 * invisible to the running conversation. The address was therefore only ever
 * observable after a reload — the feed could not link to a file the visitor had
 * just uploaded, and the debug line under an attachment stayed blank for the
 * whole session that created it.
 *
 * This adds the address and keeps the bytes; the storage pass strips them a
 * moment later. That ordering is deliberate — the live message shows the
 * instant local preview *and* knows where the stored copy is, and only the
 * persisted copy pays the size.
 *
 * Returns the identical array when nothing changed, so a caller can compare by
 * reference and avoid writing back to a signal on every save. Every save would
 * otherwise be a model update, and this is called from a dozen places.
 */
export function withDocUrls(
  messages: Message[],
  conversationId: string | undefined,
  ctx?: DocUrlContext
): Message[] {
  if (!conversationId || !ctx?.baseUrl) return messages;

  let changed = false;

  const next = messages.map(m => {
    if (!m.attachments?.length) return m;

    let touched = false;

    const attachments = m.attachments.map(a => {
      // Already addressed, or nothing to address it by — a file with no name
      // cannot be located.
      //
      // Deliberately NOT conditional on `content`. That was the first attempt
      // and it was wrong: `content` is a *preview*, produced only for images
      // and text files, so every PDF and spreadsheet — the ones a link matters
      // most for — was silently skipped and never got an address at all.
      //
      // What is being asserted here is only "this file was attached to this
      // conversation under this name", which is exactly what the backend
      // derives its storage path from. Whether the upload succeeded is a
      // separate question, and the answer to it is a 404 from the download
      // route rather than a missing link.
      if (a.docUrl || !a.name) return a;

      touched = true;
      return {
        ...a,
        docUrl: attachmentDownloadUrl(ctx.baseUrl!, conversationId, a.name, ctx.appId),
      };
    });

    if (!touched) return m;

    changed = true;
    return { ...m, attachments };
  });

  return changed ? next : messages;
}

export function buildStoredHistory(
  conversationId: string | undefined,
  messages: Message[],
  inputHistory: string[],
  chatInfo?: ChatInfo,
  chatMode?: MsgMode,
  docCtx?: DocUrlContext
): StoredHistory {
  return {
    storeTime: Date.now(),
    conversationId,
    messages: toStoredAttachments(messages, conversationId, docCtx),
    inputHistory,
    ...(chatInfo ? { chatInfo } : {}),
    ...(chatMode ? { chatMode } : {}),
  };
}

function readStoredHistory(storage: Storage, key: string): StoredHistory | undefined {
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;

    const data = JSON.parse(raw) as StoredHistory;
    const storeTime = Number(data?.storeTime || 0);

    // storeTime is still required — an entry without one was written by
    // something that isn't this, or is truncated. It just no longer expires.
    if (!storeTime) return undefined;

    return data;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

/**
 * The stored conversation, or undefined.
 *
 * One source. There used to be a sessionStorage copy alongside this one, and
 * this function picked whichever had the newer storeTime. The fallback did not
 * do what it claimed: it was there in case localStorage was unavailable, but
 * the conditions that make localStorage throw — blocked site data, a
 * locked-down embed, a browser refusing storage — are the same Storage API
 * behind the same permission gate, and take sessionStorage with them. The one
 * case it really covered was a full localStorage with room left in the session
 * quota, which is now handled properly: attachment bytes are stripped once the
 * file is stored, and saveHistory() evicts stale conversations under pressure.
 *
 * What it cost was a second write of every conversation on every save, and a
 * tie-break between two copies that could disagree — a tie-break that only
 * existed because there were two.
 */
export function loadBestHistory(localKey: string): StoredHistory | undefined {
  return readStoredHistory(localStorage, localKey);
}

/**
 * Write the conversation, escalating on quota errors: drop unreadable entries,
 * then evict other conversations oldest-first until the write fits.
 *
 * Eviction is the only thing that removes a conversation the visitor did not
 * end themselves, and it only ever runs under real quota pressure — which is
 * the point: storage filling up is a reason to let go of the oldest chat, the
 * clock passing is not.
 */
export function saveHistory(
  localKey: string,
  payload: StoredHistory
): void {
  const raw = JSON.stringify(payload);

  const tryWriteLocal = (): boolean => {
    try {
      localStorage.setItem(localKey, raw);
      return true;
    } catch (error) {
      if (!isQuotaError(error)) console.error(error);
      return false;
    }
  };

  if (tryWriteLocal()) return;

  try {
    cleanupUnreadableStoredHistories();
  } catch (error) {
    console.error(error);
  }

  if (tryWriteLocal()) return;

  try {
    const candidates: Array<{ key: string; storeTime: number }> = [];

    for (const key of listStoredHistoryKeys()) {
      if (key === localKey) continue;

      const rawItem = localStorage.getItem(key);

      if (!rawItem) {
        try {
          localStorage.removeItem(key);
        } catch {}
        continue;
      }

      try {
        const data = JSON.parse(rawItem) as StoredHistory;
        candidates.push({
          key,
          storeTime: Number(data?.storeTime || 0),
        });
      } catch {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
    }

    candidates.sort((a, b) => a.storeTime - b.storeTime);

    for (const item of candidates) {
      try {
        localStorage.removeItem(item.key);
      } catch {}

      if (tryWriteLocal()) return;
    }
  } catch (error) {
    console.error(error);
  }
}

export function removeLocalKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

// removeSessionKey() was here. Nothing in the widget writes to sessionStorage
// any more, so nothing needs to remove from it.

// clearAllHistoriesByPrefix() was here. Its only caller was
// clearScopedHistories(), which now removes the three keys it owns by name.
//
// Not kept "in case it is useful": a delete-by-prefix helper sitting in this
// file is an invitation to clear a scope with one, and the whole point of the
// change is that a widget's storage prefix is no longer specific enough to
// delete by — another installation's keys live under it.

// ============================================================
// Module-private
// ============================================================

function isQuotaError(err: unknown): boolean {
  const e = err as any;

  return !!e && (
    (e instanceof DOMException && (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )) ||
    e?.code === 22 ||
    e?.code === 1014
  );
}

function listStoredHistoryKeys(): string[] {
  const keys: string[] = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      if (key.endsWith(OPEN_KEY_SUFFIX)) continue;
      keys.push(key);
    }
  } catch (error) {
    console.error(error);
  }

  return keys;
}

/**
 * Reclaims only what could never be restored anyway: empty rows and rows that
 * do not parse, plus the ones readStoredHistory() would reject for having no
 * storeTime. It deliberately deletes nothing merely for being old — age is the
 * eviction loop's business, and only when the quota actually says so.
 */
function cleanupUnreadableStoredHistories(): void {
  try {
    for (const key of listStoredHistoryKeys()) {
      const raw = localStorage.getItem(key);

      if (!raw) {
        localStorage.removeItem(key);
        continue;
      }

      try {
        const data = JSON.parse(raw) as StoredHistory;
        if (!Number(data?.storeTime || 0)) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.error(error);
  }
}
