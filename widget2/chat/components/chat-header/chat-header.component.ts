import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DEFAULT_WIDGET_THEME } from '../../../core/theme/default-widget-theme';
import { resolveHeaderText } from '../../../core/theme/header-contrast';
import { LangPickerComponent } from '../../../core/components/lang-picker/lang-picker.component';

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [CommonModule, LangPickerComponent],
  templateUrl: './chat-header.component.html',
  styleUrl: './chat-header.component.css',
})
export class ChatHeaderComponent {
  @Input() mode: 'compact' | 'full' = 'compact';

  @Input() title = 'Assistant';
  @Input() displayName?: string;

  @Input() logo?: string;
  @Input() logoAlt?: string;
  @Input() logoVisible = true;

  @Input() headerIsRound = true;
  @Input() headerLogoBg?: string;
  @Input() headerLogoInitialLocal = true;
  @Input() headerBg?: string | null;
  @Input() headerText?: string | null;

  @Input() t: (key: string) => string = () => '';

  /** The language being rendered, for the picker in the actions group. */
  @Input() currentLang = '';
  /**
   * Hide the language control entirely.
   *
   * Set when the host declared a language on the tag. That is an instruction
   * about what language this widget speaks, not a starting point — offering a
   * picker beside it would let a visitor contradict the embed and, because the
   * choice is then remembered, keep contradicting it on later visits. A site
   * that wants visitors to choose simply does not declare one.
   */
  @Input() langLocked = false;

  /**
   * `null` used to be read as a deliberate "make it transparent" signal —
   * but the backend sends widgetParams fields as `null`, not omitted, when
   * an app simply hasn't configured them (confirmed for logoSrc/title, same
   * pattern everywhere else). That made "not configured" indistinguishable
   * from "force transparent", so every app with no headerBg/headerText of
   * its own rendered a transparent header instead of the default theme —
   * there is no `<input type="color">` that can even produce a real null to
   * legitimately ask for transparency, so this only ever fired by accident.
   * `null`/undefined/'' all just mean "the app hasn't set one" now, which is
   * where the shared default theme kicks in.
   */
  get effectiveHeaderBg(): string {
    return this.headerBg || DEFAULT_WIDGET_THEME.headerBg;
  }

  /**
   * Derived from the header background, never configured.
   *
   * This used to pass the stored headerText and keep it whenever it cleared
   * WCAG's 3:1 floor for large text. 3:1 is the threshold for "legible", not
   * for "looks right": a dark navy title on a mid blue band passes it while
   * reading as a mistake beside icons that are near-white, which is exactly
   * what an app carrying a headerText from an earlier background looks like.
   *
   * So the configured value is no longer consulted at all — the same answer
   * reached for fontColor, and for the same reason: header background and
   * header text were independent settings, so the pair could always be made
   * wrong, and the failure is silent because each choice is reasonable alone.
   * resolveHeaderText still takes a `configured` argument for the signature's
   * sake; every caller in the widget now passes undefined.
   */
  get effectiveHeaderText(): string {
    return resolveHeaderText(undefined, this.effectiveHeaderBg);
  }

  get effectiveHeaderLogoBg(): string {
    return this.headerLogoBg || DEFAULT_WIDGET_THEME.headerLogoBg;
  }

  @Output() toggleFullscreen = new EventEmitter<HTMLButtonElement>();
  @Output() close = new EventEmitter<void>();
  @Output() newChat = new EventEmitter<void>();
  @Output() logoError = new EventEmitter<void>();

  /** A language the visitor chose. Relayed up: switching re-seeds the string
   *  packs and re-runs buildConfig, which is chat-core's work. */
  @Output() langPicked = new EventEmitter<string>();

  /**
   * chat-core's applyConfig() already guarantees `title` is never blank —
   * it falls back to the compiled pack for the active language before it
   * ever reaches this component. This is the last-resort backstop beneath
   * that, so it should use the same localized source (via `t()`, which
   * itself falls back to the pack) rather than a hardcoded English word.
   */
  get titleText(): string {
    return this.title || this.displayName || this.t('assistant') || 'Assistant';
  }

  onToggleFullscreen(btn: HTMLButtonElement) {
    this.toggleFullscreen.emit(btn);
  }
}
