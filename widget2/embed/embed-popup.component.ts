// The embed in its popup arrangement, `<blue-search-embed-popup>`.
//
// THE DOCUMENTATION NOW CALLS THIS THE POPUP TOO (install-guide.md, "Five ways
// the widget can appear"). It used to say "Panel" while the mode value said
// `popup`, and the two names have been made one. An older bug report saying
// "panel" means this. Do not read "popup" as "opens on a click" — it is the
// opposite. The widget is ALREADY OPEN when the element is there, contributes
// no layout of its own, and is on screen for exactly as long as the host page
// keeps the element. When the visitor hides it, it is gone and the page has to
// bring it back (the `bbc-closed` event), which is the trade the Icon
// arrangement exists to avoid.
//
// See embed-inline for what these three wrappers are and the rule about
// inputs.

import { Component, ViewEncapsulation } from '@angular/core';

import {
  EMBED_VIEW_IMPORTS,
  EmbedComponent,
  EmbedStartMode,
} from './embed.component';

@Component({
  selector: 'blue-search-embed-popup',
  standalone: true,
  imports: EMBED_VIEW_IMPORTS,
  templateUrl: './embed.component.html',
  styleUrls: ['./embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EmbedPopupComponent extends EmbedComponent {
  // NO @Input HERE — see embed-inline.component.ts.

  /** The mode, fixed by the tag. See embed-inline.component.ts. */
  override get startMode(): EmbedStartMode {
    return 'popup';
  }

  override set startMode(_ignored: EmbedStartMode | string | undefined) {
    // The tag is the mode.
  }
}
