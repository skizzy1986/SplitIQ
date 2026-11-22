// The report form tells Slack which build the person was using. Native is the
// Android app; a standalone display is the installed PWA; everything else is
// the browser. Native wins, because the WebView can also look standalone.
export function clientPlatform({ native = false, standalone = false } = {}) {
  if (native) return 'android';
  if (standalone) return 'pwa';
  return 'web';
}
