import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    rpc: (...args) => rpcMock(...args),
  },
}));

import { setRowingCp, clearSampleData } from '../setRowingCp.js';

// The statuses anchors_status_check accepts, read from the migration that
// defines it (006), so the test fails if the client writes anything else.
const here = dirname(fileURLToPath(import.meta.url));
const ddl = readFileSync(
  resolve(here, '../../../../supabase/migrations/006_context_store.sql'),
  'utf8'
);
const ALLOWED_STATUSES = ddl
  .match(/status\s+text check \(status in \(([^)]*)\)\)/)[1]
  .split(',')
  .map((v) => v.trim().replace(/'/g, ''));

function chain(result, { maybeSingle, update, insert, del } = {}) {
  const c = {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    is: vi.fn(() => c),
    maybeSingle: vi.fn(async () => maybeSingle ?? result),
    update: vi.fn(() => {
      const next = chain(result, { maybeSingle, update, insert, del });
      // update(...).eq(...) resolves
      next.eq = vi.fn(async () => update ?? { error: null });
      return next;
    }),
    insert: vi.fn(async () => insert ?? { error: null }),
    delete: vi.fn(() => {
      const next = chain(result, { maybeSingle, update, insert, del });
      next.eq = vi.fn(() => next);
      next.select = vi.fn(async () => del ?? { data: [], error: null });
      return next;
    }),
  };
  return c;
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe('setRowingCp', () => {
  it('rejects an invalid wattage without writing', async () => {
    const result = await setRowingCp('12');
    expect(result).toEqual({ ok: false, cause: 'invalid' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inserts a first rowing_cp when none is current', async () => {
    const anchors = chain(
      {},
      { maybeSingle: { data: null, error: null }, insert: { error: null } }
    );
    fromMock.mockReturnValue(anchors);
    const result = await setRowingCp('210');
    expect(result).toEqual({ ok: true, watts: 210 });
    expect(fromMock).toHaveBeenCalledWith('anchors');
    expect(anchors.insert).toHaveBeenCalledWith({
      key: 'rowing_cp',
      value: '210',
      unit: 'W',
      status: 'unvalidated',
      source: 'tester',
    });
  });

  // Retro Gate 3 (#811, CR 1 / RC 1, Blocker): 'set' broke anchors_status_check,
  // so every save failed with 23514.
  it('writes a status that anchors_status_check accepts', async () => {
    expect(ALLOWED_STATUSES).toEqual([
      'provisional',
      'unvalidated',
      'confirmed',
    ]);
    const anchors = chain(
      {},
      { maybeSingle: { data: null, error: null }, insert: { error: null } }
    );
    fromMock.mockReturnValue(anchors);
    await setRowingCp('210');
    const row = anchors.insert.mock.calls[0][0];
    expect(ALLOWED_STATUSES).toContain(row.status);
  });

  // Retro Gate 3 (#811, CR 1 / RC 1): a failed insert must not leave the tester
  // with no live rowing CP. The one-live-row index (anchors_one_live_per_key)
  // rules out inserting first, so the supersede is undone instead.
  it('puts the previous CP back when the new row cannot be saved', async () => {
    const updates = [];
    const anchors = chain(
      {},
      { maybeSingle: { data: { id: 'row-1' }, error: null } }
    );
    anchors.update = vi.fn((patch) => ({
      eq: vi.fn(async (col, val) => {
        updates.push([patch, col, val]);
        return { error: null };
      }),
    }));
    anchors.insert = vi.fn(async () => ({ error: { code: '23514' } }));
    fromMock.mockReturnValue(anchors);
    const result = await setRowingCp('220');
    expect(result).toEqual({ ok: false, cause: 'error' });
    expect(updates).toHaveLength(2);
    expect(updates[0][0].superseded_at).toEqual(expect.any(String));
    expect(updates[1]).toEqual([{ superseded_at: null }, 'id', 'row-1']);
  });

  it('supersedes the current row before inserting the new one', async () => {
    const eqAfterUpdate = vi.fn(async () => ({ error: null }));
    const anchors = chain(
      {},
      { maybeSingle: { data: { id: 'row-1' }, error: null } }
    );
    anchors.update = vi.fn(() => ({ eq: eqAfterUpdate }));
    anchors.insert = vi.fn(async () => ({ error: null }));
    fromMock.mockReturnValue(anchors);
    const result = await setRowingCp('220');
    expect(result).toEqual({ ok: true, watts: 220 });
    expect(anchors.update).toHaveBeenCalled();
    expect(eqAfterUpdate).toHaveBeenCalledWith('id', 'row-1');
    expect(anchors.insert).toHaveBeenCalled();
  });
});

// Retro Gate 3 (#811, CR 2 / RC 2): clearing goes through #812's
// clear_my_sample_data(), which removes the sample sessions, workouts, sets,
// placeholder CP and ledger rows together, so a reload works afterwards.
describe('clearSampleData', () => {
  it('calls clear_my_sample_data and never deletes rows itself', async () => {
    rpcMock.mockResolvedValue({
      data: {
        status: 'cleared',
        sessions: 47,
        strength_workouts: 14,
        anchors: 1,
      },
      error: null,
    });
    const result = await clearSampleData();
    expect(rpcMock).toHaveBeenCalledWith('clear_my_sample_data');
    expect(fromMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, count: 47 });
  });

  it('reports an error when the call fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'no' } });
    const result = await clearSampleData();
    expect(result).toEqual({ ok: false, cause: 'error' });
  });
});
