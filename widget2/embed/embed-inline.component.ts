// The embed in its inline arrangement, `<blue-search-embed>`.
//
// This one carries the LEGACY TAG NAME, unlike its two siblings: the default
// arrangement has always been `<blue-search-embed>`, and that name is in
// customer pages, WordPress shortcodes and published guides. It keeps it.
// EmbedComponent itself answers to `blue-search-embed-base`, so there is no
// collision.
//
// THE DOCUMENTATION CALLS THIS THE "SEARCH BOX" (install-guide.md, "Four ways
// the widget can appear"). A plain input in the flow of the page, meant to be
// indistinguishable from the host's own search field: the visitor types in it,
// the conversation opens OVER the content below, and the input's space is held
// so the page does not reflow around it. It is the default, which is what
// `<blue-search-embed>` with no `startmode` gives.
//
// One of three wrappers over EmbedComponent — see embed-popup and embed-icon.
// They exist so a host page names the arrangement in the tag instead of in an
// attribute: `<blue-search-embed-icon>` rather than
// `<blue-search-embed startmode="icon">`. The attribute still works and is
// unchanged; normalizeStartMode() in embed.component exists precisely because
// host pages misspell it, and a tag cannot be misspelled without failing
// loudly.
//
// ONE CONSEQUENCE TO BE DELIBERATE ABOUT. This class pins the mode, so
// `startmode` does nothing on it. Inside this app that is what
// `<blue-search-embed>` now means. On a customer's site the meaning is set by
// whatever the bundle registers as `blue-search-embed` — and if that becomes
// this class, then every existing install reading
// `<blue-search-embed startmode="icon">` or `startmode="popup"` renders as a
// search box instead, with no error to notice. Registering EmbedComponent for
// that tag is what keeps the attribute working. See ../README.md.

import { Component, ViewEncapsulation } from '@angular/core';

import {
  EMBED_VIEW_IMPORTS,
  EmbedComponent,
  EmbedStartMode,
} from './embed.component';

@Component({
  selector: 'blue-search-embed',
  standalone: true,
  imports: EMBED_VIEW_IMPORTS,
  templateUrl: './embed.component.html',
  styleUrls: ['./embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EmbedInlineComponent extends EmbedComponent {
  // NO @Input HERE, EVER. Angular merges input metadata down the prototype
  // chain, so an input declared on this subclass is inherited by nothing but
  // is permanent for it — and the same warning at the top of EmbedComponent
  // about not adding inputs to ChatCoreComponent applies one level further
  // down. Everything a host can set is already declared on EmbedComponent and
  // is inherited as-is.

  /**
   * The mode, fixed by the tag.
   *
   * Both halves of the accessor are overridden, and the setter deliberately
   * ignores what it is given. A getter that answers a constant also means the
   * parent's `startModeValue` is never consulted here, so there is no second
   * place holding the mode.
   *
   * On THIS class that silence is the thing to weigh, because it wears the
   * legacy tag: `<blue-search-embed startmode="icon">` is a real spelling in
   * real customer pages, and here it renders a Search box. See the note above
   * and ../README.md — EmbedComponent is what keeps that attribute working.
   */
  override get startMode(): EmbedStartMode {
    return 'inline';
  }

  override set startMode(_ignored: EmbedStartMode | string | undefined) {
    // The tag is the mode.
  }
}
