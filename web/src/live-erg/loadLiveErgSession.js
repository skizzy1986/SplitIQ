// Lazy seam for the v10 live-session port. App.jsx / ErgView can call this
// after #697 lands so the module stays out of the first-paint graph.
export function loadLiveErgSession() {
  return import('./LiveErgSession.jsx');
}
