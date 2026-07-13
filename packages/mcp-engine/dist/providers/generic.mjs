// Generic fallback provider: used for URL auto-resolution of unknown hosts
// only. Never authorizes broader origins or cookie loading.

/** Fallback provider contract for unknown public HTTPS hosts; it never authorizes broader origins or cookie loading. @type {{id:string,label:string,metadata:object,domains:object,cookie:object,profile:object,preflight:object,outcomeHints:string[],safeFlowNotes:string[]}} */
export const genericProvider = {
  id: 'generic',
  label: 'Generic',
  metadata: {
    category: 'generic',
    notes: 'Fallback metadata for public HTTPS targets that do not match a known site provider.'
  },
  domains: {
    // generic is excluded from domain matching by the registry (matched by
    // exclusion, not inclusion); this hostname is a schema placeholder only.
    primary: 'generic.invalid',
    aliases: [],
    allowedOrigins: [],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'default',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'default',
    persistentRecommended: false
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'none',
    credentialSensitivity: 'low',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'Confirm the loaded page host and title/text match the requested target before treating navigation as successful.'
  ],
  safeFlowNotes: [
    'If a CAPTCHA, WAF block, login challenge, or rate-limit response is observed, stop the flow and report it as a diagnostic blocker; do not attempt automated interaction with it.'
  ]
};
