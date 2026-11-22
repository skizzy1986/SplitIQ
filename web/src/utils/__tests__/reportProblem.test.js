import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import {
  reportBody,
  sendProblemReport,
  currentScreen,
  readPlatform,
} from '../reportProblem.js';

const fields = {
  what: '  The chart is blank  ',
  steps: ' Open Today ',
  version: '1.3.0',
  route: '#/today',
  platform: 'web',
  userId: '11111111-1111-4111-8111-111111111111',
};

describe('reportBody', () => {
  it('sends the user id and not an email', () => {
    const body = reportBody({ ...fields, email: 'person@example.com' });
    expect(body).toEqual({
      what: 'The chart is blank',
      steps: 'Open Today',
      version: '1.3.0',
      route: '#/today',
      platform: 'web',
      userId: fields.userId,
    });
    expect(body).not.toHaveProperty('email');
  });
});

describe('currentScreen', () => {
  it('prefers the hash route', () => {
    expect(currentScreen({ hash: '#/settings', pathname: '/index.html' })).toBe(
      '#/settings'
    );
  });

  it('falls back to the path when the hash is empty', () => {
    expect(currentScreen({ hash: '', pathname: '/squat' })).toBe('/squat');
  });
});

describe('readPlatform', () => {
  const original = window.matchMedia;

  afterEach(() => {
    window.matchMedia = original;
  });

  it('reads a standalone display as a PWA', () => {
    window.matchMedia = (query) => ({
      matches: query === '(display-mode: standalone)',
    });
    expect(readPlatform()).toBe('pwa');
  });

  beforeEach(() => {
    window.matchMedia = () => ({ matches: false });
  });

  it('reads a normal browser as web', () => {
    expect(readPlatform()).toBe('web');
  });
});

describe('sendProblemReport', () => {
  it('invokes report-problem and returns the body it sent', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { ok: true }, error: null });
    const body = await sendProblemReport({ functions: { invoke } }, fields);
    expect(invoke).toHaveBeenCalledWith('report-problem', { body });
    expect(body.userId).toBe(fields.userId);
    expect(body).not.toHaveProperty('email');
  });

  it('maps a 429 to rate limited and hides other failures', async () => {
    const limited = {
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: {
            context: { status: 429 },
            message: 'https://hooks.example/secret',
          },
        }),
      },
    };
    await expect(sendProblemReport(limited, fields)).rejects.toMatchObject({
      message: 'rate limited',
      status: 429,
    });

    const failed = {
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: {
            context: { status: 502 },
            message: 'https://hooks.example/secret',
          },
        }),
      },
    };
    await expect(sendProblemReport(failed, fields)).rejects.toMatchObject({
      message: 'delivery failed',
      status: 502,
    });
  });
});
