import { describe, it, expect } from 'vitest';
import { readPackageVersion, resolveAppBuild } from '../appBuild.mjs';

const version = '1.3.0';

describe('resolveAppBuild', () => {
  it('uses an explicit SPLITIQ_APP_BUILD over every other signal', () => {
    expect(
      resolveAppBuild({
        env: {
          SPLITIQ_APP_BUILD: '1.3.0+1249',
          SPLITIQ_VERSION_CODE: '9999',
          VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
          GITHUB_SHA: 'deadbeefcafebabe',
        },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('1.3.0+1249');
  });

  it('ignores a blank SPLITIQ_APP_BUILD', () => {
    expect(
      resolveAppBuild({
        env: { SPLITIQ_APP_BUILD: '  ', SPLITIQ_VERSION_CODE: '1249' },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('1.3.0+1249');
  });

  it('builds versionName+versionCode the same way Gradle and Obtainium do', () => {
    expect(
      resolveAppBuild({
        env: { SPLITIQ_VERSION_CODE: '1249', GITHUB_SHA: 'deadbeefcafebabe' },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('1.3.0+1249');
  });

  it('prefers the Android version over a Vercel SHA', () => {
    expect(
      resolveAppBuild({
        env: {
          SPLITIQ_VERSION_CODE: '1249',
          VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
        },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('1.3.0+1249');
  });

  it('uses the short Vercel commit SHA on a web production build', () => {
    expect(
      resolveAppBuild({
        env: { VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('abcdef1');
  });

  it('falls back to the short GitHub SHA on a CI web build', () => {
    expect(
      resolveAppBuild({
        env: { GITHUB_SHA: 'deadbeefcafebabe' },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('deadbee');
  });

  it('prefers the Vercel SHA when both SHAs are present', () => {
    expect(
      resolveAppBuild({
        env: {
          VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
          GITHUB_SHA: 'deadbeefcafebabe',
        },
        command: 'build',
        packageVersion: version,
      })
    ).toBe('abcdef1');
  });

  it('stays on dev during vite serve and vitest, even when a SHA is set', () => {
    const env = { GITHUB_SHA: 'deadbeefcafebabe' };
    expect(
      resolveAppBuild({ env, command: 'serve', packageVersion: version })
    ).toBe('dev');
    expect(resolveAppBuild({ env, packageVersion: version })).toBe('dev');
  });

  it('returns dev when nothing is set', () => {
    expect(
      resolveAppBuild({ env: {}, command: 'build', packageVersion: version })
    ).toBe('dev');
  });

  it('reads the real package.json version when none is passed', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(
      resolveAppBuild({
        env: { SPLITIQ_VERSION_CODE: '1249' },
        command: 'build',
      })
    ).toBe(`${readPackageVersion()}+1249`);
  });
});
