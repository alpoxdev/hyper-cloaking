// TikTok provider metadata only. Short-link hosts are navigation-only.

export const tiktokProvider = {
  id: 'tiktok',
  label: 'TikTok',
  metadata: {
    category: 'social',
    notes: 'TikTok public video discovery and guarded owned-account engagement, inbound messaging, and publishing workflows.'
  },
  domains: {
    primary: 'tiktok.com',
    aliases: ['www.tiktok.com', 'm.tiktok.com'],
    navigationOnlyAliases: ['vm.tiktok.com', 'vt.tiktok.com'],
    allowedOrigins: ['https://www.tiktok.com', 'https://m.tiktok.com'],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'tiktok',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'tiktok-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'vm.tiktok.com and vt.tiktok.com are redirect shorteners; verify the final TikTok origin before continuing.'
  ],
  safeFlowNotes: [
    'Cold or bulk messaging and engagement, account, ads, live-commerce, delete, moderation, and unverifiable share actions are structurally blocked.'
  ]
};
