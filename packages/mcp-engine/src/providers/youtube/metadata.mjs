// YouTube provider template: metadata, domain/origin hints, and safe
// defaults only. No proxy/fingerprint/bypass/evasion recipes.
//
// `youtu.be` is a redirect shortener, not a first-party cookie destination:
// it is a navigation-only alias and must never seed cookie.siteKey.

/**
 * Declarative YouTube provider metadata used for discovery and preflight.
 *
 * The domain and origin lists describe permitted first-party surfaces only.
 * `youtu.be` remains navigation-only because it redirects and must not become
 * the cookie site key; the safe-flow notes also require stopping on challenges
 * rather than attempting to bypass them.
 */
export const youtubeProvider = {
  id: 'youtube',
  label: 'YouTube',
  metadata: {
    category: 'video',
    notes: 'YouTube video platform including mobile, music, and studio hosts.'
  },
  domains: {
    primary: 'youtube.com',
    aliases: ['www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'studio.youtube.com'],
    navigationOnlyAliases: ['youtu.be'],
    allowedOrigins: [
      'https://www.youtube.com',
      'https://m.youtube.com',
      'https://music.youtube.com',
      'https://studio.youtube.com'
    ],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'youtube',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'youtube-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'youtu.be links are redirect shorteners; confirm the final loaded host lands on a youtube.com surface before treating navigation as successful.'
  ],
  safeFlowNotes: [
    'If a CAPTCHA, login challenge, or rate-limit response appears, stop the flow and report it as a diagnostic blocker; do not continue automated interaction.'
  ]
};
