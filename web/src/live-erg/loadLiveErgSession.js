// Lazy seam for the v10 live-session port. App.jsx / ErgView can call this
// after #697 lands so the module stays out of the first-paint graph.
export function loadLiveErgSession() {
  return import('./LiveErgSession.jsx');
}

// The planner shares the live screen's chunk, so planning at home costs no
// extra download beyond it. Opened from Train with no PM5 connected.
export function loadLiveErgPlanner() {
  return import('./LiveErgSession.jsx').then((m) => ({
    default: m.LiveErgPlanner,
  }));
}
