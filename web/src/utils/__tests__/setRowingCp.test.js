import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fromMock = vi.fn();
const rpcMock = vi.fn();
const captureMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    rpc: (...args) => rpcMock(...args),
  },
}));

vi.mock('../sentry.js', () => ({
  captureError: (...args) => captureMock(...args),
}));

import { setRowingCp, clearSampleData } from '../setRowingCp.js';
import { MIN_CP, MAX_CP } from '../firstRunGuide.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../..');

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  captureMock.mockReset();
});

// One-step save through migration 028's save_my_cp() (#819 S4). The
// database retires the old row and inserts the new one in one step, so the
// client never writes anchors itself. 025's set_my_rowing_cp stays on dev
// until S4b drops it, but nothing in the app calls it any more.
const SAVED = {
  status: 'saved',
  id: '00000000-0000-4000-8000-0000000000aa',
  replaced: true,
  valid_from: '2026-11-28',
  clamped: false,
};

describe('setRowingCp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 28, 7, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('H38: calls save_my_cp once as manual, unvalidated, reason manual, today local, and never writes anchors', async () => {
    rpcMock.mockResolvedValue({ data: SAVED, error: null });
    const result = await setRowingCp('210', {
      expectedLiveId: '00000000-0000-4000-8000-000000000001',
    });
    expect(result).toEqual({ ok: true, watts: 210 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('save_my_cp', {
      p_watts: 210,
      p_source: 'manual',
      p_status: 'unvalidated',
      p_reason: 'manual',
      p_valid_from: '2026-11-28',
      p_rule_id: null,
      p_rule_version: null,
      p_provenance: null,
      p_expected_live_id: '00000000-0000-4000-8000-000000000001',
      p_locked: null,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('with no live row it expects none', async () => {
    rpcMock.mockResolvedValue({ data: SAVED, error: null });
    await setRowingCp('210');
    expect(rpcMock.mock.calls[0][1].p_expected_live_id).toBeNull();
  });

  it('A32: a stale answer is its own cause and is not reported as an error', async () => {
    rpcMock.mockResolvedValue({
      data: { status: 'stale', id: null, replaced: false },
      error: null,
    });
    expect(await setRowingCp('220')).toEqual({ ok: false, cause: 'stale' });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('an unchanged answer (same CP again) counts as saved', async () => {
    rpcMock.mockResolvedValue({
      data: { status: 'unchanged', id: SAVED.id, replaced: false },
      error: null,
    });
    expect(await setRowingCp('220')).toEqual({ ok: true, watts: 220 });
  });

  it('a failed save makes no follow-up writes to put a row back', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'check' },
    });
    const result = await setRowingCp('220');
    expect(result).toEqual({ ok: false, cause: 'error' });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('a reply without a known status counts as a failure', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await setRowingCp('220')).toEqual({ ok: false, cause: 'error' });
    rpcMock.mockResolvedValue({ data: { status: 'bad_date' }, error: null });
    expect(await setRowingCp('220')).toEqual({ ok: false, cause: 'error' });
  });

  // A failed save is reported, so a missing 028 (PGRST202) shows up in
  // Sentry. The context names the call, never the watts (H 42).
  it('H42: reports a failed save to Sentry with the call name only', async () => {
    const error = { code: 'PGRST202', message: 'not found' };
    rpcMock.mockResolvedValue({ data: null, error });
    await setRowingCp('230');
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith(error, {
      where: 'setRowingCp',
      rpc: 'save_my_cp',
    });
    expect(JSON.stringify(captureMock.mock.calls[0][1])).not.toContain('230');
  });

  it('reports a reply that is not saved, and reports nothing for a save or a typo', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'odd' }, error: null });
    await setRowingCp('230');
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(captureMock.mock.calls[0][0].message).not.toContain('230');
    expect(captureMock.mock.calls[0][1]).toEqual({
      where: 'setRowingCp',
      rpc: 'save_my_cp',
    });

    captureMock.mockReset();
    rpcMock.mockResolvedValue({ data: SAVED, error: null });
    await setRowingCp('230');
    await setRowingCp('12');
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('an out-of-range value is refused before any call', async () => {
    for (const raw of ['12', '49', '501', '', 'abc']) {
      expect(await setRowingCp(raw)).toEqual({ ok: false, cause: 'invalid' });
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('the form bounds match save_my_cp in migration 028 (50 to 500 W)', () => {
    const sql = readFileSync(
      resolve(srcDir, '../../supabase/migrations/028_anchor_provenance.sql'),
      'utf8'
    );
    expect(MIN_CP).toBe(50);
    expect(MAX_CP).toBe(500);
    expect(sql).toContain('p_watts < 50 or p_watts > 500');
  });

  it('AdvancedSettingsSection is the only caller of setRowingCp', () => {
    const files = readdirSync(srcDir, { recursive: true })
      .filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) =>
        /import\s*\{[^}]*\bsetRowingCp\b[^}]*\}\s*from/.test(
          readFileSync(resolve(srcDir, f), 'utf8')
        )
      )
      .map((f) => f.split(sep).join('/'));
    expect(files).toEqual(['views/AdvancedSettingsSection.jsx']);
  });

  it('cutover: nothing in web/src names set_my_rowing_cp', () => {
    const files = readdirSync(srcDir, { recursive: true })
      .filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) =>
        readFileSync(resolve(srcDir, f), 'utf8').includes('set_my_rowing_cp')
      )
      .map((f) => f.split(sep).join('/'));
    expect(files).toEqual([]);
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
