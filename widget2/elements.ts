// Build entry — turns widget2 into the script a customer's page loads.
//
// This is the ONLY file in widget2 that knows about custom elements. The
// components themselves are ordinary Angular components with ordinary
// selectors, so they keep working unchanged inside a host Angular app (in this
// repo, gpt-chat, which imports them directly and never loads this file).
//
// Nothing here is imported by the module itself. It exists for `npm run build`.

import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import type { Type } from '@angular/core';

import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideMarkdown } from 'ngx-markdown';

import { EmbedComponent } from './embed/embed.component';
import { EmbedPopupComponent } from './embed/embed-popup.component';
import { EmbedIconComponent } from './embed/embed-icon.component';
import { EmbedDockedComponent } from './embed/embed-docked.component';
import { LauncherComponent } from './launcher/launcher.component';

/**
 * Tag names are a PUBLIC INTERFACE. They are pasted into customer pages,
 * WordPress shortcodes and published install guides, none of which anyone here
 * can edit afterwards. Renaming one breaks every page carrying it, silently:
 * an unknown element is not an error, it is an empty box.
 *
 * `blue-search-embed` is bound to EmbedComponent, NOT to EmbedInlineComponent,
 * and that is the deliberate half of this list. EmbedComponent honours the
 * `startmode` attribute, so the installs already out there reading
 * `<blue-search-embed startmode="icon">` keep rendering an icon. The wrapper
 * pins its mode and would render those as a search box instead — no error, no
 * missing element, just the wrong arrangement on somebody else's site.
 *
 * Switching that one entry to EmbedInlineComponent is the change that drops
 * `startmode` support from the default tag. It is one line, and it is not a
 * tidy-up. See README.md.
 */
const ELEMENTS: ReadonlyArray<readonly [string, Type<unknown>]> = [
  ['blue-search-embed',       EmbedComponent],
  ['blue-search-embed-popup', EmbedPopupComponent],
  ['blue-search-embed-icon',  EmbedIconComponent],
  // Popup, in the page's flow rather than over it. Reachable as
  // `<blue-search-embed startmode="docked">` too — this tag is the version that
  // cannot be given the wrong mode by a typo.
  ['blue-search-embed-docked', EmbedDockedComponent],
  ['blue-search-launcher',    LauncherComponent],
];

(async () => {
  const app = await createApplication({
    providers: [
      provideHttpClient(withFetch()),
      provideMarkdown(),
      // No animations provider, deliberately: importing @angular/animations
      // would pull the package into a bundle that has no use for it.
    ],
  });

  for (const [tag, component] of ELEMENTS) {
    // Guarded because defining a tag twice throws, and a host page that loads
    // the script from two places — a theme and a plugin both including it is
    // the usual way — would otherwise take the whole widget down rather than
    // the second copy quietly doing nothing.
    if (!customElements.get(tag)) {
      customElements.define(tag, createCustomElement(component, { injector: app.injector }));
    }
  }
})();
