import {environment, backendUrl} from '../environment/environment';

/**
 * A base URL the widget is willing to talk to, or '' if the value is not one.
 *
 * Validated rather than trusted, and http(s) only. `envurl` arrives as an
 * attribute on someone else's page, so it can be anything — and every request
 * the widget makes, including the visitor's messages and uploaded files, goes
 * to whatever this returns. A `javascript:` or `data:` value reaching fetch()
 * is not a URL, it is an injection.
 *
 * The trailing slash goes because every caller appends its own path: without
 * this, one setting produces `https://host//api/responses` and another does
 * not, and the difference surfaces as a CORS mismatch rather than as a typo.
 */
function normalizeBackendUrl(value: string): string {
  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';

    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    // Not a URL at all — a leftover "prod"/"dev" from an older install lands
    // here, and falls through to the build default, which is what those names
    // resolved to for almost everyone anyway.
    return '';
  }
}

export const Settings = {

  /**
   * The backend the widget talks to. The only URL here.
   *
   * demoUrl / demoserviceApiUrl() used to sit alongside it and were never read
   * by anything in widget2 — the console pages that use a demo service import
   * Settings from app/widget/settings, the legacy module, which has its own
   * copy. Carrying a second URL here did nothing except invite setBackendUrl()
   * to move it, which is how a partner's envurl came to repoint a service their
   * embed never calls.
   */
  url: environment.publicApiUrl,

  publicApiUrl() {
    return this.url
  },
  /**
   * True once a widget has supplied a usable envUrl. From then on the backend
   * is fixed for the life of the page.
   *
   * Two rules meet here, and the latch is what implements both.
   *
   * An envUrl outranks the build default, and outranks a sibling widget that
   * supplied none. Settings is a module singleton shared by every widget on the
   * page, and the calls into it are not ordered: a widget mounting *without* an
   * envUrl would otherwise take the default branch below and silently reset one
   * that had supplied a backend, and which widget mounts last is not something
   * a host controls.
   *
   * And it never changes once the widget has started. A backend swapped
   * underneath a running conversation is not a reconfiguration, it is two
   * halves of a conversation in two places: history written against one
   * backend, attachments stored on the other, a live agent session on a server
   * that no longer hears from us. Whatever arrives first is what this page
   * talks to until it reloads.
   */
  backendLocked: false,

  /**
   * Point every backend call at a base URL. First one wins, for good.
   *
   * Two separate things used to share the word "env", which is why this is now
   * called envUrl and takes only a URL:
   *
   *   - The *build* environment — prod, dev — which chooses
   *     environment.publicApiUrl at compile time. That still exists and is
   *     still where the default comes from. It is not this.
   *   - The *host's* choice of backend, passed on the element. That is this,
   *     and it is now the address itself: "https://api.partner.example".
   *
   * The parameter used to take "prod" / "dev" / "dev-local" too, each mapping
   * to a hardcoded pair of Cloud Run URLs — so every backend anyone could ever
   * be served by had to exist in this file and ship in a release, and a partner
   * running their own instance could not be reached without us cutting a build
   * for them.
   *
   * "dev-local" is kept, and is the one name left. It is not a backend so much
   * as a developer's own machine, and its value comes from env.common rather
   * than a literal here — nothing about it is baked into this function.
   *
   * Absent, empty or unusable is *not* an instruction to reset. It means "this
   * caller has no opinion", and a caller with no opinion must not override one
   * that does.
   *
   * There is one URL to move, which is the point — see the note on `url`.
   */
  setBackendUrl(envUrl?: string | undefined) {
    // Already decided. Not an error and not worth a warning: every widget on
    // the page calls this on init, and all but the first are expected to be
    // no-ops.
    if (this.backendLocked) return;

    const raw = String(envUrl || '').trim();

    if (raw.toLowerCase() === "dev-local") {
      this.url = backendUrl.publicApiUrl.replace(/\/+$/, '') || ""
      this.backendLocked = true;
      return;
    }

    const url = normalizeBackendUrl(raw);

    if (url) {
      this.url = url;
      this.backendLocked = true;
      return;
    }

    // Nothing usable supplied. The build default — prod or dev, whichever this
    // bundle was compiled for — and no latch, so a widget that supplies a URL
    // later still gets to decide.
    //
    // A malformed value lands here too, deliberately: a typo'd URL falls back
    // to a backend that works rather than pinning the page to one that does
    // not, and says so on the console instead of failing every request.
    if (raw) {
      console.warn(`[blue-search] ignoring envUrl="${raw}" — expected an http(s) base URL`);
    }

    this.url = environment.publicApiUrl
  },
  queryBase() {
    return this.publicApiUrl()
  },

  /**
   * The backend base URL for every bot variant (embed, launcher, chat panel).
   *
   * Just the resolved public API URL now — whatever `envurl` settled on, or
   * the build default. It used to check a `window.__BLUE_SEARCH_BACKEND` global
   * first; that is gone, along with the ordering question of whether a page
   * global should outrank a parameter on the element. There is one way to point
   * the widget at a backend, and it is `envurl`.
   */
  resolveBackendUrl(): string {
    return this.publicApiUrl() || '';
  }
}
