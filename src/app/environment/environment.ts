// Local copy of the backend URL widget2 reads off the host app's
// src/environments/environment.ts and src/environments/env.common.ts (see
// widget2/README.md, and shared/README.md for the same pattern applied to
// shared-library).
//
// Originally two separate files/exports, one per host file — `environment`
// (build-swapped: dev/local URLs in environment.ts, the live Cloud Run URL
// in environment.prod.ts) and `backendUrl` (env.common.ts's fixed
// "dev-local" override target). Both are now pinned to the same production
// value here, so there was nothing left distinguishing the two — merged
// into one file with one constant, referenced under both names so
// core/settings.ts didn't need its call sites rewritten.
//
// widget2 no longer participates in the host's dev/prod build-time swap —
// it always resolves to the value below. A host that needs a different
// backend uses the normal override path instead: Settings.setBackendUrl() /
// the widget's `envurl` attribute.
//
// The real env.common.ts also carries firebaseConfig and several other
// service URLs (apiUrl, paymentApiUrl, notifyApiUrl, …) that nothing in
// widget2 reads — left out here on purpose, same trimming rule as
// widget2/shared.
const PUBLIC_API_URL = 'https://bluebootapi-cv5uqudw3q-uc.a.run.app';

export const environment = {
  publicApiUrl: PUBLIC_API_URL,
};

export const backendUrl = {
  publicApiUrl: PUBLIC_API_URL,
};
