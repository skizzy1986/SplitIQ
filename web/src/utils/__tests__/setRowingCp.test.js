import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
  },
}));

import { setRowingCp, clearSampleSessions } from '../setRowingCp.js';

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
      status: 'set',
      source: 'tester',
    });
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

describe('clearSampleSessions', () => {
  it('deletes only rows flagged as sample and returns the count', async () => {
    const sessions = chain(
      {},
      { del: { data: [{ id: 'a' }, { id: 'b' }], error: null } }
    );
    fromMock.mockReturnValue(sessions);
    const result = await clearSampleSessions();
    expect(result).toEqual({ ok: true, count: 2 });
    expect(fromMock).toHaveBeenCalledWith('sessions');
    expect(sessions.delete).toHaveBeenCalled();
    // eq is on the delete chain; the first eq should be source=sample
  });

  it('reports an error when the delete fails', async () => {
    const sessions = chain(
      {},
      { del: { data: null, error: { message: 'no' } } }
    );
    fromMock.mockReturnValue(sessions);
    const result = await clearSampleSessions();
    expect(result).toEqual({ ok: false, cause: 'error' });
  });
});
