// Coupang provider metadata only. The registry imports this module without loading actions.
// link.coupang.com is navigation-only and must never seed a cookie site key.

export const coupangProvider = {
  id: 'coupang',
  label: 'Coupang',
  metadata: {
    category: 'ecommerce',
    notes: 'Coupang product discovery and owned-account cart, saved-item, and review workflows.'
  },
  domains: {
    primary: 'coupang.com',
    aliases: ['www.coupang.com', 'm.coupang.com'],
    navigationOnlyAliases: ['link.coupang.com'],
    allowedOrigins: ['https://www.coupang.com', 'https://m.coupang.com'],
    disallowedOrigins: []
  },
  cookie: {
    siteKey: 'coupang',
    accountHint: null,
    required: false
  },
  profile: {
    label: 'coupang-default',
    persistentRecommended: true
  },
  preflight: {
    headlessDefault: true,
    cookieModeDefault: 'optional',
    credentialSensitivity: 'account-session',
    allowedOriginsPrompt: true
  },
  outcomeHints: [
    'link.coupang.com is a redirect shortener; verify the final loaded origin before using the target.'
  ],
  safeFlowNotes: [
    'Checkout, ordering, payment, address, credential, cancellation, return, coupon-abuse, and seller operations are structurally blocked.'
  ]
};
