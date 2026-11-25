import { describe, it, expect } from 'vitest';
import { upsertMonitor, expireMonitors } from '../pm5Monitors';

const seen = (list, deviceId, name, now) =>
  upsertMonitor(list, { deviceId, name }, now);
const row = (id, name, lastSeen, stale = false) => ({
  id,
  name,
  lastSeen,
  stale,
});

describe('upsertMonitor', () => {
  it('adds a new monitor as a live row (AC4)', () => {
    const { list, changed } = seen([], 'AA', 'PM5 431719123 Row', 0);
    expect(changed).toBe(true);
    expect(list).toEqual([row('AA', 'PM5 431719123 Row', 0)]);
  });

  // AC5: a monitor appears once, however many times it is seen.
  it('keeps one row per id and only refreshes lastSeen on a repeat', () => {
    let { list } = seen([], 'AA', 'PM5 1 Row', 0);
    const again = seen(list, 'AA', 'PM5 1 Row', 400);
    expect(again.changed).toBe(false);
    expect(again.list).toHaveLength(1);
    expect(again.list[0].lastSeen).toBe(400);
    list = again.list;
    expect(seen(list, 'AA', 'PM5 1 Row', 800).list).toHaveLength(1);
  });

  it('gives a same-name new id to the existing row, in place', () => {
    let { list } = seen([], 'AA', 'PM5 1 Row', 0);
    ({ list } = seen(list, 'BB', 'PM5 2 Row', 0));
    const moved = seen(list, 'CC', 'PM5 1 Row', 100);
    expect(moved.changed).toBe(true);
    expect(moved.list).toEqual([
      row('CC', 'PM5 1 Row', 100),
      row('BB', 'PM5 2 Row', 0),
    ]);
  });

  it('lists a monitor with no name and fills the name in later', () => {
    let { list, changed } = seen([], 'AA', null, 0);
    expect(changed).toBe(true);
    expect(list[0].name).toBeNull();
    ({ list, changed } = seen(list, 'AA', 'PM5 1 Row', 50));
    expect(changed).toBe(true);
    expect(list).toEqual([row('AA', 'PM5 1 Row', 50)]);
  });

  it('keeps a known name when a later result has none', () => {
    const { list } = seen([], 'AA', 'PM5 1 Row', 0);
    const next = seen(list, 'AA', null, 10);
    expect(next.changed).toBe(false);
    expect(next.list[0].name).toBe('PM5 1 Row');
  });

  it('does not match two unnamed monitors to each other', () => {
    let { list } = seen([], 'AA', null, 0);
    ({ list } = seen(list, 'BB', null, 0));
    expect(list.map((m) => m.id)).toEqual(['AA', 'BB']);
  });

  // AC6: new rows append, so nothing moves under a finger.
  it('appends new monitors in first-seen order', () => {
    let { list } = seen([], 'AA', 'PM5 1 Row', 0);
    ({ list } = seen(list, 'BB', 'PM5 2 Row', 10));
    ({ list } = seen(list, 'AA', 'PM5 1 Row', 20));
    ({ list } = seen(list, 'CC', 'PM5 3 Row', 30));
    expect(list.map((m) => m.id)).toEqual(['AA', 'BB', 'CC']);
  });

  it('revives a stale row in its place when it is seen again', () => {
    const list = [
      row('AA', 'PM5 1 Row', 0, true),
      row('BB', 'PM5 2 Row', 6000),
    ];
    const next = seen(list, 'AA', 'PM5 1 Row', 7000);
    expect(next.changed).toBe(true);
    expect(next.list).toEqual([
      row('AA', 'PM5 1 Row', 7000),
      row('BB', 'PM5 2 Row', 6000),
    ]);
  });

  it('revives a stale row seen under a new id, in its place', () => {
    const list = [
      row('AA', 'PM5 1 Row', 0, true),
      row('BB', 'PM5 2 Row', 6000),
    ];
    const next = seen(list, 'ZZ', 'PM5 1 Row', 7000);
    expect(next.list.map((m) => [m.id, m.stale])).toEqual([
      ['ZZ', false],
      ['BB', false],
    ]);
  });

  it('returns the same list for a result with no id', () => {
    const { list } = seen([], 'AA', 'PM5 1 Row', 0);
    const next = upsertMonitor(list, { deviceId: undefined, name: 'x' }, 5);
    expect(next).toEqual({ list, changed: false });
    expect(next.list).toBe(list);
  });

  it('returns the same list when nothing changed at the same instant', () => {
    const { list } = seen([], 'AA', 'PM5 1 Row', 0);
    expect(seen(list, 'AA', 'PM5 1 Row', 0).list).toBe(list);
  });
});

describe('expireMonitors (AC6)', () => {
  const list = [row('AA', 'PM5 1 Row', 0), row('BB', 'PM5 2 Row', 3000)];

  it('leaves a row seen 4999 ms ago live, and returns the same list', () => {
    const result = expireMonitors(list, 4999, 5000);
    expect(result.changed).toBe(false);
    expect(result.list).toBe(list);
  });

  it('marks a row stale at exactly 5000 ms unseen, keeping it in place', () => {
    const result = expireMonitors(list, 5000, 5000);
    expect(result.changed).toBe(true);
    expect(result.list).toEqual([
      row('AA', 'PM5 1 Row', 0, true),
      row('BB', 'PM5 2 Row', 3000),
    ]);
    // The live row is the same object.
    expect(result.list[1]).toBe(list[1]);
  });

  it('never removes or reorders rows', () => {
    const result = expireMonitors(list, 60000, 5000);
    expect(result.list.map((m) => [m.id, m.stale])).toEqual([
      ['AA', true],
      ['BB', true],
    ]);
  });

  it('returns the same list when every stale row is already marked', () => {
    const stale = expireMonitors(list, 60000, 5000).list;
    const again = expireMonitors(stale, 70000, 5000);
    expect(again).toEqual({ list: stale, changed: false });
    expect(again.list).toBe(stale);
  });
});
