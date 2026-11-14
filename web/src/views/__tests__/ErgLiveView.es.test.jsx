import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@lingui/core';
import { messages as en } from '../../locales/en.po';
import { messages as es } from '../../locales/es.po';
import { messages as viewsEn } from '../../locales/views/en.po';
import { messages as viewsEs } from '../../locales/views/es.po';

// Localisation PR 2: the erg path Train hands the screen to renders Spanish,
// while the row it writes stays English (decision 7, SPEC amendment
// 2026-11-14). usePM5 is mocked the way ErgLiveView.test.jsx mocks it.

const insertMock = vi.fn();
const addToQueueMock = vi.fn();
let pm5State;
let pending = 2;

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-123' } } }),
    },
    from: () => ({ insert: (...args) => insertMock(...args) }),
  },
}));
vi.mock('../../hooks/usePM5', () => ({ usePM5: () => pm5State }));
vi.mock('../../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ addToQueue: addToQueueMock, pending }),
}));

import ErgLiveView from '../ErgLiveView.jsx';
import WorkoutTarget from '../../components/WorkoutTarget.jsx';
import { PM5_UNSUPPORTED } from '../../services/pm5Bluetooth.js';

const SUMMARY = {
  distance: 5000,
  elapsedTime: 1200,
  elapsedStr: '20:00',
  avgWatts: 180,
  avgPace: 12000,
  avgSpm: 24,
  maxWatts: 220,
  calories: 250,
};

const PLANNED = {
  date: '8/18/26',
  _isErg: true,
  type: 'Z2 Aerobic',
  label: 'UT1 50min',
  status: 'planned',
  duration: '53m',
};

const inSpanish = () => {
  i18n.load('es', { ...en, ...viewsEn, ...es, ...viewsEs });
  i18n.activate('es');
};

const renderView = (props = {}) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <ErgLiveView {...props} />
    </QueryClientProvider>
  );

// No English UI word survives. Unit symbols and acronyms (W, m, spm, kcal,
// PM5, sRPE, SPM, C2) stay as they are, so they are not in this list.
const ENGLISH = [
  'LIVE ROWING',
  'CONNECT TO PM5',
  'Power on your PM5',
  'PENDING SYNC',
  'TARGET',
  'CONNECTED',
  'ROWING',
  'END',
  'PACE',
  'WATTS',
  'ELAPSED',
  'SESSION COMPLETE',
  'DISTANCE',
  'TIME',
  'CALORIES',
  'HOW HARD',
  'Very easy',
  'Steady',
  'NOTES',
  'SAVE SESSION',
  'DISCARD',
];
const expectNoEnglish = (text) => {
  for (const word of ENGLISH) expect(text).not.toContain(word);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 18, 7, 15));
  insertMock.mockReset();
  insertMock.mockResolvedValue({ error: null });
  addToQueueMock.mockReset();
  pending = 2;
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  pm5State = {
    status: 'idle',
    metrics: null,
    summary: null,
    error: null,
    errorCode: null,
    connect: vi.fn(),
    reset: vi.fn(),
    finish: vi.fn(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ErgLiveView in Spanish (AC-T1)', () => {
  it('connect screen', () => {
    inSpanish();
    const { container } = renderView({ plannedSessions: [PLANNED] });
    for (const text of [
      'REMO EN VIVO',
      'CONEXIÓN C2',
      '2 SESIONES POR SINCRONIZAR',
      'OBJETIVO',
      'CONECTAR AL PM5',
      'Chrome / Edge · Android o computador',
    ]) {
      expect(container.textContent).toContain(text);
    }
    expect(container.textContent).toContain('Enciende tu PM5.');
    expect(container.textContent).toContain(
      'pedirá que elijas el dispositivo.'
    );
    expect(container.querySelectorAll('br')).toHaveLength(2);
    expectNoEnglish(container.textContent);
  });

  it('connect screen while connecting', () => {
    pm5State = { ...pm5State, status: 'connecting' };
    inSpanish();
    renderView();
    expect(screen.getByRole('button', { name: 'CONECTANDO…' })).toBeDisabled();
  });

  it('live screen, waiting and rowing', () => {
    pm5State = {
      ...pm5State,
      status: 'connected',
      metrics: {
        watts: 180,
        strokeRate: 24,
        distance: 5000,
        elapsedStr: '20:00',
        paceStr: '2:00.0',
      },
    };
    inSpanish();
    const { container, unmount } = renderView();
    for (const text of [
      'CONECTADO',
      'TERMINAR',
      'RITMO 500m',
      'VATIOS',
      'SPM',
      'DIST.',
      'TRANSCURRIDO',
    ]) {
      expect(container.textContent).toContain(text);
    }
    expectNoEnglish(container.textContent);
    unmount();

    pm5State = { ...pm5State, status: 'rowing' };
    renderView();
    expect(screen.getByText('REMANDO')).toBeInTheDocument();
  });

  it('summary screen, sRPE buttons included', () => {
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    const { container } = renderView();
    for (const text of [
      'SESIÓN TERMINADA',
      'DISTANCIA',
      'TIEMPO',
      'RITMO PROM.',
      'VATIOS PROM.',
      'SPM PROM.',
      'CALORÍAS',
      '¿QUÉ TAN DURO SE SINTIÓ? (sRPE)',
      'NOTAS (opcional)',
      'GUARDAR SESIÓN',
      'DESCARTAR',
    ]) {
      expect(container.textContent).toContain(text);
    }
    expect(
      screen.getByPlaceholderText('¿Cómo te sentiste? Notas de técnica…')
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('button', { name: /^\d+ — / })
        .map((b) => b.textContent)
    ).toEqual([
      '1 — Muy fácil',
      '2 — Muy fácil',
      '3 — Fácil (UT2)',
      '4 — Fácil (UT2)',
      '5 — Constante (UT1)',
      '6 — Constante (UT1)',
      '7 — Duro (umbral)',
      '8 — Duro (umbral)',
      '9 — Máximo',
      '10 — Máximo',
    ]);
    expectNoEnglish(container.textContent);
  });

  it('save outcomes and DONE', async () => {
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    renderView();
    fireEvent.click(screen.getByText('GUARDAR SESIÓN'));
    await waitFor(() =>
      expect(screen.getByText('GUARDADA EN EL HISTORIAL')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'LISTO' })).toBeInTheDocument();
  });

  it('a rejected insert that is queued', async () => {
    insertMock.mockResolvedValue({ error: { code: '42501', message: 'no' } });
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    renderView();
    fireEvent.click(screen.getByText('GUARDAR SESIÓN'));
    await waitFor(() =>
      expect(
        screen.getByText('GUARDADA EN EL DISPOSITIVO: SE SINCRONIZARÁ')
      ).toBeInTheDocument()
    );
  });

  it('a save that cannot even be stored locally', async () => {
    insertMock.mockResolvedValue({ error: { code: '42501', message: 'no' } });
    addToQueueMock.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    renderView();
    fireEvent.click(screen.getByText('GUARDAR SESIÓN'));
    await waitFor(() =>
      expect(
        screen.getByText('NO SE PUDO GUARDAR: NO QUEDÓ ALMACENADA')
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText(
        'El almacenamiento del dispositivo está lleno. Libera espacio y vuelve a tocar GUARDAR SESIÓN.'
      )
    ).toBeInTheDocument();
  });
});

describe('PM5 errors (AC-T2)', () => {
  it('shows our coded "not supported" error in Spanish', () => {
    pm5State = {
      ...pm5State,
      status: 'error',
      error:
        'Web Bluetooth is not supported in this browser. Use Chrome or Edge.',
      errorCode: PM5_UNSUPPORTED,
    };
    inSpanish();
    renderView();
    expect(
      screen.getByText(
        'Este navegador no es compatible con Web Bluetooth. Usa Chrome o Edge.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/is not supported/)).not.toBeInTheDocument();
  });

  it('keeps the English for the same code in English', () => {
    pm5State = {
      ...pm5State,
      status: 'error',
      error: 'whatever was logged',
      errorCode: PM5_UNSUPPORTED,
    };
    renderView();
    expect(
      screen.getByText(
        'Web Bluetooth is not supported in this browser. Use Chrome or Edge.'
      )
    ).toBeInTheDocument();
  });

  it("passes a browser error's own message through", () => {
    pm5State = {
      ...pm5State,
      status: 'error',
      error: 'User cancelled the requestDevice() chooser.',
      errorCode: null,
    };
    inSpanish();
    renderView();
    expect(
      screen.getByText('User cancelled the requestDevice() chooser.')
    ).toBeInTheDocument();
  });

  it('passes an unknown code through as the message', () => {
    pm5State = {
      ...pm5State,
      status: 'error',
      error: 'Something native failed',
      errorCode: 'toString',
    };
    inSpanish();
    renderView();
    expect(screen.getByText('Something native failed')).toBeInTheDocument();
  });
});

describe('the stored row stays English in Spanish (AC-T3)', () => {
  it('writes the English label and notes entry', async () => {
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    renderView();
    fireEvent.change(
      screen.getByPlaceholderText('¿Cómo te sentiste? Notas de técnica…'),
      { target: { value: 'piernas bien' } }
    );
    fireEvent.click(screen.getByText('GUARDAR SESIÓN'));
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const row = insertMock.mock.calls[0][0];
    expect(row.label).toBe('Erg Session 07:15');
    expect(row.exercises).toEqual([{ name: 'Notes', notes: 'piernas bien' }]);
    expect(row.duration).toBe('20:00');
  });

  it('writes the same row in Spanish as in English, sRPE included', async () => {
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    const save = async (pick, saveLabel) => {
      const { unmount } = renderView();
      fireEvent.click(screen.getByRole('button', { name: pick }));
      fireEvent.click(screen.getByText(saveLabel));
      await waitFor(() => expect(insertMock).toHaveBeenCalled());
      const row = insertMock.mock.calls.at(-1)[0];
      insertMock.mockClear();
      unmount();
      return row;
    };
    i18n.activate('en');
    const english = await save(/^7 — /, 'SAVE SESSION');
    inSpanish();
    const spanish = await save('7 — Duro (umbral)', 'GUARDAR SESIÓN');
    expect(spanish.srpe).toBe(7);
    expect(spanish).toEqual(english);
  });

  it('queues the same English row when the insert is rejected', async () => {
    insertMock.mockResolvedValue({ error: { code: '42501', message: 'no' } });
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    renderView();
    fireEvent.click(screen.getByText('GUARDAR SESIÓN'));
    await waitFor(() => expect(addToQueueMock).toHaveBeenCalledTimes(1));
    expect(addToQueueMock.mock.calls[0][0].label).toBe('Erg Session 07:15');
  });
});

describe('the rest of the erg path in Spanish', () => {
  it('one pending session is singular', () => {
    pending = 1;
    inSpanish();
    renderView();
    expect(screen.getByText('1 SESIÓN POR SINCRONIZAR')).toBeInTheDocument();
  });

  it('DESCARTAR resets the monitor', () => {
    pm5State = { ...pm5State, status: 'finished', summary: SUMMARY };
    inSpanish();
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'DESCARTAR' }));
    expect(pm5State.reset).toHaveBeenCalledTimes(1);
  });
});

describe('WorkoutTarget (AC-T5, AC-T4)', () => {
  const open = () => fireEvent.click(screen.getByRole('button'));

  it('renders Spanish, with the duration unit from the message', () => {
    inSpanish();
    render(<WorkoutTarget session={PLANNED} />);
    expect(screen.getByText('OBJETIVO')).toBeInTheDocument();
    open();
    const text = document.body.textContent;
    expect(text).toContain('53 min');
    expect(text).not.toContain('mmin');
    expect(text).toContain('sRPE objetivo:');
    expect(text).toContain('fácil');
    expect(text).not.toContain('target');
  });

  it('says there is no planned session in Spanish', () => {
    inSpanish();
    render(<WorkoutTarget session={null} />);
    expect(
      screen.getByText('NO HAY SESIÓN PLANIFICADA HOY')
    ).toBeInTheDocument();
  });

  it('shows a clock duration with no unit, in English as before', () => {
    render(
      <WorkoutTarget session={{ ...PLANNED, duration: '26:00', srpe: 4 }} />
    );
    expect(screen.getByText('TARGET')).toBeInTheDocument();
    open();
    expect(screen.getByText('26:00')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/26:00\s*min/);
    expect(document.body.textContent).toContain('sRPE target: 4');
  });

  it('shows a clock duration with no unit in Spanish too', () => {
    inSpanish();
    render(<WorkoutTarget session={{ ...PLANNED, duration: '26:00' }} />);
    open();
    expect(screen.getByText('26:00')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/26:00\s*min/);
  });

  it.each([null, ''])('shows no duration for %j, in either language', (d) => {
    for (const lang of ['en', 'es']) {
      if (lang === 'es') inSpanish();
      else i18n.activate('en');
      const { unmount } = render(
        <WorkoutTarget session={{ ...PLANNED, duration: d }} />
      );
      open();
      expect(document.body.textContent).not.toMatch(/\bmin\b|null/);
      unmount();
    }
  });

  it('English minutes read "53 min" and the fallback is "easy"', () => {
    render(<WorkoutTarget session={PLANNED} />);
    open();
    expect(screen.getByText('53 min')).toBeInTheDocument();
    expect(document.body.textContent).toContain('sRPE target: easy');
  });
});
