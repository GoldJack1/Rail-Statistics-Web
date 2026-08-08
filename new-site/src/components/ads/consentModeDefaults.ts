/**
 * Google Consent Mode v2 defaults — must run in <head> before AdSense / Analytics.
 *
 * UK/EEA/CH start denied so AdSense Privacy & messaging can update after choice.
 * Other regions default to granted (Google's CMP only updates users who see the
 * European regulations message).
 *
 * @see https://support.google.com/adsense/answer/10961068
 * @see https://developers.google.com/tag-platform/security/guides/consent
 */
export const CONSENT_MODE_DEFAULTS_SCRIPT = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  functionality_storage: 'granted',
  security_storage: 'granted',
  wait_for_update: 500,
  region: [
    'AT','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR',
    'HU','IE','IS','IT','LI','LT','LU','LV','MT','NL','NO','PL','PT','RO','SE',
    'SI','SK'
  ]
});
gtag('consent', 'default', {
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  analytics_storage: 'granted',
  functionality_storage: 'granted',
  security_storage: 'granted'
});
`.trim()
