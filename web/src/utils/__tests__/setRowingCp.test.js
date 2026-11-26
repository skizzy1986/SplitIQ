import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// One-step save through migration 025's set_my_rowing_cp() (#797, Gate 1
// criteria in the PR body). The database retires the old row and inserts the
// new one in one statement, so the client never writes anchors itself.
describe('setRowingCp', () => {
  it('criteria 1 and 3: calls set_my_rowing_cp once with the watts and never writes anchors', async () => {
    rpcMock.mockResolvedValue({
      data: { status: 'saved', watts: 210, replaced: false },
      error: null,
    });
    const result = await setRowingCp('210');
    expect(result).toEqual({ ok: true, watts: 210 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('set_my_rowing_cp', { p_watts: 210 });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('criterion 4: a failed save makes no follow-up writes to put a row back', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'check' },
    });
    const result = await setRowingCp('220');
    expect(result).toEqual({ ok: false, cause: 'error' });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('criterion 4: a reply without status saved counts as a failure', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await setRowingCp('220')).toEqual({ ok: false, cause: 'error' });
  });

  // Gate 3 round 3 (#811 CR suggestion 1, Scott 26 Nov): a failed save is
  // reported, so a missing 025 on dev (PGRST202) or a lock surprise (23505)
  // shows up in Sentry, not only as testers saying "Could not save that".
  // The context names the call, never the watts.
  it('reports a failed save to Sentry with the database error', async () => {
    const error = { code: 'PGRST202', message: 'not found' };
    rpcMock.mockResolvedValue({ data: null, error });
    await setRowingCp('230');
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith(error, {
      where: 'setRowingCp',
      rpc: 'set_my_rowing_cp',
    });
    expect(JSON.stringify(captureMock.mock.calls[0][1])).not.toContain('230');
  });

  it('reports a reply that is not saved, and reports nothing for a save or a typo', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'odd' }, error: null });
    await setRowingCp('230');
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(captureMock.mock.calls[0][1]).toEqual({
      where: 'setRowingCp',
      rpc: 'set_my_rowing_cp',
    });

    captureMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { status: 'saved', watts: 230, replaced: true },
      error: null,
    });
    await setRowingCp('230');
    await setRowingCp('12');
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('criterion 5: an out-of-range value is refused before any call', async () => {
    for (const raw of ['12', '49', '501', '', 'abc']) {
      expect(await setRowingCp(raw)).toEqual({ ok: false, cause: 'invalid' });
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('criterion 5: the form bounds match set_my_rowing_cp in migration 025 (50 to 500 W)', () => {
    expect(MIN_CP).toBe(50);
    expect(MAX_CP).toBe(500);
  });

  it('criterion 10: SetRowingCpForm is the only caller of setRowingCp', () => {
    const files = readdirSync(srcDir, { recursive: true })
      .filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) =>
        /import\s*\{[^}]*\bsetRowingCp\b[^}]*\}\s*from/.test(
          readFileSync(resolve(srcDir, f), 'utf8')
        )
      )
      .map((f) => f.split(sep).join('/'));
    expect(files).toEqual(['components/SetRowingCpForm.jsx']);
  });

  it('criterion 10: only setRowingCp.js names set_my_rowing_cp', () => {
    const files = readdirSync(srcDir, { recursive: true })
      .filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) =>
        readFileSync(resolve(srcDir, f), 'utf8').includes('set_my_rowing_cp')
      )
      .map((f) => f.split(sep).join('/'));
    expect(files).toEqual(['utils/setRowingCp.js']);
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
