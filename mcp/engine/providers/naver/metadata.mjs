/**
 * Static Naver provider metadata used by the registry without loading actions.
 *
 * Auth-only `nid.naver.com` is retained as an alias but excluded from action
 * navigation origins.
 */

/**
 * Registry descriptor for Naver's guarded search, content, engagement, and
 * publishing capabilities.
 */
export const naverProvider = {
  id: 'naver',
  label: 'Naver',
  metadata: {
    category: 'portal',
    notes: 'Korean web portal covering guarded search, blog, and cafe discovery plus owned-account blog/cafe engagement and publishing workflows.'
  },
  domains: {
    primary: 'naver.com',
    aliases: ['www.naver.com', 'm.naver.com', 'nid.naver.com', 'search.naver.com', 'blog.naver.com', 'cafe.naver.com'],
    allowedOrigins: [
      'https://www.naver.com',
      'https://search.naver.com',
      'https://blog.naver.com',
      'https://cafe.naver.com'
    ],
    disallowedOrigins: ['https://nid.naver.com']
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
    'nid.naver.com only ever serves the login/auth flow; action navigation must stay on search, blog, and cafe surfaces.'
  ],
  safeFlowNotes: [
    'If a CAPTCHA, login challenge, or rate-limit response appears, stop the flow and report it as a diagnostic blocker; do not continue automated interaction.',
    'Cafe join/admin/moderation, mail, messaging, account, login, shopping, payment, ordering, ads, bulk delete/edit, and restriction-bypass actions are structurally blocked.'
  ]
};
