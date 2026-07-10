// X (formerly Twitter) provider template: metadata, domain/origin hints, and
// safe defaults only. No proxy/fingerprint/bypass/evasion recipes.
//
// `t.co` is a redirect shortener, not a first-party cookie destination: it
// is a navigation-only alias and must never seed cookie.siteKey.

export const xProvider = {
  id: 'x',
  label: 'X',
  metadata: {
    category: 'social',
    notes: 'X (formerly Twitter) social platform including legacy twitter.com hosts and the mobile host.'
  },
  domains: {
    primary: 'x.com',
    aliases: ['www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
    navigationOnlyAliases: ['t.co'],
    allowedOrigins: [
      'https://www.x.com',
      'https://twitter.com',
      'https://www.twitter.com',
      'https://mobile.twitter.com'
    ],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'x',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'x-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    't.co links are redirect shorteners; confirm the final loaded host lands on an x.com or twitter.com surface before treating navigation as successful.'
  ],
  safeFlowNotes: [
    'If a login challenge, CAPTCHA, or rate-limit response appears, stop the flow and report it as a diagnostic blocker; do not continue automated interaction.'
  ]
};
