import {
  Component,
  Input,
  ElementRef,
  AfterViewInit,
  ViewChild,
  ViewEncapsulation,
  NgZone,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BluebootClient } from '../core/services/blueboot.client';
import { Settings } from '../core/settings';
import { DEFAULT_LOGO_DATA_URI } from '../core/assets/default-logo';
import { DEFAULT_WIDGET_THEME } from '../core/theme/default-widget-theme';
import { LauncherStorageService } from './services/launcher-storage.service';
import { LauncherTypographyService } from './services/launcher-typography.service';
import { LauncherMediaService } from './services/launcher-media.service';
import {
  LauncherPanelMode,
  LauncherPositionController,
  LauncherPositionService,
} from './services/launcher-position.service';
import { ChatComponent } from '../chat/chat.component';
import { loadPanelSize, savePanelSize } from '../core/services/chat-storage.functions';

@Component({
  selector: 'blue-search-launcher',
  standalone: true,
  imports: [CommonModule, ChatComponent],
  encapsulation: ViewEncapsulation.ShadowDom,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './launcher.component.html',
  styleUrls: ['./launcher.component.css'],
})
export class LauncherComponent implements AfterViewInit, OnInit, OnChanges, OnDestroy {
  private static readonly DEFAULT_LAUNCHER_SIZE_PX = 64;
  private static readonly MIN_LAUNCHER_SIZE_PX = 40;
  private static readonly MAX_LAUNCHER_SIZE_PX = 300;

  /** Square size, in pixels, of the cached launcher-video-frame still (see
   *  captureVideoFramePreview()). Small on purpose: it only ever fills a
   *  64–300px button, and keeping the data: URL small keeps it a cheap,
   *  reliable localStorage write. */
  private static readonly VIDEO_FRAME_PREVIEW_SIZE = 128;

  /** Guards brandingReady against getApp() or the icon load never
   *  resolving. Deliberately short: the icon is small, and the video is no
   *  longer part of this gate (see applyApiConfigWhenReady()'s comment on
   *  why waiting for it here made the button take far too long to appear). */
  private static readonly BRANDING_SAFETY_TIMEOUT_MS = 1500;

  public uiReady = false;
  private apiReady = false;
  private attrReady = false;
  private imagesReady = false;

  /**
   * True once the real branding (icon and/or video) has either loaded or the
   * safety timeout has given up waiting. Distinct from uiReady: uiReady gates
   * aria-hidden and click-to-open, and is deliberately allowed to fire before
   * the network finishes so the launcher stays usable. brandingReady instead
   * gates the button's visibility in the template, so visitors never see the
   * default icon flash before the real one swaps in — the button simply
   * doesn't appear until there is something real to show it, or the timeout
   * gives up and shows the fallback instead.
   */
  public brandingReady = false;
  private brandingSafetyTimer?: ReturnType<typeof setTimeout>;

  /**
   * True once the launcher video has an actually-decodable frame to paint.
   * Drives a CSS opacity transition (see the template) so the video dissolves
   * in over the icon instead of popping in the instant its blob URL exists —
   * assigning the src is not the same moment the browser has anything to
   * show for it.
   */
  public videoFrameVisible = false;

  public isIOSDevice = false;
  public historyStorageKey = '';

  private resolveBootReady!: () => void;
  private bootReadyPromise = new Promise<void>((res) => (this.resolveBootReady = res));

  /**
   * Resolves the first time uiReady turns true.
   *
   * Distinct from bootReadyPromise, which resolves in ngOnInit — before
   * attrReady is set in ngAfterViewInit, so uiReady is usually still false
   * there. Anything that must not run until the launcher is actually usable
   * waits on this one; openChat() in the position controller returns silently
   * when isUiReady() is false, so a caller that guessed at the timing simply
   * did nothing, some of the time.
   */
  private resolveUiReady!: () => void;
  private uiReadyPromise = new Promise<void>((res) => (this.resolveUiReady = res));

  // Default false: a launcher that can be dragged is a surprise most
  // integrators don't want on a site-wide bubble. Opt in per-app via
  // widgetParams.draggable (see applyApiBehavior below).
  private apiDraggable = false;
  private apiOpenOnHover = false;
  private apiHoverOpenDelayMs = 250;
  private apiLauncherSizePx?: number;
  private apiVideoEnabled?: boolean;
  private apiLauncherVideoSrc?: string;

  // Typography for the launcher's own chrome (and, via CSS custom-property
  // inheritance into <blue-search>'s shadow root, the chat panel too).
  // fontFamily/fontSize/lineHeight are the optional explicit overrides —
  // @Inputs again, but this time applyApiTypography() below writes API
  // results into the separate apiFontFamily/apiFontSize/apiLineHeight
  // fields instead, so it can never clobber an explicit value the way it
  // used to (see the old comment this replaced). applyTypographyVars()
  // checks @Input first, then the api* fallback — and if NEITHER is set,
  // writes nothing at all, deliberately, so chat.component.css's own :host
  // default (and its mobile @media bump) decides instead of an inline
  // "default" value permanently overriding it.
  @Input('fontfamily') fontFamily?: string;
  @Input('fontsize')   fontSize?: string;
  @Input('lineheight') lineHeight?: string;
  private apiFontFamily?: string;
  private apiFontSize?: string;
  private apiLineHeight?: string;

  public panelMode: LauncherPanelMode = 'compact';


  @Input() mode: LauncherPanelMode = 'compact';

  @Input() appid?: string;

  /**
   * Which installation of the widget this is, when a page has more than one.
   *
   * The same parameter the embed takes, and for the same reason: it scopes
   * everything this widget stores — history, the open flag, remembered contact
   * details — so two launchers for one app do not share a conversation. See
   * StorageScope in chat-storage.functions.ts.
   *
   * Forwarded to <blue-search> below, which is what actually holds the panel
   * and its storage. Until this existed the launcher had no way to say which
   * installation it was, so every launcher on an origin stored under the same
   * unscoped key — and our own preview launchers could not be told apart from
   * a real one when clearing.
   */
  @Input() assistantid?: string;

  /** The backend serving this assistant, as a full base URL — forwarded to
   *  <blue-search> below. See Settings.setBackendUrl(). */
  @Input() envurl?: string;
  @Input() gptid?: string;

  /**
   * The language the panel renders in — forwarded to <blue-search> below.
   *
   * One parameter, not two. `lang` and `defaultLang` were the same statement
   * from a host's point of view — "render in this language" — and offering both
   * only raises the question of which wins.
   *
   * It is a *default* in the sense that matters: a language the visitor picked
   * in the widget outranks it (see resolveStartingLang), because what a site
   * declares is about visitors who have not said what they want.
   *
   * The launcher has no text of its own to translate; it carries this purely so
   * a host can state it on the one tag it actually writes.
   *
   * Non-optional, with the panel's own default, rather than `?:` — otherwise
   * `undefined` reaches a `string` input in the template and overwrites that
   * default with nothing.
   */
  @Input() defaultlang: string = '';

  // Optional color overrides, forwarded onto <blue-search> below and also
  // used for this launcher's own wrapperBorderColor (see its getter) —
  // same "explicit input wins over whatever getApp() returns" precedence
  // as fontFamily/fontSize/lineHeight above.
  @Input('backcolor')  backColor?: string;
  @Input('headerbg')   headerBg?: string;
  @Input('headertext') headerText?: string;

  /** Bubble background, forwarded onto <blue-search> below — the launcher
   *  itself has no bubbles. See ChatComponent.messageColor. */
  @Input('messagecolor') messageColor?: string;

  /** Conversation text colour, forwarded onto <blue-search> below — the
   *  launcher has no text of its own. See ChatComponent.fontColor. */
  @Input('fontcolor') fontColor?: string;

  /** Header title for the panel, forwarded to <blue-search>. Lets a host name
   *  the assistant without configuring the app — the same parameter the embed
   *  takes. Unset leaves the app's own title in charge. */
  @Input('title') titleText?: string;

  /**
   * Open the panel as soon as this launcher is usable.
   *
   *     <blue-search-launcher openonboot="true" ...>
   *
   * The one supported way in. The launcher boots closed on purpose and there is
   * no auto-reopen from a stored flag (see the note in ngAfterViewInit), so a
   * host that wants the panel up had only the button — and clicking it is a
   * race: openChat() returns silently while isUiReady() is false, which it is
   * for an unknown stretch after mount. This waits for that instead of
   * guessing, so it cannot miss.
   *
   * One-shot, deliberately. It says how the launcher starts, not what state it
   * must stay in: setting it back to false does nothing, and a visitor who
   * closes the panel keeps it closed.
   *
   * A setter rather than a field because an attribute can be written after the
   * element upgrades, and a plain assignment then arrives too late to act on.
   */
  @Input('openonboot')
  set openOnBoot(v: boolean | string | undefined | null) {
    // Attributes reach a custom element as strings, so a bare `openonboot`
    // (empty value) and "false" both have to mean what they look like.
    const on = v === '' || v === true || String(v).toLowerCase() === 'true';
    if (!on || this.openOnBootArmed) return;

    this.openOnBootArmed = true;

    this.uiReadyPromise.then(() => {
      if (!this.destroyed) this.positionController?.open();
    });
  }

  @Input('openOnBoot') set openOnBootCamel(v: boolean | string | undefined | null) {
    this.openOnBoot = v;
  }

  private openOnBootArmed = false;

  // Optional size override for the compact chat panel — wins over both
  // the CSS default (360x520, see launcher.component.css) and whatever
  // the app's widgetParams (compactWidth/compactHeight) configure. See
  // applySizeOverrides() below: applyPanelCssVars() may set the API's own
  // value once getApp() resolves, so this is (re)applied right after it,
  // same sequencing as applyTypographyVars()/applyApiTypography(). Only
  // affects the compact panel — full mode is always edge-to-edge.
  @Input() width?: string;
  @Input() height?: string;

  /**
   * Stacking order of the launcher button and its panel, as a plain z-index.
   *
   *     <blue-search-launcher zindex="1200" ...>
   *
   * The same parameter EmbedComponent already has, and it is here for the
   * same reason its comment gives: the widget defaults to the top of the
   * stack, which is right when nothing of the host's should ever cover it,
   * and wrong the moment they have their own modal, cookie banner or sticky
   * nav that must. A site cannot lower the widget by raising their own —
   * there is nothing above the maximum.
   *
   * The launcher is the one that needed it most and had it least. Its
   * stylesheet was already written against --bbc-z throughout (#bbc-launcher
   * takes var(--bbc-z) + 1, #bbc-wrapper var(--bbc-z)), so the parameter was
   * in effect already there — but ngAfterViewInit then wrote the maximum
   * straight onto the host as an inline style, and the host is what every
   * one of those values is measured inside. A stacking context capped at the
   * maximum cannot be got above from outside it by any means at all, which
   * is what made this worth a front door rather than a workaround: the
   * console's own language menu sat under the button and could not be
   * clicked, and no z-index anywhere in the application could have fixed it.
   *
   * A number, not a size: no units, and 0 is a legitimate value, so it is
   * distinguished from unset rather than from falsy. Unset keeps the
   * documented default, so nothing changes for an install that does not
   * pass it.
   */
  @Input('zindex') zIndex?: string | number;

  // camelCase spellings of the same parameters. Lowercase is the documented
  // name; these exist so the other spelling works too rather than failing in an
  // Angular template while passing silently in plain HTML, where the parser
  // lowercases attribute names before anything can read them. See the longer
  // note in embed.component.ts. Each setter writes the real property, so the
  // component reads one field and never asks which spelling arrived.
  @Input('appId')       set appIdCamel(v: string | undefined)       { this.appid = v; }
  @Input('assistantId') set assistantIdCamel(v: string | undefined) { this.assistantid = v; }
  @Input('envUrl')      set envUrlCamel(v: string | undefined)      { this.envurl = v; }
  @Input('gptId')       set gptIdCamel(v: string | undefined)       { this.gptid = v; }
  @Input('defaultLang') set defaultLangCamel(v: string)             { this.defaultlang = v; }
  @Input('fontFamily')  set fontFamilyCamel(v: string | undefined)  { this.fontFamily = v; }
  @Input('fontSize')    set fontSizeCamel(v: string | undefined)    { this.fontSize = v; }
  @Input('lineHeight')  set lineHeightCamel(v: string | undefined)  { this.lineHeight = v; }
  @Input('backColor')   set backColorCamel(v: string | undefined)   { this.backColor = v; }
  @Input('headerBg')    set headerBgCamel(v: string | undefined)    { this.headerBg = v; }
  @Input('headerText')  set headerTextCamel(v: string | undefined)  { this.headerText = v; }
  @Input('messageColor') set messageColorCamel(v: string | undefined) { this.messageColor = v; }
  @Input('fontColor')   set fontColorCamel(v: string | undefined)    { this.fontColor = v; }
  @Input('zIndex')      set zIndexCamel(v: string | number | undefined) { this.zIndex = v; }




  @ViewChild('launcher', { static: true }) launcher!: ElementRef<HTMLButtonElement>;
  @ViewChild('wrapper', { static: true }) wrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('chat', { read: ElementRef }) chat?: ElementRef<HTMLElement>;
  @ViewChild('launcherVideo', { read: ElementRef }) launcherVideo?: ElementRef<HTMLVideoElement>;

  private blue!: BluebootClient;
  private displayedRobotSrc = '';
  private pendingRobotSrc?: string;
  private robotReady?: Promise<void>;
  private logoReady?: Promise<void>;
  private mediaArmCleanup?: () => void;
  private videoFramePrimed = false;
  private positionController?: LauncherPositionController;
  private destroyed = false;

  constructor(
    private zone: NgZone,
    private host: ElementRef<HTMLElement>,
    private launcherStorage: LauncherStorageService,
    private launcherTypography: LauncherTypographyService,
    private launcherMedia: LauncherMediaService,
    private launcherPosition: LauncherPositionService,
  ) {
    // Nothing here: Angular has not assigned inputs at construction, so
    // `this.envurl` is always undefined and this only ever took the "nothing supplied"
    // branch — which, on a page with a second widget, reset an environment that
    // widget had asked for. Applied in ngOnInit instead, where the input
    // exists. See Settings.setBackendUrl().
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Both spellings, because each camelCase alias is a setter on its own
    // property and SimpleChanges is keyed by property name rather than by the
    // alias — a host writing appId= produces a change under 'appIdCamel', which
    // a test naming only 'appid' never sees, leaving the history key pointed at
    // the previous app.
    if (changes['appid'] || changes['appIdCamel'] ||
        changes['gptid'] || changes['gptIdCamel'] ||
        changes['assistantid'] || changes['assistantIdCamel']) {
      this.recomputeHistoryKey();
    }
  }

  ngOnInit() {
    // First, and before anything reads a backend URL: the first envurl on
    // the page wins and is then fixed for its lifetime.
    Settings.setBackendUrl(this.envurl);

    this.isIOSDevice = this.launcherMedia.isIOS();
    this.recomputeHistoryKey();
    this.applyTypographyVars();
    this.applySizeOverrides();

    // No unconditional setLauncherSize() here any more: that used to write
    // --bbc-launcher-size: 64px inline on the host at startup, and an
    // inline style always beats a stylesheet rule — including the mobile
    // @media (max-width: 600px) rule in launcher.component.css that scales
    // the button down on small screens. Leaving the property unset lets
    // that CSS default (also 64px on wider screens) take effect instead.
    // applyApiLauncherSize() below still sets it inline, deliberately,
    // whenever the app config actually configures a launcherSize.

    this.setInitialRobotFallback();

    this.blue = new BluebootClient(Settings.resolveBackendUrl(), this.appid, this.gptid);

    // The launcher is usable from its attribute defaults and the fallback robot
    // alone, so nothing here waits on the network. This used to `await
    // getApp()` before setting apiReady, which gates uiReady — and uiReady
    // drives aria-hidden on the button and the auto-reopen check in the
    // position controller. A slow or unreachable backend therefore left the
    // launcher un-announced to assistive tech and unable to restore an open
    // chat, for as long as the request took.
    //
    // Now the config is applied whenever it lands. The visible cost is that
    // API-driven branding (size, robot image, video) can re-skin a moment after
    // first paint, which is the same trade the chat and embed already make.
    this.apiReady = true;
    this.markImagesReadyWhenDone();
    this.updateUiReady();
    this.resolveBootReady?.();

    this.applyApiConfigWhenReady();

    // Safety net: if getApp() never resolves (or the backend is down), the
    // button must still appear eventually rather than staying invisible
    // forever. This only guards the config fetch itself — once it resolves,
    // applyApiConfigWhenReady() swaps this for a longer, video-aware timer
    // before actually revealing anything.
    this.brandingSafetyTimer = setTimeout(() => {
      this.brandingSafetyTimer = undefined;
      this.zone.run(() => {
        this.brandingReady = true;
      });
    }, LauncherComponent.BRANDING_SAFETY_TIMEOUT_MS);
  }

  /**
   * Applies everything the app config controls, once getApp() resolves.
   *
   * Fire-and-forget: the promise is never awaited by ngOnInit, and a failure is
   * a warning rather than an error path — the launcher keeps whatever the host
   * attributes and fallbacks gave it.
   *
   * Runs inside the Angular zone (zone.js patches fetch), so the fields written
   * here reach the view without an explicit change-detection nudge.
   */
  private applyApiConfigWhenReady(): void {
    // Two halves: the text config, then the imagery this launcher is mostly
    // made of — robot art, logo, video. Both are applied by the same handler,
    // so whichever lands first shows and the other fills in behind it.
    Promise.allSettled([
      this.blue.getApp?.('text'),
      this.blue.getApp?.('media'),
    ])
      .then(() => {
        // The fetch can easily outlive the component — e.g. toggled off
        // again from the admin's try-page preview before it resolves.
        // Applying config to a destroyed component doesn't fit anything
        // meaningful anymore, and after ngOnDestroy the launcher's host
        // element is off in document.body detached from everything.
        if (this.destroyed) return;

        const app = this.blue.widgetApp;
        const wp = app?.widgetParams ?? {};

        this.applyApiVideoConfig(wp);
        this.applyApiLauncherSize(wp);
        this.applyApiBehavior(wp);
        this.applyApiTypography(wp);
        this.launcherPosition.applyPanelCssVars(this.host.nativeElement, wp);
        // Re-applied after applyPanelCssVars(): that call may have just
        // set --bbc-compact-width/-height from the API's own
        // compactWidth/compactHeight, and an explicit width/height
        // @Input must still win over it.
        this.applySizeOverrides();

        // Last of the three, because it is the most specific: the app's
        // configured size, then an explicit width/height attribute, then what
        // this visitor dragged the panel to. Without this the resize would be
        // undone by applyPanelCssVars() on every config refresh, which happens
        // more than once per page — the panel would snap back while being used.
        this.applyStoredPanelSize();

        this.applyApiBranding(wp);
        // headerBg (wrapperBorderColor's source) may only be known now that
        // getApp() has resolved — re-apply imperatively, same as at
        // ngAfterViewInit; never via an Angular style binding (see
        // applyWrapperBorderColor's comment).
        this.applyWrapperBorderColor();

        this.logoReady = Promise.resolve();
        this.applyTypographyVars();

        // Branding may have swapped the robot/logo — re-arm the readiness gate
        // so uiReady reflects the new images rather than the fallback ones.
        this.markImagesReadyWhenDone();
        this.updateUiReady();

        // Only now do we know what the real icon actually is. Wait for it
        // to finish loading before revealing the button, so nothing shows
        // the default mark first and swaps.
        //
        // The video is deliberately NOT part of this wait. downloadLauncherVideo()
        // fetches the whole clip before it can play at all (see its own
        // comment), which is routinely slower than visitors should have to
        // wait just to see the button — an earlier version of this gate
        // waited on the video too and made the launcher take several
        // seconds to appear. Instead the video fades in on top of the
        // already-visible icon whenever it happens to finish — see
        // onLauncherVideoFrameReady() and the (loadeddata)/(canplay)
        // bindings in the template.
        (this.robotReady ?? Promise.resolve()).then(() => {
          if (this.destroyed) return;
          this.clearBrandingSafetyTimer();
          this.zone.run(() => {
            this.brandingReady = true;
          });
        });
      })
      .catch(e => {
        console.warn('Launcher: getApp failed; keeping attribute defaults.', e);
        // Nothing to wait for — fall back to whatever the attributes and
        // default mark already show, immediately.
        this.clearBrandingSafetyTimer();
        this.zone.run(() => {
          this.brandingReady = true;
        });
      });
  }

  /** Cancels the ngOnInit safety timer once branding has resolved on its own,
   *  so it never fires late and re-triggers change detection for nothing. */
  private clearBrandingSafetyTimer(): void {
    if (this.brandingSafetyTimer === undefined) return;
    clearTimeout(this.brandingSafetyTimer);
    this.brandingSafetyTimer = undefined;
  }

  /**
   * The default: the lowest value that still floats the widget over the page.
   *
   * Must stay in step with the --bbc-z declared on :host in
   * launcher.component.css — that one is the pre-JS value and the one every
   * derived rule in the stylesheet reads, this one is what the host element
   * is actually given once this component runs. CSS and TS cannot share a
   * constant, so the number is written twice on purpose; the comment there
   * carries the reasoning for the value.
   *
   * Short version: 1 puts a positioned element above ordinary page content,
   * which is all a widget on someone else's site should assume. It was
   * 2147483647 — the maximum — which claimed that nothing of the host's may
   * ever cover it, and left them no way to disagree, because there is no
   * number above the maximum. A host that wants it higher passes zindex.
   */
  private static readonly DEFAULT_Z = 1;

  /**
   * zIndex as a number, or the default.
   *
   * Rejects anything non-numeric on purpose, the same way EmbedComponent
   * does: a bad z-index does not fail loudly, it silently puts the widget
   * behind something, and the built-in default is a far better answer than a
   * broken value.
   */
  private resolveZIndex(): number {
    const raw = String(this.zIndex ?? '').trim();
    if (!raw) return LauncherComponent.DEFAULT_Z;

    const n = Number(raw);
    if (!Number.isFinite(n)) return LauncherComponent.DEFAULT_Z;

    return Math.round(n);
  }

  ngAfterViewInit(): void {
    const hostEl = this.host.nativeElement as HTMLElement;

    if (hostEl.parentElement !== document.body) {
      document.body.appendChild(hostEl);
    }

    // The host is the stacking context everything else here lives in, so its
    // level and --bbc-z have to be the same number: the stylesheet positions
    // #bbc-launcher at var(--bbc-z) + 1 and #bbc-wrapper at var(--bbc-z),
    // and both are measured *inside* this element. Writing the maximum here
    // while --bbc-z said something else was the bug — it made the parameter
    // look settable while the host went on covering everything regardless.
    const z = this.resolveZIndex();

    Object.assign(hostEl.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(z),
      pointerEvents: 'none',
      display: 'block',
    });

    hostEl.style.setProperty('--bbc-z', String(z));

    this.applyTypographyVars();
    this.applySizeOverrides();

    this.attrReady = true;
    this.updateUiReady();

    this.zone.runOutsideAngular(() => {
      this.launcher.nativeElement.style.pointerEvents = 'auto';
      this.wrapper.nativeElement.style.pointerEvents = 'auto';
      this.applyWrapperBorderColor();

      this.positionController = this.launcherPosition.setup({
        zone: this.zone,
        hostEl,
        launcherEl: this.launcher.nativeElement,
        wrapperEl: this.wrapper.nativeElement,
        getChatEl: () => this.chat?.nativeElement,

        isUiReady: () => this.uiReady,
        getConfiguredMode: () => this.mode,
        getPanelMode: () => this.panelMode,
        setPanelMode: (mode) => {
          this.panelMode = mode;
        },

        isDraggable: () => this.draggableEffective,
        isOpenOnHoverEnabled: () => this.openOnHoverEnabled,
        getHoverOpenDelayMs: () => this.hoverOpenDelayMs,

        isVideoEnabled: () => this.videoEnabled,
        hasMediaPlayed: () => this.mediaAlreadyPlayedThisPage,
        playVideoWithSoundOnce: () => this.playVideoWithSoundOnce(),
        armPlayOnFirstClickInside: (wrapper) => this.armPlayOnFirstClickInside(wrapper),
        stopLauncherVideo: () => this.stopLauncherVideo(),

        setOpenFlag: (open) => this.setOpenFlag(open),
        wasOpenBefore: () => this.wasOpenBefore(),
        persistOpenStateNow: () => this.persistOpenStateNow(),
      });

      // Always start closed and freshly docked — no auto-reopen from a
      // persisted flag (see launcher-position.service.ts). A stale flag left
      // over from an earlier page/session used to reopen the panel before
      // the button had a chance to lay out, sometimes landing it far from
      // the corner.
      this.bootReadyPromise.then(() => {
        this.positionController?.updateDock();
      });
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearBrandingSafetyTimer();
    this.positionController?.destroy();
    this.mediaArmCleanup?.();
    this.mediaArmCleanup = undefined;
    this.releaseLauncherVideo();

    // A resize in progress when the component goes away would otherwise leave
    // three window listeners behind, holding this instance alive.
    this.resizeCleanup?.();
    this.resizeCleanup = undefined;

    // ngAfterViewInit reparents the host element straight into document.body
    // (a fixed, full-viewport overlay has to live there, not wherever the
    // <blue-search-launcher> tag happened to be written). That works fine
    // for the usual case — the element sits there until the whole page
    // unloads — but it's never been torn down by Angular itself before: on
    // a real customer site this component is created once by the custom
    // element and never destroyed mid-session. Toggling it on/off from an
    // *ngIf inside this SPA (the admin's try-page preview) is the first
    // place Angular actually destroys a live instance, and it does so while
    // the host element still sits under document.body rather than under
    // the view that logically owns it — not where Angular's own view
    // removal expects to find it. Detaching it ourselves first, defensively,
    // means that mismatch can't turn into an uncaught DOM exception that
    // aborts the rest of Angular's teardown (and, with it, the navigation
    // that triggered this destroy) partway through.
    try {
      this.host.nativeElement.remove();
    } catch {
      // Already detached, or never got as far as being reparented — fine.
    }
  }

  private recomputeHistoryKey() {
    this.historyStorageKey = this.launcherStorage.buildHistoryStorageKey(
      this.appid,
      this.gptid,
    );
  }

  private updateUiReady() {
    const next = this.apiReady && this.attrReady && this.imagesReady;
    if (this.uiReady !== next) this.uiReady = next;

    // Resolving twice is a no-op, so no flag is needed to guard it.
    if (next) this.resolveUiReady?.();
  }

  private parseLauncherSizePx(v: any): number | undefined {
    if (v === null || v === undefined) return undefined;

    let n: number;
    if (typeof v === 'number') n = v;
    else {
      const s = String(v).trim().toLowerCase();
      if (!s) return undefined;
      const m = s.match(/^(\d+(?:\.\d+)?)\s*(px)?$/i);
      if (!m) return undefined;
      n = Number(m[1]);
    }

    if (!Number.isFinite(n)) return undefined;

    return Math.max(
      LauncherComponent.MIN_LAUNCHER_SIZE_PX,
      Math.min(LauncherComponent.MAX_LAUNCHER_SIZE_PX, Math.round(n)),
    );
  }

  private parseBoolLoose(v: any, fallback: boolean): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;

    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off', ''].includes(s)) return false;
    }

    return fallback;
  }

  private parseIntLoose(v: any, fallback: number): number {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);

    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  private nonEmpty(v: any): string | undefined {
    return this.launcherTypography.nonEmpty(v);
  }

  private sanitizeFontSize(v?: string): string | undefined {
    return this.launcherTypography.sanitizeFontSize(v);
  }

  private sanitizeLineHeight(v?: string): string | undefined {
    return this.launcherTypography.sanitizeLineHeight(v);
  }

  private sanitizeFontFamily(v?: string): string | undefined {
    return this.launcherTypography.sanitizeFontFamily(v);
  }

  // Behaviour comes from the app config alone; there are no host attributes to
  // blend with any more.
  get draggableEffective(): boolean {
    return this.apiDraggable;
  }

  get openOnHoverEnabled(): boolean {
    return this.apiOpenOnHover;
  }

  get hoverOpenDelayMs(): number {
    return Math.max(0, this.apiHoverOpenDelayMs);
  }

  get videoEnabled(): boolean {
    return !!this.apiVideoEnabled;
  }

  get computedLauncherVideoSrc(): string {
    const raw = (this.apiLauncherVideoSrc || '').trim();
    if (!raw) return '';

    // The downloaded copy once it exists, otherwise nothing yet — never the
    // remote URL. See downloadLauncherVideo(): putting the URL on the element
    // is what makes the browser stream it with Range requests, which is the
    // one thing the media endpoint does not serve.
    return this.launcherVideoObjectUrl || '';
  }

  // ============================================================
  // Panel resize
  //
  // The grip is the panel's TOP-LEFT corner, and that is not arbitrary. The
  // panel is anchored by right/bottom, computed from the launcher button
  // (positionPanel()), so its bottom-right corner belongs to the button and
  // must not move. Dragging the opposite corner is therefore the only handle
  // that changes size without fighting the anchor: left and up grow it, and
  // the arithmetic is two numbers rather than a box.
  //
  // Those two numbers are --bbc-compact-width/-height, which positionPanel()
  // re-reads every time it runs. So a resize survives window resizing, closing
  // and reopening, and the compact/full toggle with no extra bookkeeping.
  // ============================================================

  /**
   * The floor, and only a floor against nonsense.
   *
   * Was 280x320, picked as "the smallest panel that still reads well". That
   * was the wrong kind of judgement to encode: it stopped the panel shrinking
   * below roughly the size it opens at on a phone, so the grip appeared to
   * only work in one direction. Whether a small panel is worth having is the
   * visitor's call, not this component's.
   *
   * What remains is the size below which the panel stops being a window at
   * all — too small to show the grip and drag it back out again.
   */
  private static readonly MIN_PANEL_W = 180;
  private static readonly MIN_PANEL_H = 180;

  private resizeCleanup?: () => void;

  /**
   * Is the grip available?
   *
   * Compact mode, and that is the only condition. Full mode is the viewport,
   * which has no size to choose.
   *
   * It used to also require `matchMedia('(pointer: fine)')` and a viewport
   * wider than 600px, copied from the embed's rule for its own grip. Both were
   * wrong here. `pointer: fine` is false in device emulation and on any
   * touch-capable laptop, so a perfectly mouse-driven desktop lost the grip
   * with no way to tell why; and the width test hid the control on exactly the
   * narrow layouts where a visitor most wants a taller panel. A grip that is
   * sometimes absent for reasons the visitor cannot see is worse than one that
   * is occasionally awkward to grab.
   */
  protected get resizeHandleVisible(): boolean {
    return this.panelMode === 'compact';
  }

  /**
   * Drag the top-left corner to resize.
   *
   * Deltas are inverted — dragging left is a negative clientX delta and must
   * make the panel wider — because the corner being dragged is the one moving
   * away from the anchored corner.
   *
   * The size is written straight to the custom properties on every frame
   * rather than accumulated and applied at the end: a resize the visitor
   * cannot see while dragging is a resize they cannot aim.
   */
  protected beginPanelResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (!this.resizeHandleVisible) return;

    const wrapper = this.wrapper?.nativeElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect.width;
    const startH = rect.height;

    event.preventDefault();
    event.stopPropagation();

    try { (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId); } catch {}

    const onMove = (move: PointerEvent) => {
      // Capped at the viewport as well as the minimum: a panel wider than the
      // window cannot be dragged back, because the grip would be off-screen.
      const w = this.clampPanel(
        startW + (startX - move.clientX),
        LauncherComponent.MIN_PANEL_W,
        window.innerWidth - 32,
      );
      const h = this.clampPanel(
        startH + (startY - move.clientY),
        LauncherComponent.MIN_PANEL_H,
        window.innerHeight - 32,
      );

      this.applyPanelSize(w, h);
    };

    const finish = () => {
      this.resizeCleanup?.();
      this.resizeCleanup = undefined;

      // Persisted on release, not per frame: a drag is one decision, and a
      // write per pointermove would be hundreds of localStorage writes for it.
      const box = wrapper.getBoundingClientRect();
      this.persistPanelSize(box.width, box.height);
    };

    // Outside Angular: pointermove fires at frame rate and none of this
    // touches a binding — the size goes onto the element as a custom property.
    this.zone.runOutsideAngular(() => {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);

      this.resizeCleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };
    });
  }

  private clampPanel(value: number, min: number, max: number): number {
    return Math.round(Math.max(min, Math.min(max, value)));
  }

  /** Write the size and let the panel re-place itself against the button. */
  private applyPanelSize(w: number, h: number): void {
    const style = this.host.nativeElement.style;

    style.setProperty('--bbc-compact-width', `${w}px`);
    style.setProperty('--bbc-compact-height', `${h}px`);

    // Marks the size as chosen rather than configured. positionPanel()'s
    // narrow branch normally ignores these properties — it lays the panel out
    // between fixed side margins — and without this flag the grip would be
    // draggable on a narrow viewport and change nothing.
    this.wrapper?.nativeElement.classList.add('bbc-sized');

    this.positionController?.refreshPanel();
  }

  private persistPanelSize(w: number, h: number): void {
    const size = { w: Math.round(w), h: Math.round(h) };

    try {
      savePanelSize(
        { appId: this.appid, gptId: this.gptid, assistantId: this.assistantid },
        size,
      );
    } catch { /* storage is a convenience; the size still applies this visit */ }

    // Announced as well as stored, so a host page can do something else with
    // it — the demo page saves it to the app's config document rather than
    // leaving it in one visitor's browser. Composed, like bbc-opened, so it
    // crosses this component's shadow root; nobody listening is the normal
    // case and costs nothing.
    try {
      this.host.nativeElement.dispatchEvent(
        new CustomEvent('bbc-resized', { detail: size, bubbles: true, composed: true }),
      );
    } catch {}
  }

  /**
   * Re-apply a remembered size, if there is one.
   *
   * Called after applyPanelCssVars(), which writes the app's configured
   * compactWidth/compactHeight — and would otherwise put the visitor's own
   * size back to the default on every config refresh, which happens more than
   * once per page.
   */
  private applyStoredPanelSize(): void {
    let stored;
    try {
      stored = loadPanelSize({ appId: this.appid, gptId: this.gptid, assistantId: this.assistantid });
    } catch {
      return;
    }
    if (!stored) return;

    // Clamped on read as well as on write: the window may be smaller than it
    // was when this was stored, and a panel wider than the viewport has its
    // grip off-screen and cannot be dragged back.
    this.applyPanelSize(
      this.clampPanel(stored.w, LauncherComponent.MIN_PANEL_W, window.innerWidth - 32),
      this.clampPanel(stored.h, LauncherComponent.MIN_PANEL_H, window.innerHeight - 32),
    );
  }

  /** The blob: URL for the downloaded video, once it has arrived. */
  private launcherVideoObjectUrl = '';

  /** The src we downloaded, so a config refresh that changes nothing does not
   *  re-download, and one that changes the video does. */
  private launcherVideoFetchedFrom = '';

  /**
   * Fetch the launcher video in full, then play it from a blob URL.
   *
   * A <video src="https://..."> streams: the browser opens the file, reads the
   * header, and issues Range requests as it plays. Our media endpoint answers
   * 200 with the whole body and nothing else — deliberately, because partial
   * content is where a proxy like that earns its bugs — so Safari in
   * particular would get a file it cannot seek in and may refuse to start.
   *
   * Downloading first sidesteps all of it. The launcher plays a short clip
   * once per page load and never seeks, so there is nothing streaming was
   * buying. It also makes the frame-priming honest: a blob URL is local, so
   * readyState is reached immediately instead of after a network round trip
   * that primeVideoFrameOnce() has to time out on.
   *
   * Failure is silent and leaves launcherVideoObjectUrl empty, which puts the
   * template back on the default mark — the same place a video that fails to
   * decode already ends up.
   */
  private async downloadLauncherVideo(): Promise<void> {
    const raw = (this.apiLauncherVideoSrc || '').trim();
    const url = raw ? this.normalizeSrc(raw) : '';

    if (!url || !this.videoEnabled) {
      this.releaseLauncherVideo();
      this.launcherVideoFetchedFrom = '';
      return;
    }

    if (url === this.launcherVideoFetchedFrom) return;
    this.launcherVideoFetchedFrom = url;

    try {
      const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();

      // Another config may have landed while this was in flight; the last one
      // to be asked for wins, and this one's bytes are discarded.
      if (this.launcherVideoFetchedFrom !== url) return;

      this.releaseLauncherVideo();
      this.launcherVideoObjectUrl = URL.createObjectURL(blob);
    } catch {
      // Left empty on purpose — the launcher falls back to its icon.
      this.launcherVideoFetchedFrom = '';
      this.releaseLauncherVideo();
    }
  }

  /**
   * Playback finished — drop the downloaded copy and go back to the icon.
   *
   * The blob holds the whole file in memory, and a launcher video is tens of
   * megabytes. Keeping it after the clip has played buys nothing: it plays
   * once per page load (mediaAlreadyPlayedThisPage), so there is no second
   * playback to serve, and the visitor is left carrying the bytes for as long
   * as the tab is open.
   *
   * Clearing the object URL makes computedLauncherVideoSrc empty, so the
   * template falls through to the default mark. That is a visible change —
   * the launcher stops showing the video's final frame and shows its icon
   * instead — and it is the intended one: the clip is an introduction, not the
   * button's permanent appearance.
   */
  protected onLauncherVideoEnded(): void {
    this.releaseLauncherVideo();
  }

  /**
   * The video element's 'loadeddata'/'canplay' events, bound in the
   * template. Either means there is now a real frame to paint, so it's safe
   * to fade the video in over the icon. Both are bound (once each) because
   * browsers are inconsistent about which fires first for a given source,
   * and setting the same flag twice is harmless.
   */
  protected onLauncherVideoFrameReady(): void {
    // Runs on every 'loadeddata'/'canplay' (both bound to this handler,
    // since browsers are inconsistent about which fires first), because the
    // video element is recreated on every fresh download — see
    // primeVideoFrameOnce()'s own once-per-instance guard.
    this.primeVideoFrameOnce();

    const alreadyVisible = this.videoFrameVisible;
    this.videoFrameVisible = true;

    // The rest below (capturing a still for next time) only needs doing
    // once per frame — the second event for the same frame has nothing new
    // to capture.
    if (alreadyVisible) return;

    const video = this.launcherVideo?.nativeElement;
    if (!video) return;

    const preview = this.captureVideoFramePreview(video);
    if (preview) {
      this.launcherStorage.writeVideoFramePreview(preview, this.appid, this.gptid, this.assistantid);
    }
  }

  /**
   * Snapshots the video's current frame into a small cached still (see
   * LauncherStorageService.writeVideoFramePreview()), cropped the same way
   * the video itself is shown (object-fit: cover) so the cached still lines
   * up with what was actually on screen.
   *
   * Best-effort: returns undefined on any failure (an unsupported canvas
   * encode, or — in principle, though it shouldn't happen for a same-origin
   * blob: URL — a tainted canvas). Caching this frame is a nice-to-have for
   * the next visit, never something the launcher's current appearance
   * depends on.
   */
  private captureVideoFramePreview(video: HTMLVideoElement): string | undefined {
    try {
      const size = LauncherComponent.VIDEO_FRAME_PREVIEW_SIZE;
      const vw = video.videoWidth || size;
      const vh = video.videoHeight || size;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;

      const scale = Math.max(size / vw, size / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(video, (size - dw) / 2, (size - dh) / 2, dw, dh);

      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return undefined;
    }
  }

  /** Revokes the blob URL. Every path that replaces or drops the video goes
   *  through here, so the object is never left attached to a dead URL.
   *  Also resets videoFrameVisible, so the next video (a fresh blob, a fresh
   *  <video> element via *ngIf) starts invisible and fades in again rather
   *  than popping in from a stale true left over from the last one. */
  private releaseLauncherVideo(): void {
    this.videoFrameVisible = false;
    this.videoFramePrimed = false;
    if (!this.launcherVideoObjectUrl) return;

    try { URL.revokeObjectURL(this.launcherVideoObjectUrl); } catch {}
    this.launcherVideoObjectUrl = '';
  }

  /**
   * The panel's outer border — same colour as the header background, same
   * rule embed's .embed-shell border already follows (appOrWp?.headerBg ||
   * DEFAULT_WIDGET_THEME.headerBg). The panel and the chat it wraps fetch
   * their app config separately, so this reads this launcher's own
   * BluebootClient rather than the <blue-search> instance's appOrWp.
   */
  get wrapperBorderColor(): string {
    const headerBg = (this.blue?.widgetApp?.widgetParams as any)?.headerBg;
    return this.headerBg || headerBg || DEFAULT_WIDGET_THEME.headerBg;
  }

  /**
   * Applies wrapperBorderColor imperatively rather than via an Angular
   * `[style.borderColor]` binding on #bbc-wrapper. That binding used to sit
   * on the same element as the wrapper's static `style="..."` attribute —
   * mixing a static style string with any `[style.x]` binding on the same
   * element makes Angular track and reflush styling for it on every change
   * detection pass, which can reassert the element's *initial* static
   * values (the template's right/bottom/width/height) over whatever
   * LauncherPositionService had just computed. That reflush firing exactly
   * when opening the chat runs change detection is what was silently
   * wiping out the panel's real position/size right as it opened. Setting
   * this one property by hand keeps Angular from touching #bbc-wrapper's
   * style at all.
   */
  private applyWrapperBorderColor(): void {
    this.wrapper.nativeElement.style.borderColor = this.wrapperBorderColor;
  }

  /**
   * The launcher button icon.
   *
   * Whatever was applied from the API (launcherSrc / robotSrc / the assistant
   * avatar), else the embedded mark. Unlike the header logo or the
   * per-message avatars — which show nothing when the app hasn't configured
   * one — the launcher button IS the widget's only visible surface before
   * anyone opens it, so it can't just be blank. The fallback is compiled in,
   * so the button paints on the first frame.
   */
  get computedRobot(): string {
    return this.displayedRobotSrc || DEFAULT_LOGO_DATA_URI;
  }






  private get mediaAlreadyPlayedThisPage(): boolean {
    return this.launcherMedia.mediaAlreadyPlayedThisPage;
  }

  private set mediaAlreadyPlayedThisPage(v: boolean) {
    this.launcherMedia.mediaAlreadyPlayedThisPage = v;
  }

  /**
   * A configured icon failed to load — fall back to the embedded mark.
   *
   * Already showing it means there is nothing further to try, and since a data:
   * URI cannot fail to load this cannot loop.
   */
  onLauncherImgError() {
    if ((this.displayedRobotSrc || '') === DEFAULT_LOGO_DATA_URI) {
      this.imagesReady = true;
      this.updateUiReady();
      return;
    }

    this.zone.run(() => {
      this.displayedRobotSrc = DEFAULT_LOGO_DATA_URI;
      this.imagesReady = true;
      this.updateUiReady();
    });
  }

  private normalizeSrc(input?: string): string {
    return this.launcherMedia.normalizeSrc(input);
  }

  /**
   * Seeds the icon before anything is fetched. The app config may replace it
   * when getApp() lands; until then the embedded mark is already on screen.
   */
  private setInitialRobotFallback() {
    if (this.displayedRobotSrc) return;

    // A still from this exact app's launcher video, if one was cached the
    // last time it fully downloaded and decoded here (see
    // LauncherStorageService.readVideoFramePreview()). Showing that instead
    // of the generic mark means a page refresh — the case this was built
    // for — starts already looking like the video, so the eventual fade
    // from this still into the playing video reads as motion starting, not
    // as content changing.
    const cachedVideoFrame = this.launcherStorage.readVideoFramePreview(
      this.appid,
      this.gptid,
      this.assistantid,
    );

    this.displayedRobotSrc = cachedVideoFrame || DEFAULT_LOGO_DATA_URI;
    this.robotReady = Promise.resolve();
  }

  private async applyLauncherSrc(raw?: string): Promise<void> {
    const candidate = (raw ?? '').trim();
    if (!candidate) return;

    const normalized = this.normalizeSrc(candidate);

    if (!normalized || normalized === this.pendingRobotSrc || normalized === this.displayedRobotSrc) return;

    this.pendingRobotSrc = normalized;

    // Preload and fully decode off-screen before this ever touches the
    // visible src. Assigning the URL straight to displayedRobotSrc (the old
    // behaviour) swaps the <img> the instant the URL is known, not once the
    // bytes are actually in hand — the browser then has to fetch and decode
    // it live, which is exactly the blank/half-loaded flash between the
    // default mark and the real icon that visitors were seeing. Waiting on
    // decode() here means the only visible change is default -> finished
    // icon, the same all-or-nothing swap the launcher video already gets
    // from downloading its full blob before showing anything.
    try {
      const preload = new Image();
      preload.src = normalized;

      if (typeof preload.decode === 'function') {
        await preload.decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          preload.onload = () => resolve();
          preload.onerror = () => reject(new Error('launcher icon failed to load'));
        });
      }
    } catch {
      // Couldn't load/decode it — leave the default mark in place rather
      // than swapping to something broken.
      if (this.pendingRobotSrc === normalized) this.pendingRobotSrc = undefined;
      return;
    }

    // A newer config may have landed while this was in flight; the last one
    // requested wins, and this one's (now-decoded) image is discarded.
    if (this.pendingRobotSrc !== normalized) return;

    this.zone.run(() => {
      this.displayedRobotSrc = normalized;
    });

    this.pendingRobotSrc = undefined;
  }

  private setOpenFlag(v: boolean) {
    this.launcherStorage.setOpenFlag(v, this.appid, this.gptid);
  }

  private wasOpenBefore(): boolean {
    return this.launcherStorage.wasOpenBefore(this.appid, this.gptid);
  }

  /**
   * Only writes a var when something was actually configured (an explicit
   * @Input or an API value) — never the hardcoded DEFAULT_* fallback. Those
   * defaults exist so fontFamilyEffective/etc. always return a usable value
   * to whatever else reads them, but writing that fallback inline here
   * would permanently clobber chat.component.css's own :host default
   * (16px) and, with it, that stylesheet's mobile @media bump — exactly the
   * bug already fixed once for the launcher button's own size (see
   * launcher.component.ts's ngOnInit comment on setLauncherSize). With
   * nothing configured, this now writes nothing, and the chat panel's own
   * CSS decides — including scaling up on small screens.
   */
  private applyTypographyVars() {
    const ff = this.nonEmpty(this.fontFamily) || this.nonEmpty(this.apiFontFamily);
    const fs = this.nonEmpty(this.fontSize) || this.nonEmpty(this.apiFontSize);
    const lh = this.nonEmpty(this.lineHeight) || this.nonEmpty(this.apiLineHeight);

    this.launcherTypography.applyToElement(this.host.nativeElement, {
      fontFamily: ff ? this.sanitizeFontFamily(ff) : undefined,
      fontSize: fs ? this.sanitizeFontSize(fs) : undefined,
      lineHeight: lh ? this.sanitizeLineHeight(lh) : undefined,
    });
  }

  /**
   * Only writes a var when width/height was actually set — same reasoning
   * as applyTypographyVars() above: writing a fallback here would
   * permanently clobber launcher.component.css's own :host default
   * (360x520) with an inline style. With nothing configured, this writes
   * nothing, and whatever applyPanelCssVars() set from the API (or, if
   * that set nothing either, the CSS default) decides instead.
   */
  private applySizeOverrides(): void {
    const w = this.nonEmpty(this.width);
    const h = this.nonEmpty(this.height);
    const el = this.host.nativeElement;

    if (w) el.style.setProperty('--bbc-compact-width', this.sanitizeSize(w)!);
    if (h) el.style.setProperty('--bbc-compact-height', this.sanitizeSize(h)!);
  }

  /** A bare number ("400") is treated as pixels, same convention
   *  applyPanelCssVars() uses for compactWidth/compactHeight from the
   *  API. Anything else (already carrying a unit — "400px", "24rem",
   *  "80vw") is trusted as-is. */
  private sanitizeSize(v: string): string {
    return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
  }

  private applyApiTypography(wp: any) {
    const typography = this.launcherTypography.fromWidgetParams(wp);

    // Never writes into fontFamily/fontSize/lineHeight — those are the
    // explicit @Input overrides now, and must survive getApp() resolving
    // regardless of when it returns.
    this.apiFontFamily = typography.fontFamily;
    this.apiFontSize = typography.fontSize;
    this.apiLineHeight = typography.lineHeight;
  }

  private applyApiVideoConfig(wp: any) {
    if (typeof (wp as any).enableLauncherVideo !== 'undefined') {
      this.apiVideoEnabled = this.parseBoolLoose((wp as any).enableLauncherVideo, false);
    } else {
      this.apiVideoEnabled = undefined;
    }

    if (typeof (wp as any).launcherVideoSrc === 'string') {
      this.apiLauncherVideoSrc = String((wp as any).launcherVideoSrc || '').trim();
    } else {
      this.apiLauncherVideoSrc = undefined;
    }

    // Not awaited: the launcher must paint now, with its icon, and fade in
    // the video once the bytes land (see the template). downloadLauncherVideo()
    // is a no-op when the src has not changed, so the repeated config
    // refreshes this sits behind cost nothing.
    void this.downloadLauncherVideo();
  }

  private applyApiLauncherSize(wp: any) {
    const apiSize = this.parseLauncherSizePx((wp as any)?.launcherSize);

    if (typeof apiSize !== 'undefined') {
      this.apiLauncherSizePx = apiSize;
      this.launcherPosition.setLauncherSize(this.host.nativeElement, apiSize);
    } else {
      this.apiLauncherSizePx = undefined;
    }
  }

  private applyApiBehavior(wp: any) {
    this.apiOpenOnHover = this.parseBoolLoose((wp as any)?.openOnHover, false);
    this.apiHoverOpenDelayMs = Math.max(0, this.parseIntLoose((wp as any)?.hoverOpenDelayMs, 250));
    this.apiDraggable = (wp as any)?.draggable ?? false;

    // feedbackEnabled is not read here. The launcher has no feedback row of its
    // own — the row is on a message, inside the panel — and this used to copy
    // the flag onto a field nothing ever read, with its own `true` default that
    // disagreed with the panel's. ChatCoreComponent.feedbackVisibleFor is the
    // single place that decides.
  }

  /**
   * The launcher's own imagery. Role avatars and header-logo flags used to be
   * copied onto fields here and forwarded to the panel; the panel resolves them
   * from the app config itself now, so only the button image is left.
   */
  private applyApiBranding(wp: any) {
    // Only image-URL fields belong here. `roleAvatars` (as opposed to
    // `roleAvatarImages`) holds a letter/text fallback per shared-library's
    // model — not a URL — so using it as an <img> src fails to load, fires
    // onLauncherImgError(), and snaps straight back to the default logo. That
    // showed up as the launcher icon flashing in and disappearing immediately.
    const apiSrc =
      (wp as any)?.launcherSrc ??
      (wp as any)?.robotSrc ??
      ((wp as any)?.roleAvatarImages && (wp as any).roleAvatarImages['assistant']);

    if (apiSrc) {
      const p = this.applyLauncherSrc(apiSrc);
      this.robotReady = this.robotReady ? this.robotReady.then(() => p) : p;
    }
  }


  private markImagesReadyWhenDone() {
    Promise.allSettled([
      this.robotReady ?? Promise.resolve(),
      this.logoReady ?? Promise.resolve(),
    ]).then(() => {
      this.imagesReady = true;
      this.updateUiReady();
    });
  }

  /**
   * Forces the just-mounted <video> to actually paint its first frame.
   *
   * 'loadeddata'/'canplay' having fired (see onLauncherVideoFrameReady(),
   * which calls this) means the browser has decoded a frame, per spec — but
   * WebKit (iOS and desktop Safari alike) does not composite anything to
   * the screen for a <video> that has never played, decoded frame or not.
   * See LauncherMediaService.primeVideoFrameOnce() for why this runs on
   * every platform rather than only iOS.
   */
  private primeVideoFrameOnce() {
    if (this.videoFramePrimed) return;

    const video = this.launcherVideo?.nativeElement;
    if (!video) return;

    this.videoFramePrimed = true;

    this.launcherMedia.primeVideoFrameOnce(video, () => {
      if (!this.displayedRobotSrc) {
        this.applyLauncherSrc(DEFAULT_LOGO_DATA_URI);
      }
    });
  }

  private playVideoWithSoundOnce() {
    if (!this.videoEnabled) return;

    const played = this.launcherMedia.playVideoWithSoundOnce(this.launcherVideo?.nativeElement);
    if (!played) return;

    this.mediaArmCleanup?.();
    this.mediaArmCleanup = undefined;
  }

  private armPlayOnFirstClickInside(wrapperEl: HTMLElement) {
    if (!this.videoEnabled) return;
    if (this.mediaAlreadyPlayedThisPage) return;
    if (this.mediaArmCleanup) return;

    const handler = () => this.playVideoWithSoundOnce();

    wrapperEl.addEventListener('pointerdown', handler, true);
    wrapperEl.addEventListener('click', handler, true);

    this.mediaArmCleanup = () => {
      wrapperEl.removeEventListener('pointerdown', handler, true);
      wrapperEl.removeEventListener('click', handler, true);
    };
  }

  private stopLauncherVideo() {
    this.launcherMedia.stopVideo(this.launcherVideo?.nativeElement);
  }



  private persistOpenStateNow() {
    try {
      const wrapperEl = this.wrapper?.nativeElement;
      const isOpen = !!wrapperEl && !wrapperEl.hasAttribute('hidden');

      this.setOpenFlag(isOpen);
    } catch {}
  }
}
