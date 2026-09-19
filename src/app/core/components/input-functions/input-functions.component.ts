// The ruler under the composer — a slim strip that holds the controls acting
// on the message being written: attaching a file or an image, and whatever
// else gets added beside them.
//
// A container, not a feature. It owns the strip's own look — the hairline
// above it, the height, the spacing between whatever sits on it — and nothing
// about what those controls do. Each function is its own component projected
// in, the way EmojiPickerComponent already is, so adding one is a line of
// markup in the composer rather than an edit here.
//
// Shared by both widget surfaces (the panel's composer and the embed's input
// row), so it ships its own stylesheet rather than relying on either surface.

import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-input-functions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './input-functions.component.html',
  styleUrl: './input-functions.component.css',
})
export class InputFunctionsComponent {
  /**
   * Where the controls sit on the strip.
   *
   * 'end' by default: these are tools acting on the message, and they read as
   * part of the composer when they sit under the send button rather than out
   * at the far edge. 'start' and 'between' remain for a strip that ends up
   * holding something that genuinely belongs on the other side — a character
   * count, say.
   */
  @Input() align: 'start' | 'end' | 'between' = 'end';

  /** Localized label lookup, passed down like every other widget component. */
  @Input() t: (key: string) => string = () => '';

}
