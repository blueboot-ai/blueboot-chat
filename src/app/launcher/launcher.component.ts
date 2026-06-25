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
import { ChatComponent } from '../chat/chat.component';
import { BluebootService } from '../services/blueboot.service';
import { Settings } from '../settings';
import { normalizeLangCode, i18nPick, mergeTranslations } from './services/launcher-i18n.utils';
import { LauncherStorageService } from './services/launcher-storage.service';
import { LauncherTypographyService } from './services/launcher-typography.service';
import { LauncherMediaService } from './services/launcher-media.service';
import {
  LauncherPanelMode,
  LauncherPositionController,
  LauncherPositionService,
} from './services/launcher-position.service';

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
  private static readonly DEFAULT_FONT_FAMILY =
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  private static readonly DEFAULT_FONT_SIZE = '14px';
  private static readonly DEFAULT_LINE_HEIGHT = '1.45';

  private static readonly DEFAULT_LAUNCHER_SIZE_PX = 64;
  private static readonly MIN_LAUNCHER_SIZE_PX = 40;
  private static readonly MAX_LAUNCHER_SIZE_PX = 300;

  public uiReady = false;
  private apiReady = false;
  private attrReady = false;
  private imagesReady = false;

  public isIOSDevice = false;
  public historyStorageKey = '';

  private resolveBootReady!: () => void;
  private bootReadyPromise = new Promise<void>((res) => (this.resolveBootReady = res));

  private apiDraggable = true;
  private apiOpenOnHover = false;
  private apiHoverOpenDelayMs = 250;
  private apiFeedbackEnabled = true;
  private apiLauncherSizePx?: number;
  private apiVideoEnabled?: boolean;
  private apiLauncherVideoSrc?: string;

  public panelMode: LauncherPanelMode = 'compact';

  @Input('launcher-size') launcherSizeOpt?: number | string;
  @Input('draggable') draggableOpt: boolean | string | undefined;
  @Input('open-on-hover') openOnHoverOpt: boolean | string | undefined;
  @Input('hover-open-delay-ms') hoverOpenDelayMsOpt: number | string | undefined;

  @Input() mode: LauncherPanelMode = 'compact';

  @Input() appid?: string;
  @Input() env?: string;
  @Input() userid?: string;
  @Input() gptid?: string;
  @Input() assistandid?: string;
  @Input() apikey?: string;

  @Input() lang: string = 'no';
  @Input() defaultLang: string = 'en';

  @Input() translations?: Partial<Record<string, any>>;
  @Input() title = 'Assistant';
  @Input() logosrc?: string;
  @Input() logoalt?: string;
  @Input() welcometext?: string;

  @Input() robotsrc?: string;

  @Input() rolelabels?: Partial<Record<'user' | 'assistant' | 'error', string>> | string;
  @Input() roleavatars?: Partial<Record<'user' | 'assistant' | 'error', string>> | string;
  @Input() roleavatarimgs?: Partial<Record<'user' | 'assistant' | 'error', string>> | string;
  @Input() roleavatarbg?: Partial<Record<'user' | 'assistant' | 'error', string>> | string;

  @Input() headerlogobg?: string;
  @Input() headerlogoround?: boolean | string;
  @Input() headerlogoinitial?: boolean | string;

  @Input() username?: string;
  @Input() persist: boolean = true;

  @Input() fontFamily?: string;
  @Input() fontSize?: string;
  @Input() lineHeight?: string;
  @Input('font-family') fontFamilyAttr?: string;
  @Input('font-size') fontSizeAttr?: string;
  @Input('line-height') lineHeightAttr?: string;
  @Input('feedback-enabled') feedbackEnabledOpt: boolean | string | undefined;

  @Input('enable-video') enableVideoOpt: boolean | string | undefined;
  @Input('enable-launcher-video') enableLauncherVideoOpt: boolean | string | undefined;
  @Input('launcher-video-src') launcherVideoSrc?: string;
  @Input('videosrc') videosrc?: string;

  @ViewChild('launcher', { static: true }) launcher!: ElementRef<HTMLButtonElement>;
  @ViewChild('wrapper', { static: true }) wrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('chat', { read: ElementRef }) chat?: ElementRef<HTMLElement>;
  @ViewChild('launcherVideo', { read: ElementRef }) launcherVideo?: ElementRef<HTMLVideoElement>;

  private blue!: BluebootService;
  private displayedRobotSrc = '';
  private pendingRobotSrc?: string;
  private robotReady?: Promise<void>;
  private logoReady?: Promise<void>;
  private mediaArmCleanup?: () => void;
  private iosPrimeDone = false;
  private positionController?: LauncherPositionController;

  constructor(
    private zone: NgZone,
    private host: ElementRef<HTMLElement>,
    private launcherStorage: LauncherStorageService,
    private launcherTypography: LauncherTypographyService,
    private launcherMedia: LauncherMediaService,
    private launcherPosition: LauncherPositionService,
  ) {
    Settings.setPublicUrl(this.env);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appid'] || changes['gptid'] || changes['userid']) {
      this.recomputeHistoryKey();
    }
  }

  async ngOnInit() {
    this.isIOSDevice = this.launcherMedia.isIOS();
    this.recomputeHistoryKey();
    this.applyTypographyVars();

    const attrSize = this.parseLauncherSizePx(this.launcherSizeOpt);
    this.applyLauncherSizeCssVar(attrSize ?? LauncherComponent.DEFAULT_LAUNCHER_SIZE_PX);

    this.setInitialRobotFallback();

    const w = window as any;
    const urlBackend = (w && w.__BLUE_SEARCH_BACKEND) || Settings.publicApiUrl() || '';
    this.blue = new BluebootService(urlBackend, this.userid, undefined, this.appid, this.gptid);

    try {
      await this.blue.getApp?.();

      const app = this.blue.widgetApp;
      const wp = this.blue.widgetApp?.widgetParams ?? {};

      this.applyApiVideoConfig(wp);
      this.applyApiLauncherSize(wp);
      this.applyApiI18n(wp, app);
      this.applyApiBehavior(wp);
      this.applyApiTypography(wp);
      this.applyApiPanelCssVars(wp);
      this.applyApiBranding(wp);

      this.logoReady = Promise.resolve();
      this.applyTypographyVars();

      this.apiReady = true;
    } catch (e) {
      console.warn('Launcher: getApp failed; falling back.', e);
      this.apiReady = true;
    } finally {
      this.markImagesReadyWhenDone();
      this.updateUiReady();
      this.resolveBootReady?.();
    }
  }

  ngAfterViewInit(): void {
    const hostEl = this.host.nativeElement as HTMLElement;

    if (hostEl.parentElement !== document.body) {
      document.body.appendChild(hostEl);
    }

    Object.assign(hostEl.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'block',
    });

    this.applyTypographyVars();

    this.attrReady = true;
    this.updateUiReady();

    const prime = () => this.primeIOSFrameOnce();
    if (this.uiReady) setTimeout(prime, 0);
    else this.bootReadyPromise.then(() => setTimeout(prime, 0));

    this.zone.runOutsideAngular(() => {
      this.launcher.nativeElement.style.pointerEvents = 'auto';
      this.wrapper.nativeElement.style.pointerEvents = 'auto';

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
        pushLangToChat: () => this.pushLangToChat(),
      });

      this.bootReadyPromise.then(() => {
        if (this.wasOpenBefore()) {
          this.positionController?.open(false);
        } else {
          this.positionController?.updateDock();
          this.pushLangToChat();
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.positionController?.destroy();
    this.mediaArmCleanup?.();
    this.mediaArmCleanup = undefined;
  }

  private recomputeHistoryKey() {
    this.historyStorageKey = this.launcherStorage.buildHistoryStorageKey(
      this.appid,
      this.gptid,
      this.userid,
    );
  }

  private updateUiReady() {
    const next = this.apiReady && this.attrReady && this.imagesReady;
    if (this.uiReady !== next) this.uiReady = next;
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

  private applyLauncherSizeCssVar(px: number | undefined) {
    const n = px ?? LauncherComponent.DEFAULT_LAUNCHER_SIZE_PX;
    this.host.nativeElement.style.setProperty('--bbc-launcher-size', `${n}px`);
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

  private coerceBool(v: boolean | string | undefined, fallback = false): boolean {
    return this.parseBoolLoose(v, fallback);
  }

  private overrideStr(current: string | undefined, inputOverride?: string) {
    const ok = typeof inputOverride === 'string' && inputOverride.trim().length > 0;
    return ok ? inputOverride : current;
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

  get draggableEffective(): boolean {
    const v = this.draggableOpt;

    if (typeof v === 'boolean') return v;

    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off'].includes(s)) return false;
    }

    return this.apiDraggable;
  }

  get openOnHoverEnabled(): boolean {
    if (typeof this.openOnHoverOpt !== 'undefined') {
      return this.parseBoolLoose(this.openOnHoverOpt, false);
    }

    return this.apiOpenOnHover;
  }

  get hoverOpenDelayMs(): number {
    if (typeof this.hoverOpenDelayMsOpt !== 'undefined') {
      return Math.max(0, this.parseIntLoose(this.hoverOpenDelayMsOpt, 250));
    }

    return Math.max(0, this.apiHoverOpenDelayMs);
  }

  get feedbackEnabledEffective(): boolean {
    if (typeof this.apiFeedbackEnabled === 'boolean') {
      return this.apiFeedbackEnabled;
    }

    if (typeof this.feedbackEnabledOpt !== 'undefined') {
      return this.parseBoolLoose(this.feedbackEnabledOpt, true);
    }

    return true;
  }

  get fontFamilyEffective() {
    return this.nonEmpty(this.fontFamily) ||
      this.nonEmpty(this.fontFamilyAttr) ||
      LauncherComponent.DEFAULT_FONT_FAMILY;
  }

  get fontSizeEffective() {
    return (
      this.sanitizeFontSize(this.nonEmpty(this.fontSize) || this.nonEmpty(this.fontSizeAttr)) ||
      LauncherComponent.DEFAULT_FONT_SIZE
    );
  }

  get lineHeightEffective() {
    return (
      this.sanitizeLineHeight(this.nonEmpty(this.lineHeight) || this.nonEmpty(this.lineHeightAttr)) ||
      LauncherComponent.DEFAULT_LINE_HEIGHT
    );
  }

  get videoEnabled(): boolean {
    if (typeof this.apiVideoEnabled !== 'undefined') return !!this.apiVideoEnabled;

    const a = this.parseBoolLoose(this.enableVideoOpt, false);
    const b = this.parseBoolLoose(this.enableLauncherVideoOpt, false);

    return a || b;
  }

  get computedLauncherVideoSrc(): string {
    const raw = (this.apiLauncherVideoSrc || this.launcherVideoSrc || this.videosrc || '').trim();
    if (!raw) return '';

    return this.normalizeSrc(raw);
  }

  get computedRobot(): string {
    return (
      this.displayedRobotSrc ||
      this.normalizeSrc(this.robotsrc, 'img/robot.png') ||
      'assets/img/robot.png'
    );
  }

  get computedLogo(): string {
    return this.normalizeSrc(this.logosrc) || '';
  }

  get headerLogoRoundCoerced(): boolean {
    return this.coerceBool(this.headerlogoround, false);
  }

  get headerLogoInitialCoerced(): boolean {
    return this.coerceBool(this.headerlogoinitial, false);
  }

  get parsedRoleLabels() {
    return this.parseRoleMap(this.rolelabels);
  }

  get parsedRoleAvatars() {
    return this.parseRoleMap(this.roleavatars);
  }

  get parsedRoleAvatarImages() {
    return this.parseRoleMap(this.roleavatarimgs);
  }

  get parsedRoleAvatarBg() {
    return this.parseRoleMap(this.roleavatarbg);
  }

  private get mediaAlreadyPlayedThisPage(): boolean {
    return this.launcherMedia.mediaAlreadyPlayedThisPage;
  }

  private set mediaAlreadyPlayedThisPage(v: boolean) {
    this.launcherMedia.mediaAlreadyPlayedThisPage = v;
  }

  private get assetsBase(): string {
    const w = window as any;

    let base = (w && w.__BLUE_SEARCH_ASSETS_BASE) as string | undefined;
    if (!base) base = 'assets/';

    return base.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  }

  onLauncherImgError() {
    const current = this.displayedRobotSrc || '';

    if (current.includes('assets/img/robot.png')) {
      this.imagesReady = true;
      this.updateUiReady();
      return;
    }

    this.zone.run(() => {
      this.displayedRobotSrc = 'assets/img/robot.png';
      this.imagesReady = true;
      this.updateUiReady();
    });
  }

  private normalizeSrc(input?: string, fallbackFile?: string): string {
    return this.launcherMedia.normalizeSrc(input, this.assetsBase, fallbackFile);
  }

  private setInitialRobotFallback() {
    if (this.displayedRobotSrc) return;

    const fallbackRobot =
      this.normalizeSrc(this.robotsrc, 'img/robot.png') ||
      'assets/img/robot.png';

    this.displayedRobotSrc = fallbackRobot;
    this.robotReady = Promise.resolve();
  }

  private setOpenFlag(v: boolean) {
    this.launcherStorage.setOpenFlag(v, this.appid, this.gptid, this.userid);
  }

  private wasOpenBefore(): boolean {
    return this.launcherStorage.wasOpenBefore(this.appid, this.gptid, this.userid);
  }

  private applyTypographyVars() {
    this.launcherTypography.applyToElement(this.host.nativeElement, {
      fontFamily: this.sanitizeFontFamily(this.fontFamilyEffective) || LauncherComponent.DEFAULT_FONT_FAMILY,
      fontSize: this.sanitizeFontSize(this.fontSizeEffective) || LauncherComponent.DEFAULT_FONT_SIZE,
      lineHeight: this.sanitizeLineHeight(this.lineHeightEffective) || LauncherComponent.DEFAULT_LINE_HEIGHT,
    });
  }

  private applyApiTypography(wp: any) {
    const typography = this.launcherTypography.fromWidgetParams(wp);

    this.fontFamily = typography.fontFamily;
    this.fontSize = typography.fontSize;
    this.lineHeight = typography.lineHeight;
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
  }

  private applyApiLauncherSize(wp: any) {
    const apiSize = this.parseLauncherSizePx((wp as any)?.launcherSize);

    if (typeof apiSize !== 'undefined') {
      this.apiLauncherSizePx = apiSize;
      this.applyLauncherSizeCssVar(apiSize);
    } else {
      this.apiLauncherSizePx = undefined;
    }
  }

  private applyApiBehavior(wp: any) {
    this.apiOpenOnHover = this.parseBoolLoose((wp as any)?.openOnHover, false);
    this.apiHoverOpenDelayMs = Math.max(0, this.parseIntLoose((wp as any)?.hoverOpenDelayMs, 250));
    this.apiDraggable = (wp as any)?.draggable ?? true;
    this.apiFeedbackEnabled = this.parseBoolLoose((wp as any)?.feedbackEnabled, true);
  }

  private applyApiPanelCssVars(wp: any) {
    const style = this.host.nativeElement.style;

    if (wp?.compactWidth) style.setProperty('--bbc-compact-width', `${wp.compactWidth}px`);
    if (wp?.compactHeight) style.setProperty('--bbc-compact-height', `${wp.compactHeight}px`);
    if (wp?.sideOffset != null) style.setProperty('--bbc-side-offset', `${wp.sideOffset}px`);
    if (wp?.gap != null) style.setProperty('--bbc-gap', `${wp.gap}px`);
  }

  private applyApiBranding(wp: any) {
    this.roleavatars = (wp as any)?.roleAvatars ?? (this.roleavatars as any);
    this.roleavatarimgs = (wp as any)?.roleAvatarImages ?? (this.roleavatarimgs as any);
    this.roleavatarbg = (wp as any)?.roleAvatarBg ?? (this.roleavatarbg as any);

    this.headerlogobg = this.overrideStr(this.headerlogobg, (wp as any).headerLogoBg);
    this.headerlogoround =
      typeof this.headerlogoround !== 'undefined' ? this.headerlogoround : (wp as any).headerLogoRound;
    this.headerlogoinitial =
      typeof this.headerlogoinitial !== 'undefined' ? this.headerlogoinitial : (wp as any).headerLogoInitial;

    const apiSrc =
      (wp as any)?.launcherSrc ??
      (wp as any)?.robotSrc ??
      ((wp as any)?.roleAvatarImages && (wp as any).roleAvatarImages['assistant']) ??
      ((wp as any)?.roleAvatars && (wp as any).roleAvatars['assistant']);

    if (apiSrc) {
      const p = this.applyLauncherSrc(apiSrc);
      this.robotReady = this.robotReady ? this.robotReady.then(() => p) : p;
    }
  }

  private applyApiI18n(wp: any, app: any) {
    const apiLangRaw = (wp?.lang ?? (app as any)?.lang) as string | undefined;
    const hostLangAttr = this.host.nativeElement.getAttribute('lang');

    const apiDefaultRaw = (wp?.defaultLang ?? (app as any)?.defaultLang) as string | undefined;
    const hostDefaultAttr =
      this.host.nativeElement.getAttribute('default-lang') ||
      this.host.nativeElement.getAttribute('data-default-lang');

    this.defaultLang = normalizeLangCode(hostDefaultAttr || apiDefaultRaw || this.defaultLang || 'en');
    this.lang = normalizeLangCode(apiLangRaw || hostLangAttr || this.lang || this.defaultLang || 'no');

    const apiTransAll = (wp?.translations ?? (app as any)?.translations ?? {}) as Record<string, any>;

    this.translations = apiTransAll && Object.keys(apiTransAll).length
      ? mergeTranslations(this.translations, apiTransAll, this.translations)
      : (this.translations || {});

    const t =
      i18nPick<string>(wp, this.lang, 'title') ??
      i18nPick<string>(wp, this.defaultLang, 'title');

    const w =
      i18nPick<string>(wp, this.lang, 'welcomeText') ??
      i18nPick<string>(wp, this.defaultLang, 'welcomeText');

    if (typeof t === 'string' && t.trim()) this.title = t.trim();
    if (typeof w === 'string') this.welcometext = w;

    const roleLabelsL =
      i18nPick<Record<'user' | 'assistant' | 'error', string>>(wp, this.lang, 'roleLabels') ??
      i18nPick<Record<'user' | 'assistant' | 'error', string>>(wp, this.defaultLang, 'roleLabels') ??
      (wp as any)?.roleLabels;

    if (roleLabelsL) this.rolelabels = roleLabelsL as any;

    this.pushLangToChat();
  }

  private parseRoleMap(v: any): Record<'user' | 'assistant' | 'error', string> | undefined {
    if (!v) return undefined;

    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return undefined;
      }
    }

    return v as Record<'user' | 'assistant' | 'error', string>;
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

  private async applyLauncherSrc(raw?: string): Promise<void> {
    const candidate = (raw ?? '').trim();
    if (!candidate) return;

    const normalized = this.normalizeSrc(candidate);

    if (!normalized || normalized === this.pendingRobotSrc || normalized === this.displayedRobotSrc) return;

    this.pendingRobotSrc = normalized;

    this.zone.run(() => {
      this.displayedRobotSrc = normalized;
    });

    this.pendingRobotSrc = undefined;
  }

  private primeIOSFrameOnce() {
    if (!this.isIOSDevice) return;
    if (this.iosPrimeDone) return;

    const video = this.launcherVideo?.nativeElement;
    if (!video) return;

    this.iosPrimeDone = true;

    this.launcherMedia.primeIOSFrameOnce(video, () => {
      if (!this.displayedRobotSrc) {
        const fallbackRobot = this.normalizeSrc(this.robotsrc, 'img/robot.png');
        if (fallbackRobot) this.applyLauncherSrc(fallbackRobot);
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

  private pushLangToChat() {
    const el = this.chat?.nativeElement as HTMLElement | undefined;
    if (!el) return;

    el.setAttribute('data-lang', (this.lang || 'no').toLowerCase());

    el.dispatchEvent(
      new CustomEvent('bbc-lang-changed', {
        bubbles: true,
        composed: true,
        detail: {
          lang: this.lang || 'no',
          defaultLang: this.defaultLang || 'en',
          translations: this.translations || {},
        },
      }),
    );
  }

  private persistOpenStateNow() {
    try {
      const wrapperEl = this.wrapper?.nativeElement;
      const isOpen = !!wrapperEl && !wrapperEl.hasAttribute('hidden');

      this.setOpenFlag(isOpen);
    } catch {}
  }
}
