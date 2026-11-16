import {
  archiveUnassignedWork,
  startPrivateSession,
  QUEUE_KEY,
  UNASSIGNED_KEY,
} from '../privateSessionState.js';
import { DRAFT_KEY } from '../strengthDraft.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('does not overwrite an earlier recovery archive', () => {
  expect(archiveUnassignedWork(DRAFT_KEY, 'first')).toBe(true);
  expect(archiveUnassignedWork(DRAFT_KEY, 'second')).toBe(true);
  expect(
    JSON.parse(localStorage.getItem(UNASSIGNED_KEY)).map((row) => row.raw)
  ).toEqual(['first', 'second']);
});

it('retains originals when recovery storage cannot be written', () => {
  const raw = JSON.stringify([{ label: 'unknown' }]);
  localStorage.setItem(QUEUE_KEY, raw);
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  startPrivateSession();
  expect(localStorage.getItem(QUEUE_KEY)).toBe(raw);
  expect(localStorage.getItem(UNASSIGNED_KEY)).toBeNull();
});

it('does not overwrite an unreadable archive', () => {
  localStorage.setItem(UNASSIGNED_KEY, 'not valid json');
  expect(archiveUnassignedWork(DRAFT_KEY, 'private')).toBe(false);
  expect(localStorage.getItem(UNASSIGNED_KEY)).toBe('not valid json');
});
