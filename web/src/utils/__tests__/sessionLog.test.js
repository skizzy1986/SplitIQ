import { selectSessionLog } from '../sessionLog.js';

const erg = {
  id: 1,
  date: '6/13/26',
  type: 'erg',
  label: '10k steady',
  duration: 45,
  srpe: 6,
  prs: 2,
  exercises: null,
  coach_note: 'keep it easy',
  status: 'completed',
  distance_m: 10000,
  avg_watts: 150,
  avg_hr: 135,
};

describe('session log selectors', () => {
  it('preserves display payload, normalizes types, retains raw flags and excludes Test rows', () => {
    const result = selectSessionLog([
      erg,
      { id: 2, type: 'Test' },
      { id: 3, type: 'cycling', status: 'actual' },
    ]);
    expect(result.allSessions).toHaveLength(2);
    expect(result.allSessions[0]).toEqual({
      date: erg.date,
      type: 'Z2 Aerobic',
      label: erg.label,
      duration: 45,
      srpe: 6,
      prs: 2,
      exercises: undefined,
      coachNote: 'keep it easy',
      status: 'completed',
      distance_m: 10000,
      avg_watts: 150,
      avg_hr: 135,
      _isErg: true,
      _isCycling: false,
      _fromDb: true,
      _id: 1,
    });
    expect(result.allSessions[1]).toMatchObject({
      type: 'Cycling',
      _isCycling: true,
      _isErg: false,
    });
    expect(erg).not.toHaveProperty('coachNote');
  });

  it('keeps planned/cancelled out of completed counts and reconciliation', () => {
    const result = selectSessionLog([
      { id: 1, date: '6/20/26', type: 'erg', status: 'planned' },
      { id: 2, date: '6/19/26', type: 'erg', status: 'cancelled' },
      {
        id: 3,
        date: '6/18/26',
        type: 'strength',
        label: 'Upper A',
        status: 'actual',
      },
      { id: 4, date: '6/17/26', type: 'erg', status: 'logged' },
      { id: 5, date: '6/16/26', type: 'erg', status: 'completed' },
    ]);
    expect(result.plannedSessions.map((r) => r._id)).toEqual([1]);
    expect(result.cancelledSessions.map((r) => r._id)).toEqual([2]);
    expect(result.loggedSessions.map((r) => r._id)).toEqual([3, 4, 5]);
    expect(result.logDisplaySessions.map((r) => r._id)).toEqual([2, 3, 4, 5]);
    expect([...result.loggedKeys]).toEqual([
      '6/18/26|Upper Strength',
      '6/17/26|Z2 Aerobic',
      '6/16/26|Z2 Aerobic',
    ]);
  });

  it('preserves all partitions and order for the 58 completed/32 cancelled/2 planned regression', () => {
    const rows = Array.from({ length: 92 }, (_, i) => ({
      id: 92 - i,
      type: 'erg',
      date: '8/7/26',
      status: i < 58 ? 'actual' : i < 90 ? 'cancelled' : 'planned',
    }));
    const result = selectSessionLog(rows);
    expect(result.allSessions).toHaveLength(92);
    expect(result.loggedSessions).toHaveLength(58);
    expect(result.logDisplaySessions).toHaveLength(90);
    expect(result.cancelledSessions).toHaveLength(32);
    expect(result.plannedSessions).toHaveLength(2);
    expect(result.cancelledSessions.map((r) => r._id)).toEqual(
      rows.slice(58, 90).map((r) => r.id)
    );
    const counted = new Set(result.loggedSessions);
    expect(
      result.cancelledSessions.every(
        (r) => !counted.has(r) && result.logDisplaySessions.includes(r)
      )
    ).toBe(true);
  });

  it('does not count unknown or null statuses and never invents cancellation', () => {
    const result = selectSessionLog([
      { id: 1, status: 'unknown' },
      { id: 2, status: null },
      { id: 3 },
    ]);
    expect(result.loggedSessions).toEqual([]);
    expect(result.cancelledSessions).toEqual([]);
    expect(result.loggedKeys.size).toBe(0);
  });

  it('retains exercise details, handles missing optional fields and distinguishes bike aliases', () => {
    const exercises = [{ name: 'Back Squat', sets: 3 }];
    const result = selectSessionLog([
      {
        id: 1,
        type: 'strength',
        label: 'Lower A',
        exercises,
        status: 'completed',
      },
      { id: 2, type: 'bike' },
      { id: 3, type: 'ride' },
      { id: 4, coach_note: '' },
    ]);
    expect(result.allSessions[0]).toMatchObject({
      type: 'Lower Strength',
      exercises,
    });
    expect(result.allSessions[1]._isCycling).toBe(true);
    expect(result.allSessions[2]._isCycling).toBe(true);
    expect(result.allSessions[3]).toMatchObject({
      _isErg: false,
      _isCycling: false,
      coachNote: undefined,
    });
  });

  it('returns complete empty partitions before data arrives', () => {
    const result = selectSessionLog();
    for (const key of [
      'allSessions',
      'loggedSessions',
      'logDisplaySessions',
      'cancelledSessions',
      'plannedSessions',
    ])
      expect(result[key]).toEqual([]);
    expect(result.loggedKeys.size).toBe(0);
  });
});
