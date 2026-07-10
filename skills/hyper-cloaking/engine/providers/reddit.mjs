// Reddit provider template: metadata, domain/origin hints, and safe defaults
// only. No proxy/fingerprint/bypass/evasion recipes.
//
// `redd.it` is a redirect shortener, not a first-party cookie destination:
// it is a navigation-only alias and must never seed cookie.siteKey.

export const redditProvider = {
  id: 'reddit',
  label: 'Reddit',
  metadata: {
    category: 'social',
    notes: 'Reddit community and discussion platform including legacy old/new front-end hosts and the OAuth API host.'
  },
  domains: {
    primary: 'reddit.com',
    aliases: ['www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'oauth.reddit.com'],
    navigationOnlyAliases: ['redd.it'],
    allowedOrigins: [
      'https://www.reddit.com',
      'https://old.reddit.com',
      'https://new.reddit.com',
      'https://oauth.reddit.com'
    ],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'reddit',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'reddit-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'redd.it links are redirect shorteners; confirm the final loaded host lands on a reddit.com surface before treating navigation as successful.'
  ],
  safeFlowNotes: [
    'If a login wall, CAPTCHA, or rate-limit response appears, stop the flow and report it as a diagnostic blocker; do not continue automated interaction.'
  ]
};
