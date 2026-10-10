// The inline "search bar + conversation" widget, `<blue-search-embed-base>`.
//
// One component, one shadow root, one app-config fetch. It was two nested
// components, which cost a second shadow root, a duplicate getApp() and a
// `closest(...)` hack to push CSS vars across the boundary.
//
// The `-2` suffix namespaces widget2's elements so they can coexist with
// widget/'s on one page.

import {
  Component,
  HostBinding,
  ViewChild,
  ViewEncapsulation,
  ElementRef,
  NgZone,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  DoCheck,
  effect,
  EventEmitter,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ChatCoreComponent } from '../core/chat-core.component';
import { MessageComponent } from '../core/components/message/message.component';
import { LangPickerComponent } from '../core/components/lang-picker/lang-picker.component';
import { ComposerComponent } from '../core/components/composer/composer.component';
import { SuggestionChipsComponent } from '../core/components/suggestion-chips/suggestion-chips.component';
import {
  buildEmbedOverlayKey,
  loadWindowBox,
  saveWindowBox,
} from '../core/services/chat-storage.functions';
import { publishWidgetOpen } from '../core/services/widget-status';
import {
  EDGE_MARGIN,
  EmbedWindowBox,
  MIN_W,
  canUseFixed,
  clampBox,
} from './embed-window.functions';
import {
  MOBILE_QUERY,
  isMobileViewport,
  lockBodyScroll,
  unlockBodyScroll,
} from './body-scroll-lock.functions';
import { DEFAULT_WIDGET_THEME } from '../core/theme/default-widget-theme';
import { onHostNavigation } from '../core/services/host-navigation';
import { iconModeMarkFor } from '../core/assets/default-logo';

export type EmbedViewState = 'inline' | 'overlay';

/** How the widget presents itself on load — see EmbedComponent.startMode. */
export type EmbedStartMode = 'inline' | 'popup' | 'icon' | 'docked';

/**
 * Read a host page's `startmode` attribute as one of the four modes.
 *
 * Anything unrecognised is inline, and that asymmetry is deliberate: inline is
 * the mode that works everywhere and the one an existing embed already has, so
 * it is what an unreadable answer should land on.
 *
 * It exists because the attribute is typed as the union but arrives as a
 * string from someone else's markup. `startmode="Popup"` — or a typo, or the
 * value left as a template placeholder — used to be stored verbatim, and then
 * matched neither `=== 'popup'` nor `=== 'inline'`: the widget behaved as
 * inline everywhere it asked "is this popup", and as popup nowhere, which is
 * almost inline but not quite, and silent either way.
 */
function normalizeStartMode(value: unknown): EmbedStartMode {
  const raw = String(value ?? '').trim().toLowerCase();

  return raw === 'popup' || raw === 'icon' || raw === 'docked' ? raw : 'inline';
}

/**
 * What the embed template needs, named once.
 *
 * `@Component` is not inherited, so the per-mode subclasses (embed-inline,
 * embed-popup, embed-icon) each repeat the decorator and would each have
 * repeated this list. Four copies of it is four chances to add a child
 * component here and have three of the modes fail to render it — a failure
 * that shows up only in the mode nobody opened while testing.
 */
export const EMBED_VIEW_IMPORTS = [
  MessageComponent,
  LangPickerComponent,
  ComposerComponent,
  SuggestionChipsComponent,
  CommonModule,
  FormsModule,
];

@Component({
  selector: 'blue-search-embed-base',
  standalone: true,
  imports: EMBED_VIEW_IMPORTS,
  templateUrl: './embed.component.html',
  styleUrls: ['./embed.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EmbedComponent extends ChatCoreComponent
  implements OnInit, OnChanges, OnDestroy, DoCheck
{
  // Inputs — appid, and nothing else. Everything else comes from the ?query
  // string or the app config.
  //
  // Extending ChatCoreComponent (which declares no @Input) is what allows that.
  // Never add an @Input to the core to share it with the panel: Angular merges
  // input metadata down the prototype chain and it would reappear here for good.

  @Input('appid')   declare appId?:  string;
  /**
   * The backend serving this assistant, as a full base URL.
   *
   *     <blue-search-embed-base appid="..." envurl="https://api.partner.example">
   *
   * Leave it out and the widget uses the standard backend, which is right for
   * almost every install. Set it when the assistant is served by a different
   * one — a partner running their own instance, say.
   *
   * The first widget on the page to supply one fixes it for that page, and it
   * cannot change until the page reloads: swapping backends under a running
   * conversation splits its history, its stored files and any live agent
   * session across two servers.
   */
  @Input('envurl')  declare envUrl?: string;
  @Input('gptid')   declare gptId?:  string;


  /**
   * Which installation this is, when a page has more than one widget.
   *
   *     <blue-search-embed-base appid="..." assistantid="support"></blue-search-embed-base>
   *     <blue-search-embed-base appid="..." assistantid="sales"></blue-search-embed-base>
   *
   * Two widgets for the same app and gpt otherwise share everything that is
   * keyed by app and gpt: the conversation history, the open flag, the visitor
   * cache, the panel placement. They are the same conversation shown twice —
   * typing in one appears in the other, and clearing one clears both. This
   * separates them.
   *
   * Any stable string the site chooses; it never leaves the browser and is not
   * sent to the backend, so it needs no registration and means nothing beyond
   * "this widget, not that one".
   *
   * Optional. Left out, the keys are exactly what they were before this
   * existed, so a site with one widget keeps every visitor's history across the
   * upgrade.
   */
  @Input('assistantid') declare assistantId?: string;

  // Embed defaults that differ from the core's.
  @Input('lang')          override lang: string = '';

  /**
   * The language for this widget: `defaultlang="no"`.
   *
   * Selects, it does not merely fall back. It ranks above the host page's
   * stored preference and above the browser — it is the most specific thing
   * anyone has said, being on this element — and below a language the visitor
   * chose in the widget itself, which is the only statement made by the person
   * reading it. Hence "default": it is for visitors who have not chosen.
   *
   * Empty by default, not DEFAULT_LANG. With the built-in default sitting in
   * the field there is no way to tell "the site asked for English" from "the
   * site said nothing", and the second must not outrank the visitor's browser.
   */
  @Input('defaultlang')   override defaultLang: string = '';

  // Optional typography overrides. When set, these win over both the
  // hardcoded default and whatever getApp()/widgetParams supplies — see the
  // pick() ordering in applyEmbedTypographyVarsFrom() below, which checks
  // these first.
  @Input('fontsize')      declare fontSize?: string;
  @Input('fontfamily')    declare fontFamily?: string;
  @Input('lineheight')    declare lineHeight?: string;

  /**
   * Type for the icon-mode button, separately from the conversation's.
   *
   *     <blue-search-embed-base startmode="icon" iconfontsize="14px"
   *                             iconfontfamily="inherit" ...>
   *
   * The two are the same decision everywhere else in the widget, and in icon
   * mode they stop being: the button is a mark and a name sitting in a host
   * page's own header, among that page's own links, while fontsize is chosen
   * for reading a conversation in a panel. A size that is right for the answer
   * text is usually a size too large for a nav entry.
   *
   * Unset falls back to fontsize, so an embed that says nothing about this is
   * unchanged. `inherit` is a legitimate value for the family, and is the one
   * to reach for when the point is to match the bar: the host page's own font
   * then reaches the button, which nothing else in the widget allows — the
   * widget states its own type precisely so a customer's stylesheet cannot
   * reshape the conversation.
   */
  @Input('iconfontsize')   declare iconFontSize?: string;
  @Input('iconfontfamily') declare iconFontFamily?: string;

  // Optional color overrides — same precedence: explicit input wins over
  // both the hardcoded DEFAULT_THEME and whatever getApp()/widgetParams
  // supplies via appOrWp.
  //
  // headerBg is gone, and headerText never existed here. The embed has no
  // coloured chrome to apply them to: its title bar is transparent by design,
  // so the widget sits inside a host page's own look rather than painting a
  // band of its own over it. headerBg's only remaining job was tinting the
  // frame ring, which now derives from the theme like everything else — see
  // --bb-frame-color in embed.component.css.
  //
  // Still live on the launcher and the panel, which do have a header bar.
  @Input('backcolor')     declare backColor?: string;

  // fontcolor is gone. It set every piece of text in the widget, independently
  // of backcolor and messagecolor — so "white text on a white background" was a
  // configuration the widget could not refuse, and it failed silently because
  // each of the two settings was individually reasonable. Text is now derived
  // from the surface it is painted on, everywhere: --bb-surface-text off the
  // background, --bb-input-chrome off the message colour. An existing
  // fontcolor="..." in a customer's markup is simply ignored.

  /**
   * Background of the message bubbles in the conversation.
   *
   *     <blue-search-embed-base messagecolor="#ffffff" ...>
   *
   * Unset, the bubbles are white. They used to take backColor, which left a
   * widget with a tinted card showing no bubbles at all — message and ground
   * the same colour, with only spacing between them.
   *
   * Separate from backColor because the two are not always the same wish: a
   * tinted card with white message bubbles is an ordinary look, and until now
   * the only way to get it was to leave the card white and lose the tint.
   */
  @Input('messagecolor')  declare messageColor?: string;

  /**
   * The name shown in the panel's title bar.
   *
   *     <blue-search-embed-base title="Ask our team" ...>
   *
   * Outranks both other sources: the backend's configured title (getApp →
   * applyConfig) and the compiled-in language packs. A host that names its own
   * widget means it, and the two things that would otherwise overwrite it both
   * fire *after* mount — the config when it resolves, the pack again on every
   * language change — so this cannot be a plain assignment. It is held as
   * titleOverride and applied through setTitle(), which every writer goes
   * through.
   *
   * The consequence to know about: a fixed title does not translate. That is
   * the trade the parameter exists to make — the alternative is passing 18
   * translations for a phrase the host has already decided on.
   *
   * A setter rather than a field so a title arriving late, or changing, still
   * takes effect: writing titleOverride alone would leave this.title holding
   * whatever the pack or the config last put there.
   */
  @Input('title')
  set titleInput(value: string | undefined) {
    this.titleOverride = (value || '').trim();

    // Re-resolve immediately. setTitle('') keeps the current title when there
    // is no override, so clearing the input falls back to whatever the config
    // and packs last resolved rather than blanking the bar.
    this.setTitle(this.title);
  }

  // Optional size overrides for the outer box. embed.component.css's
  // :host defaults to width:100% (fills whatever container it's placed
  // in) and an auto height (grows with content); setting either here
  // pins that dimension instead. Bound via @HostBinding rather than a
  // [style.--x] var, since — unlike the launcher, which has an ancestor
  // shadow host that can shadow a plain default — nothing here can
  // clobber an inline style set directly on embed's own host, and an
  // *unset* input correctly falls through to leave the CSS default
  // alone (HostBinding omits the style property entirely when the
  // getter returns null/undefined).
  @Input('width')  width?: string;
  @Input('height') height?: string;

  /**
   * How the widget presents itself on load.
   *
   * 'inline' (the default) is the original behaviour: a plain input box in the
   * page's flow that raises a panel when the visitor engages with it. Nothing
   * about an existing embed changes.
   *
   * 'popup' opens the panel immediately as a floating window, positioned over
   * the inline box and sized by defaultWindowBox(). Set it with the attribute:
   *
   *     <blue-search-embed-base startmode="popup" ...>
   *
   * 'icon' is popup's panel with a way back to it: collapsed, the widget is a
   * button showing the assistant's icon and its title, and pressing it raises
   * the same floating panel. Hiding returns to the button rather than removing
   * the widget from the page, which is the whole difference — a popup that is
   * dismissed is gone until the host reopens it, and a page that offers no way
   * to do that has lost the widget for the visit.
   *
   * The floating placement falls back to anchored wherever the panel cannot
   * float — a coarse pointer, or a host page whose ancestors break
   * position:fixed (see canUseFixed). Only the placement: the mode itself does
   * not change, so an icon-mode widget on a phone still collapses to its
   * button.
   *
   * Normalized on the way in rather than trusted: the setter takes whatever a
   * host page wrote and the getter answers one of the three — see
   * normalizeStartMode(). Both spellings of the attribute go through here, so
   * `startMode` and `startmode` cannot disagree about what a value means.
   */
  @Input('startmode')
  set startMode(value: EmbedStartMode | string | undefined) {
    this.startModeValue = normalizeStartMode(value);
  }

  get startMode(): EmbedStartMode {
    return this.startModeValue;
  }

  private startModeValue: EmbedStartMode = 'inline';

  // ── What the mode actually decides ──────────────────────────────────────
  //
  // Two questions, and they are not the same one. Every branch below used to
  // ask `startMode === 'popup'` because with two modes the answers coincided;
  // with three they do not, and ten string comparisons would have had to be
  // re-reasoned one at a time — which is exactly where a mode gets half
  // implemented.

  /**
   * The open panel is a free-floating window rather than a panel anchored to
   * a box in the page's flow.
   *
   * Governs the placement (restoreWindowBox, defaultWindowBox), whether it can
   * be dragged and resized, and the two collapses that only make sense for
   * something anchored — a host navigation moving the box out from under it,
   * and "New chat" dropping back to the input row there is none of.
   */
  protected get floatsWhenOpen(): boolean {
    return this.startMode === 'popup' || this.startMode === 'icon';
  }

  /**
   * The open panel sits IN THE PAGE'S FLOW and takes real space.
   *
   * The one thing that separates Docked from Popup. Popup is open over the
   * content below it with the host slot holding its place, so the page never
   * moves; Docked is a block of the page like any other and pushes what
   * follows down as the conversation grows.
   *
   * Everything else Docked shares with Popup — open on load, no collapsed
   * form, no Hide button — so this is deliberately NOT expressed as
   * `!floatsWhenOpen`. That predicate answers "is it anchored to a box",
   * which inline mode also answers no to for an entirely different reason.
   */
  protected get isDocked(): boolean {
    return this.startMode === 'docked';
  }

  /**
   * Hiding the panel leaves a collapsed form of it behind on the page.
   *
   * Inline collapses to its input box, icon to its button. Popup and docked
   * have nothing to collapse TO, and that is what two guards in here actually
   * needed: `onHostNavigated` and `newConversation` both used
   * `!floatsWhenOpen`, which happened to be the same answer while popup was
   * the only mode with no collapsed form. For docked it is not — docked does
   * not float, so both would have collapsed it to nothing and left the host
   * element empty with no way to bring it back.
   */
  protected get collapsesToSomething(): boolean {
    return this.startMode === 'inline' || this.startMode === 'icon';
  }

  /**
   * The panel is open on load and cannot be put away.
   *
   * Popup and docked. Both are placed by the host deliberately — the host
   * decides when the element exists — so neither has an "opened by the
   * visitor" state to restore or a button to be reopened from.
   */
  protected get opensOnLoad(): boolean {
    return this.startMode === 'popup' || this.isDocked;
  }

  /**
   * Hiding the panel leaves nothing behind.
   *
   * Popup only. Inline collapses to its input box and icon to its button; both
   * are still on the page, so neither takes the host element out of the layout
   * and neither is the host's business to be told about.
   */
  protected get dismissesToNothing(): boolean {
    return this.startMode === 'popup';
  }

  /**
   * This widget is a mark and a name on someone's bar, with its panel on top.
   *
   * Also a host class, and it is on the MODE rather than on "collapsed right
   * now" deliberately. What it carries is the host element's own box —
   * inline-flex at its content's width instead of the block that fills its
   * container — and that has to hold while the panel is open too. Scoped to
   * the collapsed state, opening the panel would hand the host back its
   * width:100% and shove everything beside it along the row.
   */
  @HostBinding('class.bb-icon-mode')
  protected get isIconMode(): boolean {
    return this.startMode === 'icon';
  }

  /**
   * The icon button's own action.
   *
   * A toggle, not an open: the button stays on the bar while the panel is up
   * (see the template), so it is the only control a visitor has already used
   * for this and pressing it again is how they expect to put the panel away.
   * The panel's own Hide button does the same thing from the other end.
   */
  protected toggleOverlay(): void {
    if (this.isOverlay) this.collapseOverlay();
    else this.openOverlay();
  }

  /**
   * The icon on that button.
   *
   * robotSrc first — the field the launcher already uses for its own button
   * (applyApiBranding), and the one that answers "what does this widget look
   * like closed", which is the question this button is. Not logoSrc: that is
   * the customer's brand mark for the panel header and the avatars, a
   * different question, and the two were conflated once already (see the note
   * in chat-widget-config.functions.ts).
   *
   * Otherwise the product's own mark — the dots one, which is this button's
   * alone. It used to be sendIconFor()'s magnifying glass, shared with the
   * composer's send button: a reasonable default, but the wrong promise. This
   * button is what a visitor meets before they have opened anything, and a
   * speech bubble says the thing behind it answers, where a magnifying glass
   * says it searches. Nothing else moved to the new mark; see the icon-mode
   * section in default-logo.ts for what that split is protecting.
   *
   * Picked against the button's own background rather than reusing
   * sendIconReady, which is resolved against the message colour: the two are
   * usually the same ground and, when they are not, the mark would come out
   * inverted on the one surface a visitor sees before opening anything.
   */
  protected get iconSrc(): string {
    const fromApi = (this.appOrWp as any)?.robotSrc;
    if (typeof fromApi === 'string' && fromApi.trim()) return fromApi.trim();

    return iconModeMarkFor(
      this.backColor || (this.appOrWp as any)?.backColor || DEFAULT_WIDGET_THEME.backColor,
    );
  }

  /**
   * The visitor dismissed a popup.
   *
   * Emitted so whatever mounted the widget can drop its own "is it showing"
   * flag. Without it the two disagree: the widget hides itself, the host still
   * believes it is open, and the host's toggle button then needs pressing
   * twice — once to turn off a flag for something already gone, once to turn
   * it back on.
   *
   * Popup mode only. In inline mode dismissing returns to the input box, which
   * is not the host's business.
   */
  @Output() dismissed = new EventEmitter<void>();

  // A `topoffset` input used to hold the floating panel below the host page's
  // sticky chrome. Removed: the viewport is the only edge the panel is kept
  // inside now, so a visitor can pull it right to the top. z-index still keeps
  // it in front of a sticky header.

  /**
   * Stacking order of the open panel, as a plain z-index.
   *
   *     <blue-search-embed-base zindex="1200" ...>
   *
   * The panel already read `--bbc-z` from the host page, but only as a CSS
   * custom property the site owner had to know to write in a style attribute.
   * That is not a parameter — it is an internal name that happened to be
   * settable — and it is not what the other options here look like. This is the
   * same value with a front door.
   *
   * This is now the only thing that decides where the widget sits on the
   * host's page. It used to default to the top of the stack (2147483647),
   * which is the wrong way round: that is right only when nothing of the
   * host's should ever cover the panel, and it left them no way to say
   * otherwise when they had a modal, cookie banner or sticky nav that must —
   * a site cannot lower the widget by raising their own, because there is
   * nothing above the maximum. The default is 1 now, the least a floating
   * panel needs to clear ordinary page content, and a host that wants more
   * asks for it here. See --bbc-z on :host in embed.component.css.
   *
   * Unset leaves --bbc-z alone rather than writing the default over it, so a
   * host page that sets the custom property directly in its own style
   * attribute — which customer installs predate this input by — still wins.
   *
   * A number, not a size: no units, and 0 is a legitimate value, so it is
   * distinguished from unset rather than from falsy.
   */
  @Input('zindex') zIndex?: string | number;

  // ============================================================
  // camelCase spellings of the same parameters
  // ============================================================
  //
  // Lowercase is the documented name and the one the install guide teaches.
  // These aliases exist so the other spelling cannot catch anyone out.
  //
  // The two spellings behave differently depending on where the widget is
  // written, which is the trap:
  //
  //   - In plain HTML the parser lowercases attribute names, so a customer
  //     typing fontSize="18px" produces the attribute `fontsize` and it works
  //     whether we declare the camelCase alias or not.
  //   - In an Angular template the binding is matched against the alias
  //     literally, so without these, fontSize="18px" is a build error in our
  //     own app while reading as perfectly valid to whoever wrote it.
  //
  // Setters rather than a second @Input on the same property, because Angular
  // allows one input alias per member. Each writes the real property, so the
  // rest of the component reads one field and never has to ask which spelling
  // arrived. If both are somehow set, the last one written wins — an ambiguity
  // with no sensible resolution, and not worth code to detect.
  //
  // One consequence to keep in mind, and the reason ChatCoreComponent's
  // REINIT_INPUTS names both spellings: SimpleChanges is keyed by the property
  // name, not the alias, so a change arriving through one of these setters
  // shows up as `appIdCamel` rather than `appId`.
  @Input('appId')        set appIdCamel(v: string | undefined)            { this.appId = v; }
  @Input('envUrl')       set envUrlCamel(v: string | undefined)           { this.envUrl = v; }
  @Input('gptId')        set gptIdCamel(v: string | undefined)            { this.gptId = v; }
  @Input('assistantId')  set assistantIdCamel(v: string | undefined)      { this.assistantId = v; }
  @Input('defaultLang')  set defaultLangCamel(v: string)                  { this.defaultLang = v; }
  @Input('fontSize')     set fontSizeCamel(v: string | undefined)         { this.fontSize = v; }
  @Input('iconFontSize')   set iconFontSizeCamel(v: string | undefined)   { this.iconFontSize = v; }
  @Input('iconFontFamily') set iconFontFamilyCamel(v: string | undefined) { this.iconFontFamily = v; }
  @Input('fontFamily')   set fontFamilyCamel(v: string | undefined)       { this.fontFamily = v; }
  @Input('lineHeight')   set lineHeightCamel(v: string | undefined)       { this.lineHeight = v; }
  @Input('backColor')    set backColorCamel(v: string | undefined)        { this.backColor = v; }
  @Input('messageColor') set messageColorCamel(v: string | undefined)     { this.messageColor = v; }
  @Input('startMode')    set startModeCamel(v: EmbedStartMode | string | undefined) { this.startMode = v; }
  @Input('zIndex')       set zIndexCamel(v: string | number | undefined)  { this.zIndex = v; }

  /**
   * Push zIndex out as the `--bbc-z` custom property the stylesheet reads.
   *
   * Only ever written, never removed. A host page can also set `--bbc-z`
   * directly in its own style attribute — pages-header.component.html does, and
   * customer installs predate this input — and that lands on this same element.
   * Clearing the property when the input is unset would therefore delete their
   * value rather than restore a default. Unset means "don't touch it", which
   * leaves whatever the page set, or the fallback in the stylesheet.
   *
   * Rejects anything non-numeric: a bad z-index does not fail loudly, it just
   * silently puts the panel behind something, and the built-in default is a far
   * better answer than a broken value.
   */
  private applyZIndexVar(): void {
    const hostEl = this.elementRef?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return;

    const raw = String(this.zIndex ?? '').trim();
    if (!raw) return;

    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    hostEl.style.setProperty('--bbc-z', String(Math.round(n)));
  }

  /**
   * Popup mode dismisses to nothing, not back to an input box.
   *
   * In inline mode the widget *is* the box in the page's flow, so hiding the
   * panel means returning to it. A popup was never that: it opened as a
   * floating window over the page, and the inline box behind it is an
   * implementation detail the visitor never saw. Dropping them back onto it
   * would be handing them a thing they did not know existed, in a place they
   * were not looking.
   *
   * The host element goes, not just the panel — otherwise the page keeps a gap
   * where a widget the visitor has dismissed used to be.
   */
  protected get isDismissedPopup(): boolean {
    return this.dismissesToNothing && this.viewState === 'inline';
  }

  @HostBinding('style.display')
  get hostDisplayStyle(): string | null {
    return this.isDismissedPopup ? 'none' : null;
  }

  @HostBinding('style.width')
  get hostWidthStyle(): string | null {
    return this.sanitizeSize(this.width);
  }

  @HostBinding('style.height')
  get hostHeightStyle(): string | null {
    return this.sanitizeSize(this.height);
  }

  /** A bare number ("400") is treated as pixels; anything already
   *  carrying a unit ("400px", "24rem", "80vw") is trusted as-is. */
  private sanitizeSize(v?: string): string | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    return /^\d+(\.\d+)?$/.test(s) ? `${s}px` : s;
  }

  // headerLogoBg / headerIsRound / headerLogoInitialLocal were re-declared here
  // with the embed's own initial values. They are plain fields on the base and
  // applyConfig writes all three, so the copies only served to disagree with
  // it — headerLogoBg started as '' here and `undefined` on the base, which was
  // the whole reason an app's logo-chip colour reached the panel and not the
  // embed. One declaration, on ChatCoreComponent.

  /** The core defaults to grabbing focus on init — right for the launcher,
   *  which only appears once the visitor opened it, but wrong for an inline
   *  embed sitting passively on a page: stealing focus on load pulls the
   *  cursor out of whatever the host page wants it in (e.g. a URL field),
   *  and can open the overlay panel over content below it before anyone
   *  asked for it. Not an @Input — see the note above. */
  override autoFocusOnInit: boolean = false;

  /** Same suggested defaults widget2/chat falls back to — see the header of
   *  default-widget-theme.ts. Exposed so the template can read it directly. */
  protected readonly DEFAULT_THEME = DEFAULT_WIDGET_THEME;

  /** Resolved from widgetParams.suggestionMaxVisible in ensureDefaultsInWidgetParams(). */
  suggestionMaxVisible: number = 8;
  private readonly embedDefaultSuggestionMaxVisible = 8;

  embedUiReady = true;

  private clickingSuggestion = false;
  private lastAppOrWpJson?: string;

  private lastScrollMsgCount = 0;
  private didInitialScroll = false;

  constructor(
    protected override zone: NgZone,
    protected override elementRef: ElementRef<HTMLElement>,
  ) {
    super(zone, elementRef);

    // Grow the floating panel the moment the conversation stops being empty.
    //
    // An effect on the messages signal rather than a call at each of the
    // places a message is added: there are several of those (a typed send, a
    // suggestion, an attachment, the restored history, a poll frame from an
    // agent) and every one of them would have to remember. This reacts to the
    // state itself, so none of them can forget.
    effect(() => {
      // Read the signal so this effect actually depends on it. isEmpty is a
      // getter over the same array and would not register as a dependency.
      this.messages$();
      this.syncWindowHeight();
    });
  }



  private applyEmbedTypographyVarsFrom(appOrWp: any) {
    try {
      const hostEl = this.elementRef?.nativeElement as HTMLElement | undefined;
      if (!hostEl) return;

      const aow = appOrWp || {};
      const wp = (aow?.widgetParams || {}) as any;

      const pick = (...vals: any[]) =>
        vals.find(v => typeof v === 'string' && v.trim())?.trim() as string | undefined;

      // The explicit @Input is checked first — it wins over anything
      // getApp()/widgetParams supplies, not just the hardcoded default.
      const fs = pick(this.fontSize, aow.fontSize, wp.fontSize, wp.uiFontSize);
      const ff = pick(this.fontFamily, aow.fontFamily, wp.fontFamily, wp.uiFontFamily);
      const lh = pick(this.lineHeight, aow.lineHeight, wp.lineHeight, wp.uiLineHeight);

      // The icon button's own pair. Same precedence, one step shorter: there is
      // no legacy ui* spelling to honour because these are new.
      const ifs = pick(this.iconFontSize, aow.iconFontSize, wp.iconFontSize);
      const iff = pick(this.iconFontFamily, aow.iconFontFamily, wp.iconFontFamily);

      if (ff) this.fontFamily = ff;
      if (fs) this.fontSize = fs;
      if (lh) this.lineHeight = lh;
      if (ifs) this.iconFontSize = ifs;
      if (iff) this.iconFontFamily = iff;

      const setVars = () => {
        if (ff) hostEl.style.setProperty('--bb-font-family', ff);
        // --bb-font-size-base, not --bb-font-size: embed.component.css
        // derives the effective --bb-font-size from that base (1:1 on
        // desktop, scaled up under its mobile @media rule), so the mobile
        // bump stays relative to whatever the base is — this override
        // included — instead of only applying when nothing was set.
        if (fs) hostEl.style.setProperty('--bb-font-size-base', fs);
        if (lh) hostEl.style.setProperty('--bb-line-height', lh);

        // Only when asked for. Left unset, the stylesheet falls back to the
        // conversation's own base — so this adds a way to differ without
        // changing anything for an embed that does not use it.
        if (ifs) hostEl.style.setProperty('--bb-icon-font-size', ifs);
        if (iff) hostEl.style.setProperty('--bb-icon-font-family', iff);
      };

      setVars();
      requestAnimationFrame(setVars);
    } catch {}
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  // View state: 'inline' is the input box in the page flow; 'overlay' is a
  // panel over it carrying history and input. Every transition goes through
  // openOverlay()/collapseOverlay(), so one place writes the flag.

  viewState: EmbedViewState = 'inline';

  /**
   * Height of the inline box, in px, captured while it was still inline.
   *
   * The panel is taken out of flow when it opens, so without this the host
   * element would collapse and everything below it on the customer's page would
   * jump up. 0 means "never measured" — the placeholder then falls back to a
   * CSS height, which is the case when a visitor returns straight into the
   * overlay and the inline box never rendered.
   */
  inlineHeightPx = 0;

  @ViewChild('embedShell') private embedShellRef?: ElementRef<HTMLElement>;

  /** Icon mode's button, read for the panel's opening position — see
   *  iconAnchorRect(). It is a sibling of the shell, not a child, so it
   *  stays measurable while the panel is open. */
  @ViewChild('iconButton') private iconButtonRef?: ElementRef<HTMLElement>;

  /**
   * The message box, shared with the panel — see ComposerComponent.
   *
   * The base returns undefined for both refs (it renders no composer of its
   * own); routing them at the child is what makes focusInput(), autosize and
   * ArrowUp/Down input history work here. There is one composer, inline and
   * overlay alike — the overlay only re-positions its ancestor — so this is
   * correct in both states.
   */
  @ViewChild(ComposerComponent) private composer?: ComposerComponent;

  override get inputRef(): ElementRef<HTMLTextAreaElement> | undefined {
    return this.composer?.inputRef;
  }

  override get composerRef(): ElementRef<HTMLElement> | undefined {
    return this.composer?.composerRef;
  }

  /** Removes the host-navigation listener. */
  private hostNavCleanup?: () => void;

  // ---- Holding the host page still on a phone ------------------------------

  /**
   * Whether *this* instance is one of the widgets holding the page.
   *
   * The lock module counts holders so two embeds on one page cannot unlock each
   * other, and that count is only correct if each instance takes and releases
   * exactly one hold. This flag is what makes syncBodyScrollLock() safe to call
   * as often as it likes: it does nothing unless the answer has actually
   * changed.
   */
  private holdsBodyScroll = false;

  /** Removes the viewport listener that re-evaluates the lock on rotate. */
  private mobileQueryCleanup?: () => void;

  /**
   * Take or release the page lock to match the current state.
   *
   * Called after every viewState transition and whenever the viewport crosses
   * the mobile breakpoint. Deriving it from state each time, rather than
   * locking in openOverlay() and unlocking in collapseOverlay(), is what covers
   * the paths that are not either of those — host navigation, the component
   * being destroyed with the panel still up, and a phone turned to landscape
   * while it is open.
   */
  private syncBodyScrollLock(): void {
    // Docked is excluded: it is a block of the page, so holding the page still
    // while it is "open" would freeze a site that has not covered anything.
    const wanted = this.isOverlay && !this.isDocked && isMobileViewport();
    if (wanted === this.holdsBodyScroll) return;

    this.holdsBodyScroll = wanted;
    if (wanted) lockBodyScroll();
    else unlockBodyScroll();
  }

  /**
   * Re-evaluate when the viewport crosses the breakpoint.
   *
   * Rotating a phone to landscape can take it past 600px, at which point the
   * panel is no longer full-screen and holding the page is just a page that
   * will not scroll. The reverse matters more: rotating back must take the lock
   * again, and nothing else would notice.
   */
  private watchMobileBreakpoint(): void {
    try {
      const mq = matchMedia(MOBILE_QUERY);
      const onChange = () => this.zone.run(() => this.syncBodyScrollLock());

      mq.addEventListener('change', onChange);
      this.mobileQueryCleanup = () => mq.removeEventListener('change', onChange);
    } catch {
      // Old matchMedia, or none. The lock still works on open and close; it
      // just will not follow a rotation.
    }
  }

  @HostBinding('class.bb-overlay')
  get isOverlay(): boolean {
    return this.viewState === 'overlay';
  }

  private get overlayKey(): string {
    return buildEmbedOverlayKey(this.storageScope);
  }

  /**
   * The inline box's current height, or 0 if it is not in the DOM.
   *
   * Must be read *before* the state flips: once .is-overlay is applied the
   * element is absolutely positioned and its height no longer describes the
   * space it used to occupy.
   */
  private measureInlineHeight(): number {
    if (this.isOverlay) return 0;
    return this.embedShellRef?.nativeElement?.offsetHeight || 0;
  }

  /**
   * Raise the overlay. Idempotent; remembers the choice for the next load.
   *
   * `focus: false` is for the restore-on-load path: everything else about
   * opening must still happen — the dismiss listener above all — but pulling
   * focus into the composer as a page finishes loading would scroll the host
   * page to us and take the caret off whatever the visitor was doing.
   */
  openOverlay(opts: { focus?: boolean } = {}): void {
    if (this.viewState === 'overlay') return;

    this.inlineHeightPx = this.measureInlineHeight() || this.inlineHeightPx;

    this.viewState = 'overlay';
    this.rememberOverlayOpen(true);
    this.syncBodyScrollLock();
    this.cdr.markForCheck();

    // The language offer used to be re-checked here, because the IP lookup was
    // asynchronous and could still have been in flight when the panel opened.
    // There is no asynchronous step left: the language is settled
    // synchronously before getApp() is issued, so there is nothing to catch up
    // with on open.

    // After the flag, so .is-overlay is on the element before its geometry is
    // written — and after render, because the shell has no useful rect until
    // the panel has actually been laid out.
    requestAnimationFrame(() => this.restoreWindowBox());

    // After the panel has rendered: the textarea survives the transition (only
    // an ancestor's class changes), so focus is usually already there — but not
    // when the panel was raised by the collapse button, a restore on load, or a
    // suggestion click.
    if (opts.focus !== false) {
      requestAnimationFrame(() => this.focusInput());
    }
  }

  /**
   * Following a link in an answer puts the panel away — see
   * ChatCoreComponent.onFeedClick for why.
   *
   * collapseOverlay(), which already keeps the conversation and only clears the
   * open flag, so reopening comes back to the same history. Guarded on
   * isOverlay because in inline mode there is no panel to put away: the widget
   * IS the page's box, and collapsing it would be collapsing nothing.
   */
  protected override hideForLink(): void {
    if (this.isOverlay) this.collapseOverlay();
  }

  /**
   * Drop back to the inline box.
   *
   * Clears the flag but keeps the conversation: coming back to the page should
   * not re-raise a panel the visitor deliberately dismissed, while the history
   * stays there to be resumed.
   */
  collapseOverlay(): void {
    if (this.viewState === 'inline') return;

    // The inline styles go, the stored box stays. Collapsed, the widget must
    // be the plain input box in the page flow again — a leftover
    // position:fixed would leave it floating over the page with no panel in
    // it. Reopening reads the box back and puts it where they left it.
    const el = this.embedShellRef?.nativeElement;
    if (el) {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      // Goes with `top`: a panel back at its inline anchor starts at the top of
      // its own box, and a stale offset here would shorten the height cap by
      // wherever the panel used to be.
      el.style.removeProperty('--bb-panel-top');
    }

    this.viewState = 'inline';
    this.rememberOverlayOpen(false);
    this.syncBodyScrollLock();
    this.cdr.markForCheck();

    // Tell whoever mounted us, so their own flag matches what is on screen.
    if (this.dismissesToNothing) this.dismissed.emit();
  }

  /**
   * The host page navigated. Registered in doInit() — see onHostNavigation().
   *
   * Inline mode only, and that distinction is the whole of this method.
   *
   * An inline panel is anchored to a box in the page's own flow. When a
   * single-page host swaps its content, that box is gone or has moved, and a
   * panel still floating over its old position is stranded — so it collapses
   * and comes back when the widget next mounts.
   *
   * A popup panel is anchored to nothing. It floats over the viewport, and on
   * this console it lives in the header, which survives every route change.
   * Collapsing it here meant the visitor's conversation vanished the moment
   * they clicked any menu item — not closed, because nothing told the host
   * that: the host's own flag stayed true and the element stayed in the DOM,
   * while isDismissedPopup quietly set display:none on it. A conversation that
   * disappears with no way to explain why is worse than one anchored slightly
   * wrong.
   */
  onHostNavigated(): void {
    // Was `if (this.floatsWhenOpen) return;`. The test is whether there is a
    // collapsed form to land on, which happened to be the same answer while
    // popup was the only mode without one — docked does not float and has none
    // either, and collapsing it would empty the host element for good.
    if (!this.collapsesToSomething) return;
    if (this.viewState !== 'overlay') return;

    this.viewState = 'inline';
    this.syncBodyScrollLock();

    // The flag is deliberately left alone: the visitor did not dismiss this,
    // the page moved out from under it. Coming back to a page that mounts the
    // widget afresh will restore it — see restoreOverlayState().
    this.cdr.markForCheck();
  }

  // ============================================================
  // Note: the panel is dismissed only by the Hide button.
  //
  // There used to be an outside-click listener here that collapsed the panel
  // when the visitor clicked anywhere on the host page. It is gone, and
  // deliberately not merely disabled: a visitor reading an answer while
  // scrolling, selecting text on the page, or clicking away to check
  // something had the conversation shut under them. Dismissal is now an
  // explicit act — the Hide button in the panel header — which is also what
  // makes a moved or resized panel worth the effort, since it stays where it
  // was put until it is deliberately put away.
  // ============================================================

  override ngOnDestroy(): void {
    try { this.hostNavCleanup?.(); } catch {}
    this.hostNavCleanup = undefined;

    try { this.mobileQueryCleanup?.(); } catch {}
    this.mobileQueryCleanup = undefined;

    try { this.messageLinkCleanup?.(); } catch {}
    this.messageLinkCleanup = undefined;

    // Before super, and unconditionally: a widget torn down with the panel
    // still open would otherwise leave the host page frozen at a negative
    // offset with nothing left on screen to explain why. Going through
    // viewState first means the release runs through the same one path as
    // every other transition.
    this.viewState = 'inline';
    this.syncBodyScrollLock();

    super.ngOnDestroy();
  }

  /**
   * Decides, on init, whether to come back up.
   *
   * Both conditions must hold: there is something to show, and the visitor left
   * it open. Runs after super.doInit(), which is what loads the history.
   */
  private restoreOverlayState(): void {
    // Popup mode opens on load, conversation or not. The condition below is
    // about *resuming* something the visitor left open; this is a widget
    // configured to be a floating panel from the start, so there is nothing to
    // resume and nothing to wait for.
    //
    // Icon mode is deliberately NOT here, even though its panel floats the
    // same way. A widget whose collapsed form is a button has somewhere to
    // start: opening on load would make the button a thing that only ever
    // appears after the visitor has dismissed the panel, which is the opposite
    // of what the mode is for. It falls through to the flag below and comes
    // back up only if that is where the visitor left it.
    if (this.opensOnLoad) {
      this.openOverlay({ focus: false });
      return;
    }

    // The flag alone decides. There used to be an `if (this.isEmpty) return;`
    // in front of this, so a panel the visitor had opened but not yet typed
    // into came back closed.
    //
    // On a single-page host that was nearly invisible — the component survives
    // navigation, so the state never had to be restored. On WordPress and any
    // other server-rendered site every link is a full reload, which made it the
    // ordinary case: open the widget, click through to another page, find it
    // shut. The visitor did not close it, and had no way to tell why it went.
    //
    // "Empty" was standing in for "they were not really using it", and it is
    // the wrong test: opening the panel *is* the act being remembered, and the
    // flag records it exactly. A blank panel that stays open is what the
    // visitor left; a closed one is the widget disagreeing with them.
    if (!this.readOverlayOpen()) return;

    // Through openOverlay(), not by assigning viewState: openOverlay() is the
    // one place that writes the flag, remembers the choice and restores the
    // panel's placement. Assigning viewState directly skips all three.
    this.openOverlay({ focus: false });
  }

  private readOverlayOpen(): boolean {
    try {
      return localStorage.getItem(this.overlayKey) === '1';
    } catch {
      return false;
    }
  }

  private rememberOverlayOpen(open: boolean): void {
    try {
      localStorage.setItem(this.overlayKey, open ? '1' : '0');
    } catch {}

    // The same fact, published for the host page — see widget-status.ts.
    // Written here rather than at each transition so it cannot be forgotten by
    // a path added later: everything that opens or closes the panel already
    // goes through this one function.
    publishWidgetOpen(this.appId, this.assistantId, open);
  }

  // ============================================================
  // Moving and resizing the panel
  // ============================================================

  /**
   * Where the visitor put the panel, or null while it has never been moved.
   *
   * null is the important state: it means "behave exactly as before", so an
   * untouched widget on a customer's page is unchanged by any of this.
   */
  protected windowBox: EmbedWindowBox | null = null;

  /**
   * Whether this page can be trusted with position:fixed — see canUseFixed().
   * Resolved when the panel opens, because the host DOM can change between
   * mount and open.
   */
  private fixedIsSafe = false;

  /**
   * Can this panel be moved and resized?
   *
   * Popup mode only. An inline embed is anchored to the box the visitor was
   * typing in — that is the whole idea of it, and it is what makes the panel
   * appear where they are looking. Letting it be dragged away turns a widget
   * that belongs to a place on the page into a floating window that happens to
   * have started there, which is a different product and the one popup mode
   * already is.
   *
   * Then the ordinary conditions: the panel is up, fixed positioning actually
   * behaves on this page, and the screen is big enough for the panel to be a
   * window at all.
   *
   * THE SIZE, NOT THE POINTER. This used to require `(pointer: fine)`, which
   * reads as "a mouse" and was really standing in for "not a phone" — the
   * comment on it said so: full width, no grip to catch with a thumb. On a
   * phone the two agree. On a tablet they do not, and the panel lost its grips
   * on a screen with plenty of room for them, for no better reason than the
   * absence of a mouse. Both gestures are Pointer Events with pointer capture,
   * so a finger drives them exactly as a mouse does; the grip and the header
   * set touch-action: none so the drag moves the panel instead of scrolling
   * the page behind it.
   */
  protected get windowControlsVisible(): boolean {
    return this.floatsWhenOpen
      && this.isOverlay
      && this.fixedIsSafe
      && !isMobileViewport();
  }

  // The placement no longer has a key of its own — it is a field on the
  // visitor cache in chat-storage.functions.ts, addressed by storageScope like
  // every other stored thing here. windowKey is gone with it.

  private pointerCleanup?: () => void;

  /**
   * Start a move or a resize.
   *
   * One handler for both: they differ only in which edges the delta is applied
   * to, and keeping them together is what stops the two drifting apart on the
   * details that actually matter — pointer capture, the starting rect, and
   * releasing the listeners on every exit path.
   */
  protected beginWindowDrag(event: PointerEvent, mode: 'move' | 'resize'): void {
    if (!this.windowControlsVisible) return;

    // Left button only. A right-click drag would otherwise move the panel and
    // open the context menu on top of it.
    if (event.button !== 0) return;

    const shell = this.embedShellRef?.nativeElement;
    if (!shell) return;

    // The rect, not the stored box: the panel may never have been moved, in
    // which case there is no stored box and its real geometry is the only
    // truth. This is also why deltas below are computed against the start
    // rect rather than accumulated — accumulating drifts, and clamping an
    // accumulated delta clamps the *velocity* rather than the position.
    const start = shell.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const from: EmbedWindowBox = {
      x: start.left,
      y: start.top,
      w: start.width,
      h: start.height,
    };

    // Before the first frame, not on release: a resize must take effect while
    // it is being dragged, and heightIsAuto would otherwise swallow every
    // height written during the gesture.
    if (mode === 'resize') this.resizing = true;

    // Fix the panel where it currently is before the first move, so switching
    // from absolute to fixed does not make it jump.
    this.applyWindowBox(from);

    event.preventDefault();
    try { (event.target as Element)?.setPointerCapture?.(event.pointerId); } catch {}

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const next: EmbedWindowBox = mode === 'move'
        ? { ...from, x: from.x + dx, y: from.y + dy }
        : { ...from, w: from.w + dx, h: from.h + dy };

      this.applyWindowBox(
        clampBox(next, window.innerWidth, window.innerHeight)
      );
    };

    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;

      this.pointerCleanup?.();
      this.pointerCleanup = undefined;
      this.resizing = false;

      // The gesture is over, so the empty-feed rule applies again — an empty
      // panel resized large snaps back to its contents, and keeps the height
      // for when there is a conversation to fill it.
      this.syncWindowHeight();

      // Persisted on release, not on every frame: a drag is a few hundred
      // pointermove events, and localStorage writes are synchronous.
      saveWindowBox(this.storageScope, this.windowBox, this.storageKey);
    };

    // Outside Angular: a pointermove per frame running change detection over
    // the whole conversation is what makes a drag feel heavy. The box is
    // written straight to the element's style instead — see applyWindowBox.
    this.zone.runOutsideAngular(() => {
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', end, true);
      document.addEventListener('pointercancel', end, true);
    });

    this.pointerCleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
    };
  }

  /**
   * Write a box to the panel.
   *
   * Directly to the element's style rather than through a template binding:
   * this runs on every pointermove, and a binding would mean a change-detection
   * pass per frame over the whole message list.
   */
  private applyWindowBox(box: EmbedWindowBox): void {
    this.windowBox = box;

    const el = this.embedShellRef?.nativeElement;
    if (!el) return;

    el.style.position = 'fixed';
    el.style.left = `${Math.round(box.x)}px`;
    el.style.top = `${Math.round(box.y)}px`;
    el.style.width = `${Math.round(box.w)}px`;

    // The same top, as a custom property, for the max-height cap in
    // embed.component.css — the panel may not grow past the bottom of the
    // window, and how much room is left depends on where its top edge is. CSS
    // cannot read an inline `top`, so it is published here beside it. Written
    // on the same element and in the same place so the two cannot drift.
    el.style.setProperty('--bb-panel-top', `${Math.round(box.y)}px`);

    // Height is the one dimension that is sometimes not ours to set — see
    // syncWindowHeight(). Width and position always are.
    if (this.heightIsAuto) el.style.height = '';
    else el.style.height = `${Math.round(box.h)}px`;
  }

  /**
   * Should the panel size itself to its contents rather than to box.h?
   *
   * Whenever it is empty, chosen height or not.
   *
   * An empty conversation is a header, an input and a suggestion strip — maybe
   * 160px of content. A window mostly full of nothing reads as broken rather
   * than as roomy, and that is as true of a height the visitor picked as of
   * the default: they sized the window to hold a conversation, not to hold an
   * empty box.
   *
   * The chosen height is not lost, only deferred — it is still on the stored
   * box, and comes back the moment there is something to put in it.
   */
  private get heightIsAuto(): boolean {
    return this.isEmpty && !this.resizing;
  }

  /** True only for the duration of a resize gesture.
   *
   *  Without it, dragging the grip on an empty panel would do nothing visible:
   *  every height written during the drag would be swallowed by the rule
   *  above, and the panel would jump to its new size only on release. */
  private resizing = false;

  /**
   * Re-apply the height rule after the conversation changes.
   *
   * Cheap and idempotent: it only touches the element when the panel is
   * actually floating, and writes the same value it already has when nothing
   * has changed.
   */
  private syncWindowHeight(): void {
    if (!this.windowBox) return;

    const el = this.embedShellRef?.nativeElement;
    if (!el) return;

    el.style.height = this.heightIsAuto ? '' : `${Math.round(this.windowBox.h)}px`;
  }

  /** Back to the inline anchor, forgetting the placement. */
  protected resetWindowBox(): void {
    // Bound to a double-click on the header, which exists in both modes. In
    // inline mode there is no placement to reset, and without this the gesture
    // would still clear a storage key and null a field for no reason.
    if (!this.windowControlsVisible) return;

    this.windowBox = null;
    saveWindowBox(this.storageScope, null, this.storageKey);

    const el = this.embedShellRef?.nativeElement;
    if (el) {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      // Goes with `top`: a panel back at its inline anchor starts at the top of
      // its own box, and a stale offset here would shorten the height cap by
      // wherever the panel used to be.
      el.style.removeProperty('--bb-panel-top');
    }
  }

  /**
   * Re-apply a stored placement, pulled back into the current viewport.
   *
   * The window the panel was placed in is not the window it comes back to — a
   * box saved on a wide monitor and reopened on a laptop would otherwise be
   * parked off-screen with nothing to grab.
   */
  private restoreWindowBox(): void {
    // Inline mode never floats. The panel keeps the geometry it has always
    // had: position:absolute against the host element, i.e. anchored to the
    // top of the inline box, growing downward over the page. Returning before
    // anything is measured or written is what guarantees that — a stored box
    // left over from a page that once ran popup mode must not resurface here
    // and float a panel that is supposed to be attached.
    if (!this.floatsWhenOpen) return;

    // A PHONE GETS NO BOX. Below 600px the panel is not a window, it is the
    // screen: embed.component.css pins .embed-shell.is-overlay to
    // fixed/top:0/left:0/100%/100dvh. Everything this method writes is an
    // INLINE style, and an inline style beats that rule - so a stored or
    // default box written here is exactly what stops the panel filling the
    // screen.
    //
    // The two guards below do not cover it. Both are device questions -
    // "can this page host a fixed element", "is this a fine pointer" - and
    // neither is a size question. A narrow window reporting a fine pointer
    // (a resized desktop, or device emulation without touch emulation) got a
    // box written straight over the full-screen rule.
    //
    // isMobileViewport() reads the same 600px query the stylesheet uses
    // (MOBILE_QUERY, body-scroll-lock.functions.ts), so the two cannot
    // disagree about what "mobile" is.
    if (isMobileViewport()) return;

    // fixedIsSafe ONLY. The pointer type used to be tested here too, and that
    // was the tablet bug: a tablet is over 600px, so the full-screen rule above
    // does not apply to it, and it reports a coarse pointer, so this returned
    // before writing any box. The panel was then a fixed element with no width
    // and no position — it shrank to fit its own content and rendered as a
    // sliver down the left edge of the screen.
    //
    // Phones are covered by the guard above and desktops by the box written
    // below; everything between had neither. Geometry is a question about the
    // SIZE of the viewport, which is what that guard asks. Whether there is a
    // mouse to catch a grip with is a question about the CONTROLS, and belongs
    // to windowControlsVisible, which is the only thing that asks it now.
    this.fixedIsSafe = canUseFixed(this.elementRef?.nativeElement);
    if (!this.fixedIsSafe) return;

    // Undefined here means either "never placed" or "placed, but longer than
    // the cache's 24 hours ago" — and those two want the same treatment, so
    // nothing distinguishes them.
    const stored = loadWindowBox(this.storageScope, this.storageKey);

    if (stored) {
      this.applyWindowBox(
        clampBox(stored, window.innerWidth, window.innerHeight)
      );
      return;
    }

    // Never placed: float it at a sensible default rather than leaving it
    // anchored to whatever box it collapses to. Unconditional — the guard at
    // the top of this method already refused every mode that does not float,
    // and the `startMode === 'popup'` test that used to sit here was therefore
    // always true by the time it was reached.
    const box = this.defaultWindowBox();
    if (box) this.applyWindowBox(box);
  }

  /**
   * Where a floating panel sits before anyone has moved it.
   *
   * Icon mode anchors to the button: the panel's top-left corner lands on the
   * button's, so it opens over the control the visitor just pressed and grows
   * down and right from it. That is the one place their eye already is, and it
   * makes the relationship between the two obvious without an arrow or a tail.
   *
   * Popup mode has no such anchor and is centred on the viewport instead.
   *
   * Anchoring was tried once before, off the inline box's rect, and it failed
   * in popup mode for a reason worth keeping written down: the host element is
   * hidden while a popup is dismissed (see isDismissedPopup), so its rect is
   * 0x0 at the document origin. The measurement was not wrong, it was of
   * nothing, and the panel opened in the screen's top-left corner. Icon mode is
   * exactly the case that lacked — its button is on screen, and stays on screen
   * while the panel is up, so there is always a real rect to read.
   *
   * Either way the result goes through clampBox, so a button near the right or
   * bottom edge pulls the panel back inside the viewport rather than opening
   * half off it.
   */
  private defaultWindowBox(): EmbedWindowBox | null {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!vw || !vh) return null;

    // The inline box's width when it is measurable, because matching it means
    // the panel does not appear to change shape as it opens. Not in icon mode:
    // there the collapsed form is a nav entry a couple of hundred pixels wide
    // at most, and matching THAT would open a conversation in a column the
    // width of its own title. 420px, the middle of the range the clamp below
    // allows, is the answer for both that and popup's hidden host.
    const inlineWidth = this.isIconMode
      ? 0
      : this.embedShellRef?.nativeElement?.getBoundingClientRect()?.width || 0;

    const w = Math.min(Math.max(inlineWidth || 420, MIN_W), 460);
    const h = Math.min(560, Math.round(vh * 0.7));

    const anchor = this.iconAnchorRect();

    // Kept off the right edge by MOVING, not by narrowing.
    //
    // clampBox would otherwise handle this, and handle it wrongly for an anchor:
    // its x clamp allows a panel right up to the point where a minimum-width one
    // still fits, then shrinks the width to whatever is left. That is the right
    // rule for a panel a visitor has dragged there — they placed it, and the
    // panel yields — but for an opening position it means an icon near the end
    // of a bar opens a 280px-wide conversation. Sliding left until the panel
    // fits keeps its width and still leaves it over the button, which is what
    // the anchor was for. Left alone when it already fits, which is the common
    // case, and Math.max keeps a panel wider than the viewport from being
    // pushed off the other side.
    const anchoredX = anchor
      ? Math.max(0, Math.min(anchor.left, vw - w - EDGE_MARGIN))
      : (vw - w) / 2;

    // Rounded, because a half-pixel left offset makes the panel's own text
    // render on a subpixel boundary and look soft against the page.
    const x = Math.round(anchoredX);
    const y = Math.round(anchor ? anchor.top : (vh - h) / 2);

    return clampBox({ x, y, w, h }, vw, vh);
  }

  /**
   * The icon button's box, when there is one to read.
   *
   * Null outside icon mode, and null for a rect of nothing — a zero-width
   * measurement means the element is not laid out yet (or is display:none in
   * some host arrangement), and the corner of a box that is not there is the
   * document origin, which would park the panel in the screen's top-left.
   * Falling through to the centred default is the better answer for that.
   */
  private iconAnchorRect(): DOMRect | null {
    if (!this.isIconMode) return null;

    const rect = this.iconButtonRef?.nativeElement?.getBoundingClientRect();

    return rect && rect.width ? rect : null;
  }

  /**
   * Is the cursor in the widget's own input right now?
   *
   * Not `document.activeElement === inputEl`. This component renders into a
   * shadow root, and while focus is inside one, document.activeElement reports
   * the *host* element — <blue-search-embed-base> — never the input within it. That
   * comparison is therefore false even when the visitor is typing, which is
   * why the suggestion strip collapsed on every init regardless of focus.
   *
   * getRootNode() gives whichever root the input actually lives in, shadow or
   * document, and each root keeps its own activeElement. Written against the
   * root rather than hardcoding shadowRoot so it stays correct if the widget is
   * ever rendered without shadow DOM.
   */
  private isInputFocused(): boolean {
    const el = this.inputRef?.nativeElement;
    if (!el) return false;

    const root = el.getRootNode?.() as Document | ShadowRoot | undefined;
    const active = (root as any)?.activeElement ?? document.activeElement;

    return active === el;
  }

  override async doInit() {
    await super.doInit();

    // Cold start (or a re-init the visitor hasn't touched yet): keep the
    // suggestion strip collapsed until the input gets focus, same as the
    // inline box itself starts collapsed. super.doInit() just seeded
    // this.suggestions and set showSuggestions from the message count, so
    // don't clobber it here if the cursor is already in the input — a re-init
    // (a language switch, a new appId), or an autofocused box on load, should
    // not collapse the suggestions out from under someone about to use them.
    if (!this.isInputFocused()) this.showSuggestions = false;

    this.applyZIndexVar();

    const apply = () => this.applyEmbedTypographyVarsFrom(this.appOrWp);

    apply();
    setTimeout(apply, 0);
    setTimeout(apply, 50);
    setTimeout(apply, 150);
    setTimeout(apply, 400);
    requestAnimationFrame(apply);

    this.embedUiReady = true;

    // After super.doInit(), so the history it loads is what we judge.
    this.restoreOverlayState();

    // After restoreOverlayState(), because that is what decides whether the
    // panel comes up on load — popup mode, or a visitor returning to a
    // conversation they left open. Either way the lock has to match the state
    // the widget actually mounted in, not the state it would have had if it
    // started collapsed.
    this.watchMobileBreakpoint();
    this.syncBodyScrollLock();

    // Single-page hosts only: on a site that reloads, this never fires because
    // the component is torn down instead.
    this.hostNavCleanup = onHostNavigation(() =>
      this.zone.run(() => this.onHostNavigated()),
    );
  }

  /**
   * Raises the overlay once there is a conversation.
   *
   * Placed after super so the message is already in messages$ — and testing
   * isEmpty rather than "was this the first message" means a send that the base
   * class rejected (empty text, already sending) cannot open an empty panel,
   * while a send into an existing conversation correctly keeps it up.
   */
  protected override sendWithMessage(msg: string) {
    // Measured first: super pushes the message, and the very next render would
    // grow the box with the history it now has.
    const inlineHeight = this.measureInlineHeight();

    super.sendWithMessage(msg);

    if (!this.isEmpty) {
      if (inlineHeight) this.inlineHeightPx = inlineHeight;
      this.openOverlay();
    }
  }

  override ngAfterViewInit(): void {
    try { super.ngAfterViewInit?.(); } catch {}

    this.applyEmbedTypographyVarsFrom(this.appOrWp);
    queueMicrotask(() => this.applyEmbedTypographyVarsFrom(this.appOrWp));
    requestAnimationFrame(() => this.applyEmbedTypographyVarsFrom(this.appOrWp));

    this.watchMessageLinks();
  }

  /** Removes the link watcher — see watchMessageLinks(). */
  private messageLinkCleanup?: () => void;

  /**
   * Close the panel when the visitor follows a link out of a message.
   *
   * An answer cites its sources, so following one is a normal thing to do. On a
   * phone the panel is the whole screen, so the page the visitor asked for
   * opens behind a widget still covering it — and same-tab navigation is worse
   * rather than better, since the open flag is remembered across page loads and
   * the widget reopens on the destination, covering the very thing they clicked
   * to read.
   *
   * Every viewport, not only mobile. Following a link is the visitor turning
   * their attention to the page, and leaving the panel up over a desktop window
   * puts the thing they just asked for behind the thing they are done with.
   * Reopening costs one click, and the conversation is still there — nothing is
   * lost by closing, which is what makes the simpler rule the better one.
   *
   * Delegated from the shell rather than bound per link: message bodies are
   * rendered markdown, replaced wholesale on every update, so per-link handlers
   * would be attached to elements that no longer exist.
   *
   * Capture phase, and the panel is closed *before* the navigation rather than
   * after: once the browser starts unloading there is no guarantee any later
   * work runs, and the flag has to be written while the page is still alive.
   * Nothing is prevented — the link does exactly what it would have done.
   */
  private watchMessageLinks(): void {
    const root = this.embedShellRef?.nativeElement;
    if (!root) return;

    const onClick = (event: Event) => {
      // Real clicks only. Downloading an attachment works by building an
      // anchor and calling click() on it, which would otherwise read as the
      // visitor leaving — closing the panel every time they saved a file.
      if (!(event as MouseEvent).isTrusted) return;

      const anchor = (event.target as HTMLElement)?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute('href') || '';
      if (!href) return;

      // Goes nowhere: an in-page fragment, or a handler that will preventDefault
      // and do something in place.
      if (href.startsWith('#')) return;

      // Schemes that hand off to another app — mail, phone — leave the page
      // where it is, so the panel should stay too.
      const scheme = (anchor.protocol || '').toLowerCase();
      if (scheme && scheme !== 'http:' && scheme !== 'https:') return;

      this.collapseOverlay();
    };

    root.addEventListener('click', onClick, true);
    this.messageLinkCleanup = () => root.removeEventListener('click', onClick, true);
  }

  // ============================================================
  // Composer / suggestions
  // ============================================================

  /**
   * Grow the box with the text, up to the composer's cap.
   *
   * The cap and the overflow toggle are the point. This used to set the height
   * to scrollHeight unconditionally and never touch overflow-y, which was
   * harmless while the box was pinned to one line by CSS — but once it could
   * grow, the stylesheet's `overflow-y: auto` had nothing keeping it away, and
   * a scrollbar sat in the frame the whole time. A bar only once there is more
   * text than the box is allowed to show; the same rule the panel has always
   * used in onTextareaInput().
   *
   * Empty is handled on its own, before any measuring. Clearing the height and
   * stopping is the only way back to the box's natural one-row size: measuring
   * an empty textarea and writing the result back leaves an explicit height
   * where there should be none, and whatever that measurement returns is what
   * the box keeps. The panel's version has always had this branch; this one did
   * not need it while CSS pinned the box to a single line, and inherited the
   * gap the moment that cap came off for multiline.
   */
  private embedAutosizeTextarea() {
    const inputEl = this.inputRef?.nativeElement;
    if (!inputEl) return;

    if (!this.userMessage.trim()) {
      inputEl.style.height = '';
      inputEl.style.overflowY = 'hidden';
      return;
    }

    // Bounded by the window as well as by the composer's own cap — see
    // composerMaxHeight. The embed sits inside someone else's page and, in the
    // preview, inside a resizable box, so a flat pixel cap is a cap on the box
    // and not on the widget around it.
    const max = this.composerMaxHeight(this.composer?.maxHeightPx ?? 420);

    requestAnimationFrame(() => {
      try {
        inputEl.style.height = 'auto';
        inputEl.style.height = `${Math.min(inputEl.scrollHeight, max)}px`;
        inputEl.style.overflowY = inputEl.scrollHeight > max ? 'auto' : 'hidden';
      } catch {}
    });
  }

  // rulerVisible / emojiPickerVisible / useBrandSendIcon / onPaste /
  // onEmojiPicked all moved into ComposerComponent with the markup they belong
  // to. What stays here is what is about the conversation rather than the box.

  onEmbedInputChange() {
    this.embedAutosizeTextarea();

    const hasText = !!this.userMessage.trim();

    if (hasText) {
      this.showSuggestions = false;
    } else {
      // isInputFocused(), not document.activeElement — see its note. Clearing
      // the box back to empty while typing has to bring the suggestions back,
      // and the plain comparison never saw the focus that was plainly there.
      this.showSuggestions = this.isInputFocused() && (this.suggestions?.length || 0) > 0;
    }
  }


  onInputFocus() {
    // Collapsed with a conversation behind it: touching the input is the
    // visitor asking for it back. The alternative — typing into an inline box
    // whose history is hidden — reads as a lost conversation.
    this.reopenIfCollapsedWithHistory();

    if ((this.suggestions?.length || 0) > 0) {
      this.showSuggestions = true;
    }

    // Show the end of the conversation, which is what the visitor is about to
    // add to. Someone who scrolled up to re-read an earlier answer and then
    // clicked the input would otherwise type a message they cannot see appear.
    //
    // Two frames deep, not one: the click may have opened the panel
    // (reopenIfCollapsedWithHistory above) or shown the suggestion strip, and
    // both change the scroll container's height. One frame measures the box
    // before Angular has rendered the change; scrollOnNextOpen() waits for the
    // frame after, which is the same wait the open path already uses.
    //
    // Immediate rather than smooth: this is putting the view where it belongs
    // before the visitor types, not an animation for them to watch.
    this.scrollOnNextOpen();
  }

  /** Raises the panel again when the inline box is touched and history exists. */
  private reopenIfCollapsedWithHistory(): void {
    if (this.isOverlay) return;
    if (this.isEmpty) return;

    this.openOverlay();
  }

  onInputBlur() {

    setTimeout(() => {
      if (this.clickingSuggestion) return;
      if (!this.userMessage.trim()) this.showSuggestions = false;
    }, 0);
  }

  onSuggestionMouseDown() {
    this.clickingSuggestion = true;
  }

  onSuggestionClick(text: string) {
    const msg = (text || '').trim();
    this.clickingSuggestion = false;

    if (!msg || this.isSending) return;

    this.userMessage = '';
    this.embedAutosizeTextarea();
    this.sendWithMessage(msg);
  }

  override newConversation() {
    super.newConversation();

    // Back to the inline box: there is no conversation to show any more.
    //
    // Except in popup mode, where collapsing now removes the widget from the
    // page entirely — so "New chat" would dismiss the thing the visitor just
    // asked to start again. The panel stays up and empty instead, and
    // heightIsAuto shrinks it to its contents, which is the same shape it had
    // when it first opened.
    if (this.collapsesToSomething) this.collapseOverlay();

    this.clickingSuggestion = false;

    this.lastScrollMsgCount = 0;
    this.didInitialScroll = false;

    this.applyEmbedTypographyVarsFrom(this.appOrWp);

    // Suggestions last, and after everything else has had its say.
    //
    // Three things race for this flag when the visitor clicks "New chat", and
    // they used to land in the wrong order:
    //
    //   1. super.newConversation() sets it true and queues focusInput() in a
    //      requestAnimationFrame.
    //   2. This override set it straight back to false, for the collapse.
    //   3. Clicking the button blurred the textarea, and onInputBlur()'s
    //      setTimeout(0) sets it false as well — which can fire *after* the
    //      rAF focus, undoing the focus handler that had just restored it.
    //
    // The result was an empty conversation with no suggestions, and no way
    // back to them but clicking the input again. Deciding it here, in a
    // timeout queued after the blur's, makes the last word deterministic.
    this.showSuggestions = false;
    this.focusInput();

    setTimeout(() => {
      // Not if they have already started typing into the new conversation.
      if (this.userMessage.trim()) return;

      this.showSuggestions = (this.suggestions?.length || 0) > 0;
    }, 0);
  }

  private scrollHistoryToBottom() {
    const historyRef = this.historyRef;
    if (!historyRef) return;

    requestAnimationFrame(() => {
      const el = historyRef.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }

  private ensureDefaultsInWidgetParams(appOrWp: any): void {
    if (!appOrWp) return;

    if (!appOrWp.widgetParams || typeof appOrWp.widgetParams !== 'object') {
      appOrWp.widgetParams = {};
    }

    const wp = appOrWp.widgetParams as any;

    // Suggestions and info lines are not substituted here any more. The core
    // owns that: it waits for getApp(), and only if the call fails or never
    // returns does applyEmbeddedContentFallback() fill them — writing to
    // this.suggestions / this.infoText rather than into widgetParams, which is
    // what this used to do. That mattered: with no app loaded `appOrWp` hands
    // back a fresh {} on every read, so the values written here were discarded.

    const rawSmv = (wp as any).suggestionMaxVisible;

    let parsedSmv: number | null = null;

    if (typeof rawSmv === 'number' && Number.isFinite(rawSmv)) {
      parsedSmv = rawSmv;
    } else if (typeof rawSmv === 'string') {
      const s = rawSmv.trim();
      if (s !== '' && !isNaN(Number(s))) parsedSmv = Number(s);
    }

    if (parsedSmv != null && parsedSmv >= 2) {
      this.suggestionMaxVisible = Math.floor(parsedSmv);
    } else {
      const cur = Number(this.suggestionMaxVisible);
      if (!Number.isFinite(cur) || cur < 2) {
        this.suggestionMaxVisible = this.embedDefaultSuggestionMaxVisible;
      }
    }
  }

  ngDoCheck() {
    const appOrWp = this.appOrWp as any | undefined;

    if (appOrWp) {
      this.ensureDefaultsInWidgetParams(appOrWp);

      const snapshot = JSON.stringify({
        backColor: appOrWp.backColor,
        fontColor: appOrWp.fontColor,
        messageColor: appOrWp.messageColor ?? appOrWp.inputBg,
        logoSrc: appOrWp.logoSrc ?? this.logoSrc,
        enableSuggestion: appOrWp?.widgetParams?.enableSuggestion,
        suggestions: appOrWp?.widgetParams?.suggestions,
        infoText: appOrWp?.widgetParams?.infoText,
        suggestionMaxVisible: appOrWp?.widgetParams?.suggestionMaxVisible,
        wpFontFamily: appOrWp?.widgetParams?.fontFamily ?? appOrWp?.widgetParams?.uiFontFamily,
        wpFontSize: appOrWp?.widgetParams?.fontSize ?? appOrWp?.widgetParams?.uiFontSize,
        wpLineHeight: appOrWp?.widgetParams?.lineHeight ?? appOrWp?.widgetParams?.uiLineHeight,
        fontFamily: appOrWp?.fontFamily ?? null,
        fontSize: appOrWp?.fontSize ?? null,
        lineHeight: appOrWp?.lineHeight ?? null,
      });

      if (snapshot !== this.lastAppOrWpJson) {
        this.lastAppOrWpJson = snapshot;

        this.applyEmbedTypographyVarsFrom(appOrWp);
      }
    }

    const historyRef = this.historyRef;

    if (this.embedUiReady && historyRef) {
      const msgs = this.messages$?.() || [];
      const count = msgs.length;

      if (count > 0 && (!this.didInitialScroll || count !== this.lastScrollMsgCount)) {
        this.lastScrollMsgCount = count;
        this.didInitialScroll = true;
        this.scrollHistoryToBottom();
      }
    }
  }


}
