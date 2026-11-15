import { useContext } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { SessionOwnerContext } from '../hooks/useSessionOwner.js';
import { QUEUE_KEY, UNASSIGNED_KEY } from '../utils/privateSessionState.js';
import { DRAFT_KEY } from '../utils/strengthDraft.js';

const mocks = vi.hoisted(() => ({ session: null, authCb: null }));
vi.mock('../supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: () => mocks.session,
      onAuthStateChange: (cb) => {
        mocks.authCb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
vi.mock('../hooks/useIsMobile.js', () => ({ useIsMobile: () => false }));
vi.mock('../hooks/useSplashGate.js', () => ({ useSplashGate: () => false }));
vi.mock('../hooks/useInitialDataReady.js', () => ({
  useInitialDataReady: () => true,
}));
vi.mock('../hooks/usePWAInstall.js', () => ({
  usePWAInstall: () => ({ canInstall: false }),
}));
vi.mock('../utils/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../App.jsx', () => ({
  default: function PrivateProbe() {
    const owner = useContext(SessionOwnerContext);
    // An intentionally unscoped key proves legacy private caches are cleared too.
    const { data } = useQuery({
      queryKey: ['private-test'],
      queryFn: async () => `record-${owner}`,
      staleTime: Infinity,
    });
    return (
      <div data-testid="private-probe">
        {owner}:{data ?? 'pending'}
      </div>
    );
  },
}));
import AuthGate from '../AuthGate.jsx';

const session = (id) => ({ user: { id } });
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthGate />
    </QueryClientProvider>
  );
  return client;
}
beforeEach(() => {
  localStorage.clear();
  mocks.authCb = null;
});

it('clears caches and quarantines unattributable work before a second account renders', async () => {
  mocks.session = Promise.resolve({ data: { session: session('A') } });
  const client = mount();
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('A:record-A')
  );
  localStorage.setItem(QUEUE_KEY, 'private A');
  localStorage.setItem(DRAFT_KEY, 'private A');
  client.setQueryData(['vitals'], 'private A');
  act(() => mocks.authCb('SIGNED_IN', session('B')));
  expect(screen.getByTestId('private-probe')).not.toHaveTextContent('record-A');
  expect(client.getQueryData(['vitals'])).toBeUndefined();
  expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('B:record-B')
  );
});

it('does not let a delayed initial session overwrite a later auth event', async () => {
  let resolve;
  mocks.session = new Promise((r) => {
    resolve = r;
  });
  mount();
  act(() => mocks.authCb('SIGNED_IN', session('B')));
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('B:record-B')
  );
  await act(async () => resolve({ data: { session: session('A') } }));
  expect(screen.getByTestId('private-probe')).toHaveTextContent('B:record-B');
});

it('keeps same-account refreshes and reloads from discarding private work', async () => {
  localStorage.setItem('splitiq.data-owner', 'A');
  localStorage.setItem(DRAFT_KEY, 'draft A');
  mocks.session = Promise.resolve({ data: { session: session('A') } });
  const client = mount();
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('A:record-A')
  );
  const clear = vi.spyOn(client, 'clear');
  act(() => mocks.authCb('TOKEN_REFRESHED', session('A')));
  expect(clear).not.toHaveBeenCalled();
  expect(localStorage.getItem(DRAFT_KEY)).toBe('draft A');
});

it('quarantines unattributable work when a cold boot resolves to a different saved owner', async () => {
  localStorage.setItem('splitiq.data-owner', 'A');
  localStorage.setItem(DRAFT_KEY, 'draft A');
  mocks.session = Promise.resolve({ data: { session: session('B') } });
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('B:record-B')
  );
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
});

it('clears caches and quarantines unattributable work on sign-out', async () => {
  mocks.session = Promise.resolve({ data: { session: session('A') } });
  const client = mount();
  await screen.findByTestId('private-probe');
  localStorage.setItem(DRAFT_KEY, 'draft A');
  act(() => mocks.authCb('SIGNED_OUT', null));
  expect(screen.queryByTestId('private-probe')).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
});

it('keeps owned unsynced work through sign-out and the same owner signing back in', async () => {
  mocks.session = Promise.resolve({ data: { session: session('A') } });
  mount();
  await screen.findByTestId('private-probe');
  const rows = [{ user_id: 'A', label: 'offline erg' }];
  const draft = { id: 'w1', user_id: 'A', exercises: [] };
  localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  act(() => mocks.authCb('SIGNED_OUT', null));
  expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toEqual(rows);
  expect(JSON.parse(localStorage.getItem(DRAFT_KEY))).toEqual(draft);
  act(() => mocks.authCb('SIGNED_IN', session('A')));
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('A:record-A')
  );
  expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toEqual(rows);
  expect(localStorage.getItem(UNASSIGNED_KEY)).toBeNull();
});

it('keeps owned unsynced work when a cold boot finds the session expired', async () => {
  const rows = [{ user_id: 'A', label: 'offline erg' }];
  localStorage.setItem('splitiq.data-owner', 'A');
  localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  mocks.session = Promise.resolve({ data: { session: null } });
  mount();
  await waitFor(() =>
    expect(localStorage.getItem('splitiq.data-owner')).toBeNull()
  );
  expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toEqual(rows);
});

it('quarantines unknown legacy work instead of assigning it to the first new account', async () => {
  const draft = { id: 'legacy', label: 'private', exercises: [] };
  const rows = [
    { user_id: 'A', label: 'private A' },
    { label: 'unknown' },
    { user_id: 'B', label: 'known B' },
  ];
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  mocks.session = Promise.resolve({ data: { session: session('B') } });
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('private-probe')).toHaveTextContent('B:record-B')
  );
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  // Owned rows stay for their owner's replay; only the ownerless row is archived.
  expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toEqual([
    rows[0],
    rows[2],
  ]);
  const archived = JSON.parse(localStorage.getItem(UNASSIGNED_KEY));
  expect(archived).toHaveLength(2);
  expect(archived.find((item) => item.key === DRAFT_KEY).raw).toBe(
    JSON.stringify(draft)
  );
});

it('preserves explicitly matching legacy work on first boot', async () => {
  const draft = { id: 'legacy', label: 'mine', exercises: [], user_id: 'B' };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  localStorage.setItem(
    QUEUE_KEY,
    JSON.stringify([{ user_id: 'B', label: 'mine' }])
  );
  mocks.session = Promise.resolve({ data: { session: session('B') } });
  mount();
  await screen.findByTestId('private-probe');
  expect(JSON.parse(localStorage.getItem(DRAFT_KEY))).toEqual(draft);
  expect(localStorage.getItem(UNASSIGNED_KEY)).toBeNull();
});
