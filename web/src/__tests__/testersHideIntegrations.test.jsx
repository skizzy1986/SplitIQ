import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// #793: a testers build hides the owner's own integrations (Strava) and the
// health screens (blood pressure, bloods, injuries, the vitals sync, readiness).
// The owner's build is unchanged. Each surface is rendered both ways.
//
// This is integration availability, not a tier: nothing here says "locked" or
// "upgrade", and no user id is named.
const mocks = vi.hoisted(() => ({
  testers: false,
  vitals: null,
  settled: null,
}));
vi.mock('../views/AdvancedSettingsSection.jsx', () => ({
  default: () => null,
}));
vi.mock('../views/TrainingSettingsSection.jsx', () => ({
  default: () => null,
}));
vi.mock('../utils/testersBuild.js', () => ({
  isTestersBuild: () => mocks.testers,
}));

vi.mock('../components/StravaConnectPanel.jsx', () => ({
  default: () => <div data-testid="strava-panel" />,
}));
vi.mock('../hooks/useVitals.js', () => ({ useVitals: () => mocks.vitals }));
vi.mock('../hooks/useVitalsSync.js', () => ({
  useVitalsSync: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../hooks/useTSSHistory.js', () => ({
  useTSSHistory: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: [] }),
}));
vi.mock('../hooks/useAnchors.js', () => ({
  useAnchors: () => ({ anchors: {}, cp: 205 }),
}));
const readBp = vi.fn();
const readLabs = vi.fn();
const readInjuries = vi.fn();
vi.mock('../hooks/useBpReadings.js', () => ({ useBpReadings: () => readBp() }));
vi.mock('../hooks/useLabResults.js', () => ({
  useLabResults: () => readLabs(),
}));
vi.mock('../hooks/useInjuries.js', () => ({
  useInjuries: () => readInjuries(),
}));
// Progress's panes have their own data; only the foot of the screen matters here.
vi.mock('../views/mobile/MobileAnalytics.jsx', () => ({
  default: () => <div data-testid="load-pane" />,
}));
vi.mock('../views/mobile/MobileSessionLog.jsx', () => ({
  default: () => null,
}));
vi.mock('../views/mobile/MobileStrength.jsx', () => ({ default: () => null }));
vi.mock('../views/ErgView.jsx', () => ({ default: () => null }));
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
  };
});

import SettingsView from '../views/SettingsView.jsx';
import RecoveryView from '../views/RecoveryView.jsx';
import MobileRecovery from '../views/mobile/MobileRecovery.jsx';
import MobileToday from '../views/mobile/MobileToday.jsx';
import MobileProgress from '../views/mobile/MobileProgress.jsx';
import OverviewView from '../views/OverviewView.jsx';

const emptyVitals = {
  latest: null,
  readiness: { score: null, status: null },
  readinessScore: null,
  readinessLabel: null,
  personalBaselines: {
    rhrBaseline: 55,
    hrvBaseline: 60,
    rhrPersonal: false,
    hrvPersonal: false,
  },
  tsbNow: 0,
  vitalsHistory: [],
  history: [],
  hasPersonalBaselines: false,
  isLoading: false,
  isError: false,
};

beforeEach(() => {
  mocks.testers = false;
  mocks.vitals = emptyVitals;
  const settled = {
    rows: [],
    data: [],
    isPending: false,
    isError: false,
    isPaused: false,
  };
  readBp.mockReturnValue(settled);
  readLabs.mockReturnValue(settled);
  readInjuries.mockReturnValue(settled);
});

describe('Settings', () => {
  it('shows the Strava panel on the owner’s build', () => {
    render(<SettingsView />);
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.getByTestId('strava-panel')).toBeInTheDocument();
  });

  it('hides it on a testers build, and keeps the rest of Settings', () => {
    mocks.testers = true;
    render(<SettingsView />);
    expect(screen.queryByText('Integrations')).toBeNull();
    expect(screen.queryByTestId('strava-panel')).toBeNull();
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();
  });
});

describe('Recovery (desktop)', () => {
  const HEADINGS = [
    'BLOOD PRESSURE',
    'BLOODS · LIPID PANEL',
    'HORMONE PANEL',
    'INJURY WATCH',
  ];

  it('shows the health-record cards on the owner’s build', () => {
    render(<RecoveryView isWide={true} />);
    for (const h of HEADINGS) {
      expect(screen.getByRole('region', { name: h })).toBeInTheDocument();
    }
  });

  it('hides them on a testers build, and does not even read them', () => {
    mocks.testers = true;
    render(<RecoveryView isWide={true} />);
    for (const h of HEADINGS) {
      expect(screen.queryByRole('region', { name: h })).toBeNull();
    }
    expect(readBp).not.toHaveBeenCalled();
    expect(readLabs).not.toHaveBeenCalled();
    expect(readInjuries).not.toHaveBeenCalled();
  });
});

describe('Body (mobile)', () => {
  it('has the vitals sync and the connect prompt on the owner’s build', () => {
    render(<MobileRecovery onOpenSettings={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Sync now' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Connect Google Health/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Settings' })
    ).toBeInTheDocument();
  });

  it('has neither on a testers build, only the plain empty state', () => {
    mocks.testers = true;
    render(<MobileRecovery onOpenSettings={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByText(/Connect Google Health/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(screen.getByText('No vitals recorded yet')).toBeInTheDocument();
  });
});

describe('Today (mobile)', () => {
  it('shows the readiness card on the owner’s build', () => {
    render(<MobileToday />);
    expect(screen.getByText('READINESS')).toBeInTheDocument();
  });

  it('hides it on a testers build, so no prompt points at a sync that is not there', () => {
    mocks.testers = true;
    render(<MobileToday />);
    expect(screen.queryByText('READINESS')).toBeNull();
    expect(screen.queryByText(/Sync vitals from Body/)).toBeNull();
  });
});

// Retro Gate 3 (#810, CR 1 / RC 1, Blocker): the Strava panel sat at the foot
// of mobile Progress on every build.
describe('Progress (mobile)', () => {
  it('shows the Strava panel on the owner’s build', () => {
    render(<MobileProgress />);
    expect(screen.getByTestId('load-pane')).toBeInTheDocument();
    expect(screen.getByTestId('strava-panel')).toBeInTheDocument();
  });

  it('hides it on a testers build, and keeps the Load pane', () => {
    mocks.testers = true;
    render(<MobileProgress />);
    expect(screen.getByTestId('load-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('strava-panel')).toBeNull();
  });
});

// Retro Gate 3 (#810, CR 2 / RC 2): desktop Today follows mobile Today, so no
// readiness card or "Open Body" prompt points at a vitals sync that isn't there.
describe('Today (desktop)', () => {
  const props = {
    latest: null,
    loadData: [],
    loggedSessions: [],
    latestErg: null,
    totalErgDist: 0,
    totalSessions: 0,
    isWide: true,
    onOpenBody: () => {},
    onOpenHistory: () => {},
  };

  it('shows the readiness card and the Open Body prompt on the owner’s build', () => {
    render(<OverviewView {...props} />);
    expect(screen.getByText('READINESS')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Body' })
    ).toBeInTheDocument();
  });

  it('hides both on a testers build, and keeps the stat tiles', () => {
    mocks.testers = true;
    render(<OverviewView {...props} />);
    expect(screen.queryByText('READINESS')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Body' })).toBeNull();
    expect(screen.getByText('SESSIONS LOGGED')).toBeInTheDocument();
  });
});

describe('wording', () => {
  it('never describes the hide as a locked or paid tier', () => {
    mocks.testers = true;
    const { container } = render(<SettingsView />);
    expect(container.textContent).not.toMatch(
      /locked|upgrade|premium|paid|tier/i
    );
  });
});
