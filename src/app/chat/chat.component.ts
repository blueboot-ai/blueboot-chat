// src/app/widget2/chat/chat.component.ts
//
// The full chat panel (<blue-search>), used by widget2's launcher.
//
// All behaviour lives in ChatCoreComponent. What this class adds:
//   1. the @Input() surface the launcher binds (~29 attributes)
//   2. the composer sub-component wiring (inputRef / composerRef)
//   3. panel chrome the embed has no equivalent for (logo error state,
//      fullscreen toggle, close button)
//
// Inputs are declared here rather than on the base on purpose: Angular merges
// @Input metadata down the prototype chain, so anything declared on
// ChatCoreComponent would also become bindable on EmbedComponent and could
// never be removed there. See the header of chat-core.component.ts.

import {
  Component,
  ElementRef,
  ViewChild,
  Input,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ChatCoreComponent } from '../core/chat-core.component';
import { DEFAULT_WIDGET_THEME } from '../core/theme/default-widget-theme';

import { ChatHeaderComponent } from './components/chat-header/chat-header.component';
import { MessageComponent } from '../core/components/message/message.component';
import { ComposerComponent } from '../core/components/composer/composer.component';
import { ChatSuggestionsComponent } from './components/chat-suggestions/chat-suggestions.component';

@Component({
  selector: 'blue-search',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ChatHeaderComponent,
    MessageComponent,
    ComposerComponent,
    ChatSuggestionsComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class ChatComponent extends ChatCoreComponent {
  // No LauncherPositionService reference here on purpose: the launcher
  // button and the panel's position/size are decided entirely by
  // LauncherPositionService via LauncherComponent's setup() call, which
  // writes directly onto #bbc-launcher/#bbc-wrapper in the launcher's own
  // shadow root. This component just renders inside whatever box that
  // wrapper is already sized to — it must never compute, read, or display
  // anything about where the launcher icon is.

  // ============================================================
  // Inputs — re-declared from ChatCoreComponent's plain fields.
  // The property names and attribute aliases are unchanged, so the
  // launcher template binds exactly as before.
  // ============================================================

  /** The backend serving this assistant, as a full base URL. Same meaning as
   *  the embed's — see Settings.setBackendUrl(). */
  @Input('envurl') declare envUrl?: string;
  @Input('appid') declare appId?: string;
  @Input('gptid') declare gptId?: string;

  /**
   * Which installation this is, when a page has more than one widget.
   *
   * Same meaning and the same effect as the embed's — see StorageScope. Two
   * widgets for one app+gpt otherwise share their history, open flag and
   * visitor cache, and are the same conversation shown twice.
   *
   * Optional; absent leaves the storage keys exactly as they were.
   */
  @Input('assistantid') declare assistantId?: string;

  /**
   * The language to render in, as a bare tag: "no", "de", "en".
   *
   * The panel had none at all, so a launcher install could not state a language
   * — it fell through to the host page's own preference and then the browser's,
   * with no way for the site to say otherwise.
   *
   * One parameter, not a `lang`/`defaultLang` pair: they are the same statement
   * from a host's point of view, and offering both only raises the question of
   * which wins. It is a *default* in the sense that matters — a language the
   * visitor picked in the widget outranks it (see resolveStartingLang), because
   * what a site declares is about visitors who have not said what they want.
   */
  @Input('defaultlang') override defaultLang: string = '';

  // Optional color overrides. appOrWp has no concept of an explicit
  // override (it's a pure getter onto the fetched app config), so these
  // are checked first, ahead of appOrWp, everywhere colors are read in the
  // template below — same precedence as the typography inputs above them.
  // Aliased to lowercase like every other parameter on this element. A custom
  // element only ever sees lowercased attribute names — HTML lowercases them —
  // so a camelCase alias is reachable from an Angular template and from
  // nowhere else, which is the kind of difference that looks like a bug when a
  // customer copies a snippet out of an Angular app into a plain page.
  @Input('backcolor')  declare backColor?: string;
  @Input('headerbg')   headerBg?: string;
  @Input('headertext') headerText?: string;

  /**
   * Background of the message bubbles, both the assistant's and the visitor's.
   *
   *     <blue-search messagecolor="#ffffff" ...>
   *
   * The same parameter the embed takes, and for the same reason — see the note
   * on EmbedComponent.messageColor. The panel had only backColor, so tinting
   * the panel left the bubbles white with no way to say otherwise, and a host
   * that wanted the bubbles tinted instead had no parameter at all.
   *
   * One colour for both kinds of bubble, as in the embed. The visitor's bubble
   * keeps its own border, which is what still tells the two apart.
   */
  @Input('messagecolor') declare messageColor?: string;

  /**
   * Every piece of text in the panel's conversation.
   *
   *     <blue-search fontcolor="#1e3a8a" ...>
   *
   * The same parameter the embed takes — see EmbedComponent.fontColor. The
   * panel had none, so its text was pinned to a hardcoded near-black and the
   * feed could not follow a configured palette the way the embed's does.
   *
   * Set on the conversation, not on the chrome: the header derives its own text
   * from headerBg, and the composer's icons and caret derive theirs from the
   * message colour, because each has to be readable on the surface it sits on.
   */
  @Input('fontcolor') fontColor?: string;

  /**
   * Header title, overriding whatever the app config resolves to.
   *
   * The same parameter the embed takes — see EmbedComponent's titleInput. It
   * writes chat-core's titleOverride, which setTitle() then prefers over every
   * other source, so precedence lives in one place rather than in whichever
   * caller ran last.
   *
   * It exists here because the panel had no way to be told its name: a host
   * embedding <blue-search> directly, or a launcher forwarding a title, could
   * only get the configured one. Empty means unset — a host asking for no
   * title is asking for the default, not for a blank bar.
   */
  @Input('title')
  set titleInput(value: string | undefined) {
    this.titleOverride = (value || '').trim();
    if (this.titleOverride) this.setTitle(this.titleOverride);
  }

  /**
   * Typography, as the embed takes it.
   *
   * These exist because chat-core's applyTypographyVars() writes
   * --bb-font-size-base *on this element* from the app config whenever the
   * config carries one — and a property set on the element beats one inherited
   * from the launcher host, where LauncherComponent writes its own `fontsize`
   * parameter. Without an input here there was no way for a host's stated size
   * to outrank the configured one: the parameter was accepted on the launcher
   * and then silently discarded one shadow tree down. applyTypographyVars()
   * checks these fields before the api* ones, so declaring them is the fix.
   */
  @Input('fontfamily') declare fontFamily?: string;
  @Input('fontsize')   declare fontSize?: string;
  @Input('lineheight') declare lineHeight?: string;

  // camelCase spellings of the same parameters. Lowercase is the documented
  // name; these exist so the other spelling works too rather than failing in an
  // Angular template while passing silently in plain HTML. See the longer note
  // in embed.component.ts — the reasoning is the same, and so is the rule that
  // each setter writes the real property so the component reads one field.
  @Input('envUrl')      set envUrlCamel(v: string | undefined)      { this.envUrl = v; }
  @Input('appId')       set appIdCamel(v: string | undefined)       { this.appId = v; }
  @Input('gptId')       set gptIdCamel(v: string | undefined)       { this.gptId = v; }
  @Input('assistantId') set assistantIdCamel(v: string | undefined) { this.assistantId = v; }
  @Input('defaultLang') set defaultLangCamel(v: string)             { this.defaultLang = v; }
  @Input('backColor')   set backColorCamel(v: string | undefined)   { this.backColor = v; }
  @Input('headerBg')    set headerBgCamel(v: string | undefined)    { this.headerBg = v; }
  @Input('headerText')  set headerTextCamel(v: string | undefined)  { this.headerText = v; }
  @Input('messageColor') set messageColorCamel(v: string | undefined) { this.messageColor = v; }
  @Input('fontColor')   set fontColorCamel(v: string | undefined)    { this.fontColor = v; }
  @Input('fontFamily')  set fontFamilyCamel(v: string | undefined)  { this.fontFamily = v; }
  @Input('fontSize')    set fontSizeCamel(v: string | undefined)    { this.fontSize = v; }
  @Input('lineHeight')  set lineHeightCamel(v: string | undefined)  { this.lineHeight = v; }

  /** Same suggested defaults widget2/embed falls back to — see the header of
   *  default-widget-theme.ts. Exposed so the template can read it directly. */
  protected readonly DEFAULT_THEME = DEFAULT_WIDGET_THEME;

  // ============================================================
  // Composer wiring
  //
  // The base returns undefined for both refs (it renders no composer of its
  // own); this panel routes them at the ComposerComponent child, which is what
  // makes autosize, focus and ArrowUp/Down input history work here.
  // ============================================================

  @ViewChild(ComposerComponent) chatComposer?: ComposerComponent;

  override get inputRef(): ElementRef<HTMLTextAreaElement> | undefined {
    return this.chatComposer?.inputRef;
  }

  override get composerRef(): ElementRef<HTMLElement> | undefined {
    return this.chatComposer?.composerRef;
  }

  // ============================================================
  // Panel chrome — no embed equivalent
  // ============================================================

  logoVisible = true;
  onLogoError() { this.logoVisible = false; }

  onToggleFullscreenClick(el: HTMLElement) {
    const pressed = el.getAttribute('aria-pressed') === 'true';
    const next = !pressed;

    el.setAttribute('aria-pressed', String(next));

    this.elementRef.nativeElement.dispatchEvent(new CustomEvent('bbc-toggle-fullscreen', {
      detail: { on: next },
      bubbles: true,
      composed: true,
    }));
  }

  onCloseClick() {
    this.hideSelectionAction();
    this.clearInputHistory();

    this.elementRef.nativeElement.dispatchEvent(
      new CustomEvent('bbc-close', { bubbles: true, composed: true })
    );
  }
}
