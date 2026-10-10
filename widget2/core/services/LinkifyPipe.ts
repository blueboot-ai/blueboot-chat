import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'linkify',
  standalone: true, // <-- easiest way to use it without touching a module
})
export class LinkifyPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    if (!text) return '';

    // 1) URLs (http/https or www.)
    const urlRegex = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.)])/gi;

    // 2) Emails
    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

    let html = text
      .replace(urlRegex, (raw) => {
        const href = raw.startsWith('www.') ? `https://${raw}` : raw;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${raw}</a>`;
      })
      .replace(emailRegex, (raw) => {
        return `<a href="mailto:${raw}">${raw}</a>`;
      });

    // 3) Preserve newlines
    html = html.replace(/\n/g, '<br>');

    return html;
  }
}
