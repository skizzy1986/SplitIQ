// Build identifier baked into the client via Vite `define` (`__APP_BUILD__`).
//
// Android CI must match Obtainium and the APK's versionName: package.json
// version + "+" + SPLITIQ_VERSION_CODE (the workflow run number), the same
// values Gradle already uses (#773, #763). Vercel and other production web
// builds use the short commit SHA. Local `vite` and Vitest stay on "dev",
// even in CI where GITHUB_SHA is set, so splash tests stay deterministic.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHORT_SHA = 7;
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readPackageVersion(webDir = WEB_DIR) {
  const pkg = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8'));
  return pkg.version;
}

export function resolveAppBuild({
  env = process.env,
  command,
  packageVersion,
} = {}) {
  const explicit = env.SPLITIQ_APP_BUILD?.trim();
  if (explicit) return explicit;

  const versionCode = env.SPLITIQ_VERSION_CODE?.trim();
  if (versionCode) {
    const version = packageVersion ?? readPackageVersion();
    return `${version}+${versionCode}`;
  }

  if (command === 'build') {
    const sha = (env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || '').trim();
    if (sha) return sha.slice(0, SHORT_SHA);
  }

  return 'dev';
}
