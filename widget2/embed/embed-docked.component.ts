// The embed docked into the page, `<blue-search-embed-docked>`.
//
// POPUP, MINUS THE FLOATING. Everything the Popup arrangement does — open the
// moment the element exists, no collapsed form, no Hide button, on screen for
// exactly as long as the host keeps the element — with one difference: it is a
// block of the page rather than something covering it. It takes real layout
// space and pushes what follows down as the conversation grows.
//
// That difference is the whole reason it exists. Popup deliberately never moves
// the host page: the slot holds its place and the conversation opens over the
// content below. For a support page, a docs sidebar or a column of its own,
// that is the wrong promise — the assistant is meant to BE part of the page,
// not hover over it.
//
// Sizing is the host's. Left alone the element grows with the conversation;
// given a height in the host's own CSS
// (`blue-search-embed-docked { height: 480px }`) it stays put and the
// conversation takes the slack. See .embed-shell.is-docked in
// embed.component.css.
//
// See embed-inline for what these wrappers are and the rule about inputs.

import { Component, ViewEncapsulation } from '@angular/core';

import {
  EMBED_VIEW_IMPORTS,
  EmbedComponent,
  EmbedStartMode,
} from './embed.component';

@Component({
  selector: 'blue-search-embed-docked',
  standalone: true,
  imports: EMBED_VIEW_IMPORTS,
  templateUrl: './embed.component.html',
  styleUrls: ['./embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EmbedDockedComponent extends EmbedComponent {
  // NO @Input HERE — see embed-inline.component.ts.

  /** The mode, fixed by the tag. See embed-inline.component.ts. */
  override get startMode(): EmbedStartMode {
    return 'docked';
  }

  override set startMode(_ignored: EmbedStartMode | string | undefined) {
    // The tag is the mode.
  }
}
