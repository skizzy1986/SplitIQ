import { normType } from './formatting.js';
import { isCompletedStatus, isCancelledStatus } from './sessionStatus.js';

// One mapping/partition contract for both layouts. Input order is preserved;
// callers already read sessions by training date, not insertion date.
export function selectSessionLog(rows = []) {
  const allSessions = rows
    .filter((row) => row.type !== 'Test')
    .map((row) => {
      const raw = (row.type || '').toLowerCase();
      return {
        date: row.date,
        type: normType(row.type, row.label),
        label: row.label,
        duration: row.duration,
        srpe: row.srpe,
        prs: row.prs,
        exercises: row.exercises || undefined,
        coachNote: row.coach_note || undefined,
        status: row.status,
        distance_m: row.distance_m,
        avg_watts: row.avg_watts,
        avg_hr: row.avg_hr,
        _isErg: raw === 'erg',
        _isCycling: ['cycling', 'bike', 'ride'].includes(raw),
        _fromDb: true,
        _id: row.id,
      };
    });
  const loggedSessions = [];
  const logDisplaySessions = [];
  const cancelledSessions = [];
  const plannedSessions = [];
  for (const entry of allSessions) {
    if (entry.status === 'planned') {
      plannedSessions.push(entry);
      continue;
    }
    logDisplaySessions.push(entry);
    if (isCompletedStatus(entry.status)) loggedSessions.push(entry);
    if (isCancelledStatus(entry.status)) cancelledSessions.push(entry);
  }
  return {
    allSessions,
    loggedSessions,
    logDisplaySessions,
    cancelledSessions,
    plannedSessions,
    // Reconciliation is actual work on the same date/type, never a cancellation.
    loggedKeys: new Set(
      loggedSessions.map((entry) => `${entry.date}|${entry.type}`)
    ),
  };
}
