// src/elements.ts
import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';

import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideMarkdown } from 'ngx-markdown';

import { EmbedComponent } from './app/embed/embed.component';
import { LauncherComponent } from './app/launcher/launcher.component';

(async () => {
  const app = await createApplication({
    providers: [
      provideHttpClient(withFetch()),
      provideMarkdown(),
      // NOTE: no provideNoopAnimations here — we avoid importing the animations package entirely
    ],
  });

  const EmbedEl = createCustomElement(EmbedComponent, { injector: app.injector });
  if (!customElements.get('blue-search-embed')) {
    customElements.define('blue-search-embed', EmbedEl);
  }

  const LauncherEl = createCustomElement(LauncherComponent, { injector: app.injector });
  if (!customElements.get('blue-search-launcher')) {
    customElements.define('blue-search-launcher', LauncherEl);
  }
})();
