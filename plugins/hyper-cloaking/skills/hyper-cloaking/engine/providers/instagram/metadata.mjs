// Instagram provider template: metadata, domain/origin hints, and safe
// defaults only. No proxy/fingerprint/bypass/evasion recipes.

/**
 * Schema-validated Instagram provider metadata used by the provider registry.
 * Origins and flow notes describe safe defaults; no automation or evasion
 * configuration is included.
 */
export const instagramProvider = {
  id: 'instagram',
  label: 'Instagram',
  metadata: {
    category: 'social',
    notes: 'Instagram social media and photo/video sharing platform including mobile and help center hosts.'
  },
  domains: {
    primary: 'instagram.com',
    aliases: ['www.instagram.com', 'm.instagram.com', 'help.instagram.com'],
    allowedOrigins: [
      'https://www.instagram.com',
      'https://m.instagram.com',
      'https://help.instagram.com'
    ],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'instagram',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'instagram-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'Confirm the loaded page host is within instagram.com before treating login/session state as valid.'
  ],
  safeFlowNotes: [
    'If a login challenge, CAPTCHA, or rate-limit response appears, stop the flow and report it as a diagnostic blocker; do not continue automated interaction.'
  ]
};
