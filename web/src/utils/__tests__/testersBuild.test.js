import { describe, expect, it } from 'vitest';
import { DEV_PROJECT_REF, isTestersBuild } from '../testersBuild.js';

describe('isTestersBuild', () => {
  it('is true for a build pointed at the dev project', () => {
    expect(
      isTestersBuild({
        VITE_SUPABASE_URL: `https://${DEV_PROJECT_REF}.supabase.co`,
      })
    ).toBe(true);
  });

  it('is false for the production project and for anything else', () => {
    expect(
      isTestersBuild({
        VITE_SUPABASE_URL: 'https://swdrueaserjzhuxnzmeu.supabase.co',
      })
    ).toBe(false);
    expect(
      isTestersBuild({ VITE_SUPABASE_URL: 'http://localhost:54321' })
    ).toBe(false);
    expect(isTestersBuild({})).toBe(false);
    expect(isTestersBuild({ VITE_SUPABASE_URL: 'not a url' })).toBe(false);
    expect(isTestersBuild(undefined)).toBe(false);
  });

  it('is not fooled by the dev ref appearing elsewhere in a URL', () => {
    expect(
      isTestersBuild({
        VITE_SUPABASE_URL: `https://evil.example/${DEV_PROJECT_REF}.supabase.co`,
      })
    ).toBe(false);
    expect(
      isTestersBuild({
        VITE_SUPABASE_URL: `https://x.${DEV_PROJECT_REF}.supabase.co`,
      })
    ).toBe(false);
  });

  it('is true when the explicit flag is set, whatever the URL', () => {
    expect(
      isTestersBuild({
        VITE_TESTERS_BUILD: 'true',
        VITE_SUPABASE_URL: 'https://swdrueaserjzhuxnzmeu.supabase.co',
      })
    ).toBe(true);
    expect(isTestersBuild({ VITE_TESTERS_BUILD: 'TRUE' })).toBe(true);
    expect(isTestersBuild({ VITE_TESTERS_BUILD: 'false' })).toBe(false);
  });
});
