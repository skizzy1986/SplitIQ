import { describe, it, expect } from 'vitest';
import { i18n } from '@lingui/core';
import { messages as en } from '../../locales/en.po';
import { messages as es } from '../../locales/es.po';
import { messages as viewsEn } from '../../locales/views/en.po';
import { messages as viewsEs } from '../../locales/views/es.po';
import {
  describeDisconnectPreview,
  describeDisconnectResult,
} from '../stravaDisconnect.js';

const FAILED =
  'Strava did not confirm the revocation. Remove SplitIQ in Strava → Settings → My Apps.';

describe('describeDisconnectPreview', () => {
  it('states each count and the recalculation warning', () => {
    const p = describeDisconnectPreview({
      toDelete: 4,
      toKeep: 2,
      toRestore: 3,
    });
    expect(p.heading).toBe('Disconnect Strava and delete its data?');
    expect(p.lines).toEqual([
      '4 imported sessions will be deleted.',
      '2 imported sessions with your own sRPE or notes will be kept, without Strava power and heart rate.',
      'Strava power and heart rate will be removed from 3 sessions you logged yourself.',
      'Your training load will be recalculated. This cannot be undone.',
    ]);
    expect(p.confirmLabel).toBe('Disconnect and delete');
  });

  it('uses the singular for a count of one', () => {
    const p = describeDisconnectPreview({
      toDelete: 1,
      toKeep: 1,
      toRestore: 1,
    });
    expect(p.lines.slice(0, 3)).toEqual([
      '1 imported session will be deleted.',
      '1 imported session with your own sRPE or notes will be kept, without Strava power and heart rate.',
      'Strava power and heart rate will be removed from 1 session you logged yourself.',
    ]);
  });

  it('omits a line whose count is zero', () => {
    const p = describeDisconnectPreview({
      toDelete: 5,
      toKeep: 0,
      toRestore: 0,
    });
    expect(p.lines).toEqual([
      '5 imported sessions will be deleted.',
      'Your training load will be recalculated. This cannot be undone.',
    ]);
  });

  it('says nothing will be removed when every count is zero', () => {
    const p = describeDisconnectPreview({
      toDelete: 0,
      toKeep: 0,
      toRestore: 0,
    });
    expect(p.lines).toEqual([
      'Nothing in your log came from Strava; nothing will be removed.',
    ]);
  });

  it('orphan line renders only when toUnlink > 0', () => {
    const ORPHANS =
      '2 sessions linked to Strava outside the importer will be kept as they are, with the Strava link removed.';
    expect(
      describeDisconnectPreview({
        toDelete: 1,
        toKeep: 0,
        toRestore: 0,
        toUnlink: 2,
      }).lines
    ).toEqual([
      '1 imported session will be deleted.',
      ORPHANS,
      'Your training load will be recalculated. This cannot be undone.',
    ]);
    expect(
      describeDisconnectPreview({
        toDelete: 0,
        toKeep: 0,
        toRestore: 0,
        toUnlink: 1,
      }).lines[0]
    ).toBe(
      '1 session linked to Strava outside the importer will be kept as it is, with the Strava link removed.'
    );
    for (const toUnlink of [0, undefined]) {
      const lines = describeDisconnectPreview({
        toDelete: 1,
        toKeep: 0,
        toRestore: 0,
        toUnlink,
      }).lines;
      expect(lines.some((l) => l.includes('outside the importer'))).toBe(false);
    }
  });

  it('never groups a large count by locale', () => {
    const p = describeDisconnectPreview({
      toDelete: 1234,
      toKeep: 0,
      toRestore: 0,
    });
    expect(p.lines[0]).toBe('1234 imported sessions will be deleted.');
  });
});

describe('describeDisconnectResult', () => {
  it('reports the actual counts and a confirmed revocation', () => {
    const r = describeDisconnectResult({
      removed: 4,
      kept: 2,
      restored: 3,
      revocation: 'revoked',
    });
    expect(r.tone).toBe('positive');
    expect(r.text).toBe(
      'Strava disconnected. 4 imported sessions deleted. 2 imported sessions kept, without Strava power and heart rate. Strava power and heart rate removed from 3 sessions you logged yourself. Access at Strava revoked.'
    );
  });

  it('result orphan line', () => {
    expect(
      describeDisconnectResult({
        removed: 1,
        kept: 0,
        restored: 0,
        unlinked: 2,
        revocation: 'revoked',
      }).text
    ).toBe(
      'Strava disconnected. 1 imported session deleted. 2 sessions kept as they were, with the Strava link removed. Access at Strava revoked.'
    );
    // An orphan-only disconnect did touch the log, so no "nothing came from Strava".
    expect(
      describeDisconnectResult({ unlinked: 1, revocation: 'revoked' }).text
    ).toBe(
      'Strava disconnected. 1 session kept as it was, with the Strava link removed. Access at Strava revoked.'
    );
    expect(
      describeDisconnectResult({
        removed: 1,
        unlinked: 0,
        revocation: 'revoked',
      }).text
    ).not.toMatch(/Strava link removed/);
  });

  it('says access had already ended when revocation was not attempted', () => {
    const r = describeDisconnectResult({
      removed: 1,
      kept: 0,
      restored: 0,
      revocation: 'not_attempted',
    });
    expect(r.tone).toBe('positive');
    expect(r.text).toBe(
      "Strava disconnected. 1 imported session deleted. SplitIQ's access at Strava had already ended."
    );
  });

  it('turns caution and tells the user where to revoke when Strava did not confirm', () => {
    const r = describeDisconnectResult({
      removed: 0,
      kept: 0,
      restored: 0,
      revocation: 'failed',
    });
    expect(r.tone).toBe('caution');
    expect(r.text).toBe(
      `Strava disconnected. Nothing in your log came from Strava. ${FAILED}`
    );
  });

  it('treats an unknown revocation value as unconfirmed', () => {
    expect(describeDisconnectResult({ revocation: 'mystery' }).tone).toBe(
      'caution'
    );
  });

  it('tone is a THEME key name, never a colour', () => {
    for (const revocation of ['revoked', 'failed', 'not_attempted']) {
      expect(describeDisconnectResult({ revocation }).tone).toMatch(
        /^[a-z][A-Za-z0-9]*$/
      );
    }
  });
});

// Last in the file: it leaves Spanish active (each test file gets its own
// module graph, so nothing leaks past this file).
describe('in Spanish', () => {
  it('translates the preview and inflects the count', () => {
    i18n.load('es', { ...en, ...viewsEn, ...es, ...viewsEs });
    i18n.activate('es');
    const p = describeDisconnectPreview({
      toDelete: 1,
      toKeep: 2,
      toRestore: 0,
    });
    expect(p.heading).toBe('¿Desconectar Strava y eliminar sus datos?');
    expect(p.lines[0]).toBe('Se eliminará 1 sesión importada.');
    expect(p.lines[1]).toMatch(/^Se conservarán 2 sesiones importadas/);
    const r = describeDisconnectResult({ removed: 3, revocation: 'revoked' });
    expect(r.text).toBe(
      'Strava desconectado. Se eliminaron 3 sesiones importadas. Se revocó el acceso en Strava.'
    );
  });
});
