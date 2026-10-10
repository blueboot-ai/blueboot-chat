// The embed in its icon arrangement, `<blue-search-embed-icon>`.
//
// THE DOCUMENTATION CALLS THIS THE "ICON" (install-guide.md, "Four ways the
// widget can appear") — the one arrangement whose documented name and mode
// value already agree. A small mark with the assistant's name, for a host's
// own header or menu bar: no box, no border, no background, and no wider than
// its own words, so it can be typed to match the links beside it
// (`iconfontsize`, `iconfontfamily`). The panel it opens floats over the page
// and the mark does not move, so the bar never changes height.
//
// Not `<blue-search-launcher>`, which is the fourth arrangement and a
// different component: the launcher is the round button pinned to a corner of
// the viewport, while this one stays wherever the page puts it.
//
// See embed-inline for what these three wrappers are and the rule about inputs.

import { Component, ViewEncapsulation } from '@angular/core';

import {
  EMBED_VIEW_IMPORTS,
  EmbedComponent,
  EmbedStartMode,
} from './embed.component';

@Component({
  selector: 'blue-search-embed-icon',
  standalone: true,
  imports: EMBED_VIEW_IMPORTS,
  templateUrl: './embed.component.html',
  styleUrls: ['./embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EmbedIconComponent extends EmbedComponent {
  // NO @Input HERE — see embed-inline.component.ts.

  /** The mode, fixed by the tag. See embed-inline.component.ts. */
  override get startMode(): EmbedStartMode {
    return 'icon';
  }

  override set startMode(_ignored: EmbedStartMode | string | undefined) {
    // The tag is the mode.
  }
}
