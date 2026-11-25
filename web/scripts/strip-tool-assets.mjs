#!/usr/bin/env node
// The Android app opens the dashboard and never routes to a movement tool, so
// the tools' JS (every anatomy-* chunk and worker) and their data files would
// ride in the APK as dead weight. ci-android.yml strips them from the built
// web assets before `npx cap sync android`, then runs this again with --check.
//
// Files are chosen by the registry's rule (movementAssets.mjs): the names
// vite.config.js gives them, which check-bundle-size.mjs proves the build
// obeyed. A pending data file is in the rule already, so it is stripped the
// day it lands without an edit here. RouteRoot's lazy imports still name the
// tool chunks but never run natively, and the service worker precaches none
// of them, so nothing fetches what was removed.
//
//   node scripts/strip-tool-assets.mjs dist/assets          remove them
//   node scripts/strip-tool-assets.mjs --check dist/assets  assert none left
//
// Exit 0 when done, 1 when there was nothing to strip (or, with --check, when
// any is left), 2 on a usage error.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_JS, isWebOnlyAsset } from './movementAssets.mjs';

export const USAGE =
  'usage: node scripts/strip-tool-assets.mjs [--check] <assetsDir>';

/** The web-only files in `dir`, by name, sorted. */
export const webOnlyFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isWebOnlyAsset(e.name))
    .map((e) => e.name)
    .sort();

/**
 * One run of the CLI, without exiting.
 * @param {string[]} args the command-line arguments
 * @returns {{ code: 0|1|2, out: string[], err: string[] }}
 */
export function run(args) {
  const check = args.includes('--check');
  const rest = args.filter((a) => a !== '--check');
  if (rest.length !== 1) return { code: 2, out: [], err: [USAGE] };
  const [dir] = rest;
  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    // Missing: reported as the usage error below.
  }
  if (!isDirectory) {
    return { code: 2, out: [], err: [`${dir} is not a directory. ${USAGE}`] };
  }
  const files = webOnlyFiles(dir);
  if (check) {
    return files.length
      ? {
          code: 1,
          out: [],
          err: [
            `web-only movement-tool files are still in ${dir}: ${files.join(', ')}`,
          ],
        }
      : {
          code: 0,
          out: [`no web-only movement-tool files in ${dir}`],
          err: [],
        };
  }
  if (!files.some((f) => TOOL_JS.test(f))) {
    return {
      code: 1,
      out: [],
      err: [
        `found no anatomy-* chunks to strip in ${dir} — the build named no tool chunks, or this is not a web build`,
      ],
    };
  }
  let bytes = 0;
  for (const name of files) {
    bytes += statSync(join(dir, name)).size;
    rmSync(join(dir, name));
  }
  return {
    code: 0,
    out: [
      ...files.map((name) => `removed ${name}`),
      `removed ${files.length} web-only files, ${bytes} bytes`,
    ],
    err: [],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, out, err } = run(process.argv.slice(2));
  for (const line of out) console.log(line);
  for (const line of err) console.error(line);
  process.exit(code);
}
