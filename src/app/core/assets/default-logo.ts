// src/app/widget2/core/assets/default-logo.ts
//
// The Blue Search mark, in both themes, inlined as data: URIs.
//
// Embedded rather than linked because the widget runs on arbitrary customer
// sites: there is no asset path it can rely on, and a CDN URL is a runtime
// dependency on a host the embedding page has no reason to reach. These used to
// be resolved at runtime — the logo as a backend default in widgetParams, the
// send icon as a path joined onto assetsBase — so both could paint late, or not
// at all on a site that does not serve /assets.
//
// SOURCE FILES (regenerate by base64-encoding these; they are the originals):
//   dark  -> src/assets/img/Bluesearch_forstørrelsesglass_gråblå.png   (12,996 B)
//   light -> src/assets/img/Bluesearch_forstørrelsesglass_hvit.png     ( 9,127 B)
//
// The dark mark serves double duty: it is both the default logo/launcher icon
// and the dark-theme send icon, so it is stored once.
//
// The send icon is fixed: it is always the mark below, never anything from the
// app config. Nothing in widgetParams feeds it, and it is not meant to — see
// sendIconFor() at the foot of this file. The *logo* is the configurable one
// (widgetParams.logoSrc -> computedLogo()); these two are separate on purpose.

import { backgroundLuminance } from '../theme/header-contrast';

/**
 * The grey-blue mark. Default logo, launcher button icon, and the send icon on
 * light surfaces (see sendIconFor).
 *
 * From src/assets/img/Bluesearch_forstørrelsesglass_gråblå.png — ~16.9 KB here.
 */
export const DEFAULT_LOGO_DATA_URI =
  'data:image/png;base64,' +
  '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' +
  'sVzv3J/XYtZy1nbl6eRtyhte57auZj20PnZ91wa9DfkbRjf6bDy+ibQpadPvmy03l2x+tyV8S3u+Zv7G/JGtPlsbC2QKhAUD25y2' +
  'VW/HbOdv79ths6Nix7dCbuGNIsuisqIvOzk7b/xk9VP5T7O74nb1FdsVH9qN2y3Y/WCPy57jJfIluSUje5fubSlllBaWvtu3Zt/1' +
  'soVl1ftJ+8X7JeVLytsq9Ct2V3ypTKi8X+Ve1XxA48COAx8Ocg/eOeR6qKlas7qo+vNh/uGHNT41LbWGtWVHcEcyjzyvC6vr+Zn1' +
  'c/1RtaNFR78eExyTHA8+3l1vX1/foNFQ3Ag3ihsnTkSfuP2L5y9tTcymmmal5qKT4KT45ItfY359cCrgVNdp1ummMwZnDpylnS1s' +
  'gVpyWqZaE1olbZFt/ef8z3W1O7Wf/c38t2MdOh1V5xXPF18gXci/MHsx9+J0Z1rn5KX4SyNda7oGL0dcvte9vLvvSsCVa1e9r17u' +
  'ceu5eM35Wsd1x+vnbrButN60u9nSa9t79nfb38/22fW13LK/1Xbb4XZ7/6L+C3dc7ly663n36j2/ezfvL7vf/yD0wcOB6AHJQ+7D' +
  '8UfJj14/znw8M7hxCDtU+ETuSdlTjae1f5j80Syxk5wf9hzufbbi2eAIZ+Tlnxl/fhnNf059XjamPVY/bj3eMeE9cfvFyhejL9Ne' +
  'zkwW/CX/14FXxq/O/O36d+9UxNToa+Hr2Tc736q+PfZu4buu6aDpp+9T3s98KPyo+vH4J9anns/hn8dmsr7gv5R/Nfna/i3g29Bs' +
  'yuzsD97EHLUljO++xJMXxxYnixhSw+KRmpwqFjJWpLE5PAaTITUx/zefElsBQOtWAFQef9dQBM0/5n3bHH7wl/8A/D0PUUKXDSrV' +
  'fddSawFgTaP67gx+/JzmERzC+GEOzGBeHE/IE6BXDePzsviCePT+Ai5fxE8VMPgCxj/G9G/c/Ud87/O7ZxbxskVzfaam5Qj58Qki' +
  'hp9AxBMK2NKO2MlzX0co7TEjVSjii1MWMKwtLR0AyIizsZ4rBVFQ74z9Y3b2rSEA+FIAvhbPzs7UzM5+RWeBDALQKf4PCj/Z9pUc' +
  'TOcAAAAJcEhZcwAACxIAAAsSAdLdfvwAACAASURBVHic7d3Xc1zHvSdwv+3jPuzD3bo2SWRgMEhMIHIcTMAkBBJEmhlMHgxyDiQl' +
  '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' +
  'P/XTRu1fy98TAAAAAElFTkSuQmCC';

/**
 * The white mark, for dark surfaces (see sendIconFor).
 *
 * From src/assets/img/Bluesearch_forstørrelsesglass_hvit.png — ~11.9 KB here.
 */
export const DEFAULT_LOGO_LIGHT_DATA_URI =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAVcAAAFVCAYAAABb+awTAAAACXBIWXMAAC4jAAAuIwF4pT92AAAF0WlUWHRYTUw6Y29tLmFkb2Jl' +
  'LnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4' +
  'bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4xLWMwMDIgNzkuYTZhNjM5NjhhLCAyMDI0' +
  'LzAzLzA2LTExOjUyOjA1ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjIt' +
  'cmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5j' +
  'b20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJo' +
  'dHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4w' +
  'L21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNy' +
  'ZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjUuOSAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjUtMTAtMjNUMTE6' +
  'NDc6MTkrMDI6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDI1LTExLTA1VDEzOjA5OjE0KzAxOjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIy' +
  'MDI1LTExLTA1VDEzOjA5OjE0KzAxOjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgeG1w' +
  'TU06SW5zdGFuY2VJRD0ieG1wLmlpZDpiY2VlMjdmNS0wYzE2LTQ5NTctOTIyNi02YmYwZWFiNzZjY2QiIHhtcE1NOkRvY3VtZW50' +
  'SUQ9ImFkb2JlOmRvY2lkOnBob3Rvc2hvcDo4MTFjZmRkYi0wYWVmLWFkNDgtYmNjZi0xMDc0YjEyYjk5ZGIiIHhtcE1NOk9yaWdp' +
  'bmFsRG9jdW1lbnRJRD0ieG1wLmRpZDozZTFjYzEyYS1iNjFhLTQ5ZTUtODZjZC1hOTAxYjA5YzhiNjEiPiA8eG1wTU06SGlzdG9y' +
  'eT4gPHJkZjpTZXE+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJjcmVhdGVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjNlMWNj' +
  'MTJhLWI2MWEtNDllNS04NmNkLWE5MDFiMDljOGI2MSIgc3RFdnQ6d2hlbj0iMjAyNS0xMC0yM1QxMTo0NzoxOSswMjowMCIgc3RF' +
  'dnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIDI1LjkgKE1hY2ludG9zaCkiLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249' +
  'InNhdmVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOmJjZWUyN2Y1LTBjMTYtNDk1Ny05MjI2LTZiZjBlYWI3NmNjZCIgc3RF' +
  'dnQ6d2hlbj0iMjAyNS0xMS0wNVQxMzowOToxNCswMTowMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIDI1' +
  'LjkgKE1hY2ludG9zaCkiIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4gPC9yZGY6U2VxPiA8L3htcE1NOkhpc3Rvcnk+IDwvcmRmOkRlc2Ny' +
  'aXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+aek8eAAAHXxJREFUeJzt3UFuI0l69vH/' +
  '2N4YGEA5JxB7b6BygA/wwovKXnrVnBNU9gmac4Jhn2BUJ2jWCYa1865TJ2jqBJM6gSnAgL2wUd8iyCpKJZVIKYPPG5nPDxBquqeb' +
  '79sS+SgyMiLyd58+fcLMzIb1D+oGzMzGyOFqZpaBw9XMLAOHq5lZBg5XM7MMHK5mZhk4XM3MMnC4mpll4HA1M8vA4WpmloHD1cws' +
  'A4ermVkGDlczswwcrmZmGThczcwycLiamWXgcDUzy8DhamaWgcPVzCwDh6uZWQYOVzOzDByuZmYZOFzNzDJwuJqZZeBwNTPLwOFq' +
  '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';

/**
 * The send-button mark for a given surface.
 *
 * Fixed by design: always one of the two marks above, never anything from the
 * app config. It is the product's own mark on its own button, not the
 * customer's logo — widgetParams.logoSrc is the configurable one and feeds
 * computedLogo(), which paints the header and the avatars.
 *
 * This lives here, beside the assets, rather than in buildConfig, because it is
 * not configuration: routing it through the config meant the value took a round
 * trip through the backend's answer to arrive at a constant, and left a
 * `sendIconReady` field on the config result that settings could appear to
 * write. They cannot, and now nothing suggests they can.
 *
 * `background` is the ground the button sits on — the message colour, since the
 * input frame is painted as a message background. The mark is a raster image,
 * so no colour reaches it and swapping the asset is the only way it inverts.
 * Unreadable or absent leaves the grey-blue mark, which is what shipped.
 *
 * 0.62, the same threshold header-contrast uses: near-white starts failing on
 * mid-tones well before they are objectively light.
 */
export function sendIconFor(background?: string): string {
  const luminance = backgroundLuminance(background);

  return luminance !== undefined && luminance <= 0.62
    ? DEFAULT_LOGO_LIGHT_DATA_URI
    : DEFAULT_LOGO_DATA_URI;
}
