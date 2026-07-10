// Naver provider template: metadata, domain/origin hints, and safe defaults
// only. No proxy/fingerprint/bypass/evasion recipes.

export const naverProvider = {
  id: 'naver',
  label: 'Naver',
  metadata: {
    category: 'portal',
    notes: 'Korean web portal covering search, blog, and cafe surfaces under naver.com.'
  },
  domains: {
    primary: 'naver.com',
    aliases: ['www.naver.com', 'm.naver.com', 'nid.naver.com', 'search.naver.com', 'blog.naver.com', 'cafe.naver.com'],
    allowedOrigins: [
      'https://www.naver.com',
      'https://m.naver.com',
      'https://nid.naver.com',
      'https://search.naver.com',
      'https://blog.naver.com',
      'https://cafe.naver.com'
    ],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'naver',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'naver-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'Confirm the loaded page host is within naver.com before treating login/session state as valid.'
  ],
  safeFlowNotes: [
    'If a CAPTCHA, login challenge, or rate-limit response appears, stop the flow and report it as a diagnostic blocker; do not continue automated interaction.'
  ]
};
