// The PM5 list on the native connect screen. A row is
// {id, name, lastSeen, stale}. Rows are never removed here: a monitor not seen
// for a while is marked stale and keeps its place, so nothing moves under a
// finger. Both functions return {list, changed}: `changed` is true only when
// the screen would differ (a row joined, got its name or a new id, went stale
// or came back), so a scan result that merely refreshes lastSeen does not
// redraw anything.

// Merge one scan result. Rows keep first-seen order and new ones append.
export function upsertMonitor(list, { deviceId, name }, now) {
  if (!deviceId) return { list, changed: false };
  const named = name || null;
  let index = list.findIndex((m) => m.id === deviceId);
  let changed = false;
  if (index === -1 && named) {
    // The same monitor seen under a new address (Android can rotate it):
    // the row keeps its place and takes the new id.
    index = list.findIndex((m) => m.name === named);
    if (index !== -1) changed = true;
  }
  if (index === -1) {
    return {
      list: [
        ...list,
        { id: deviceId, name: named, lastSeen: now, stale: false },
      ],
      changed: true,
    };
  }
  const row = list[index];
  if ((!row.name && named) || row.stale) changed = true;
  if (!changed && row.lastSeen === now) return { list, changed: false };
  const next = list.slice();
  next[index] = {
    id: deviceId,
    name: row.name || named,
    lastSeen: now,
    stale: false,
  };
  return { list: next, changed };
}

// Mark rows not seen for staleMs as stale, in place. The same list comes back
// when none went stale.
export function expireMonitors(list, now, staleMs) {
  let changed = false;
  const next = list.map((m) => {
    if (m.stale || now - m.lastSeen < staleMs) return m;
    changed = true;
    return { ...m, stale: true };
  });
  return changed ? { list: next, changed } : { list, changed: false };
}
