// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { Routes, provideRouter, RouterOutlet, ActivatedRoute } from '@angular/router';
import {
  Component,
  inject,
  CUSTOM_ELEMENTS_SCHEMA,
  AfterViewInit,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';

// ✅ Always register the custom elements (for WP AND for dev shell)
import './elements';
import { ChatComponent } from './app/chat/chat.component';

/* ------------ Root shell (dev only) ------------ */
@Component({
  standalone: true,
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet></router-outlet>`,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
class RootShellComponent {}

/* ------------ Widget route (dev shell) ------------ */
@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <style>
      .ce-host { display:block; min-height: 420px;}
    </style>
    <div class="ce-host" #host></div>
  `,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
class WidgetRoute implements AfterViewInit {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLElement>;
  private q = inject(ActivatedRoute).snapshot.queryParamMap;

  appid = this.q.get('appid') || 'bluesearch';
  userid = this.q.get('userid') || 'anon';
  lang = this.q.get('lang') || 'no';
  welcometext = this.q.get('welcometext') || '';

  ngAfterViewInit(): void {
    const el = document.createElement('blue-search-embed');
    el.setAttribute('appid', this.appid);
    el.setAttribute('userid', this.userid);
    el.setAttribute('lang', this.lang);
    if (this.welcometext) {
      el.setAttribute('welcometext', this.welcometext);
    }
    this.hostRef.nativeElement.appendChild(el);
  }
}

/* ------------ Launcher route (dev shell) ------------ */
@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <style>

      .ce-host { position: relative; min-height: 80px;}
      /* The launcher itself is fixed; host just ensures the page isn't "empty" */
    </style>
    <div class="ce-host" #host></div>
  `,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
class LauncherRoute implements AfterViewInit {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLElement>;
  private q = inject(ActivatedRoute).snapshot.queryParamMap;

  appid = this.q.get('appid') || 'bluesearch';
  userid = this.q.get('userid') || 'anon';
  lang = this.q.get('lang') || 'no';

  ngAfterViewInit(): void {
    const el = document.createElement('blue-search-launcher');
    el.setAttribute('appid', this.appid);
    el.setAttribute('userid', this.userid);
    el.setAttribute('lang', this.lang);
    this.hostRef.nativeElement.appendChild(el);
  }
}

/* ------------ Chat panel route (dev shell) — the bare `blue-search` panel,
   full page, with no embed bubble or launcher chrome around it. ------------ */
@Component({
  standalone: true,
  imports: [CommonModule, ChatComponent],
  template: `
    <style>
      .panel-host { display:block; height: 100vh; }
    </style>
    <div class="panel-host">
      <blue-search
        [appid]="appid"
        [gptid]="gptid"
        [envurl]="envurl"
        [assistantid]="assistantid"
        [defaultlang]="lang"
      ></blue-search>
    </div>
  `,
})
class ChatPanelRoute {
  private q = inject(ActivatedRoute).snapshot.queryParamMap;

  appid = this.q.get('appid') || 'bluesearch';
  gptid = this.q.get('gptid') || undefined;
  envurl = this.q.get('envurl') || undefined;
  assistantid = this.q.get('assistantid') || undefined;
  lang = this.q.get('lang') || 'no';
}

/* ------------ Routes (dev shell) ------------ */
const routes: Routes = [
  // Default route = widget
  { path: '', component: WidgetRoute },
  // /widget → same as root
  { path: 'widget', redirectTo: '', pathMatch: 'full' },
  // /launcher → launcher test page
  { path: 'launcher', component: LauncherRoute },
  // /panel → the bare chat panel, full page, not embedded
  { path: 'panel', component: ChatPanelRoute },
];

/* ------------ Decide: dev shell or WP mode? ------------ */

// Optional override hook if you ever want to force dev shell elsewhere
declare global {
  interface Window {
    BLUESEARCH_DEV_SHELL?: boolean;
  }
}

const hostname = window.location.hostname;
const isLocalHost =
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1';

const useDevShell = isLocalHost || window.BLUESEARCH_DEV_SHELL === true;

/* ------------ Bootstrap only in dev shell mode ------------ */
if (useDevShell) {
  // Local dev: use router, you can visit /, /widget, /launcher
  bootstrapApplication(RootShellComponent, {
    providers: [provideRouter(routes), provideHttpClient()],
  });
} else {
  // Production / WordPress:
  // - DO NOT bootstrap Angular shell
  // - Only ./elements runs -> registers <blue-search-embed> and <blue-search-launcher>
  // - URL is untouched (no #, no /widget)
  // Nothing to do here.
}
