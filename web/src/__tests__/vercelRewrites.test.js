import config from '../../vercel.json';
import {
  DATASETS,
  MOVEMENTS,
  sampleName,
  vercelRules,
} from '../../scripts/movementAssets.mjs';

// vercel.json's routing, as Vercel applies it: redirects, then headers, then
// rewrites, so a header rule matches the public path ("How Vercel CDN
// works"); the filesystem first, then rewrites in order with the first match
// winning (Vercel docs, "Rewrites", and the vercel.json reference: "the
// filesystem takes precedence over rewrites"). Every source here is a plain
// regex path, so it maps 1:1.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const OCTET = 'application/octet-stream';
const routeOf = (id) => MOVEMENTS.find((m) => m.id === id).route;
const ROUTES = MOVEMENTS.map((m) => m.route);
const SAMPLES = DATASETS.map(sampleName);
const STATIC_FILES = new Set([
  '/assets/index-abc.js',
  ...SAMPLES.map((name) => `/assets/${name}`),
  '/registerSW.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
]);
const toRegex = (source) => new RegExp(`^${source}$`);

function resolve(path) {
  if (STATIC_FILES.has(path)) return path;
  for (const { source, destination } of config.rewrites) {
    const m = path.match(toRegex(source));
    if (m) return destination.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
  }
  return path;
}

const headersFor = (path) =>
  Object.fromEntries(
    config.headers
      .filter(({ source }) => toRegex(source).test(path))
      .flatMap(({ headers }) => headers.map((h) => [h.key, h.value]))
  );
const sourcesSetting = (key) =>
  config.headers
    .filter(({ headers }) => headers.some((h) => h.key === key))
    .map(({ source }) => source);

describe('vercel.json routing for the movement tools', () => {
  it('has no redirect on any movement path — a client replaceState canonicalises it', () => {
    const redirects = config.redirects ?? [];
    for (const route of ROUTES) {
      expect(redirects.filter((r) => r.source.startsWith(route))).toEqual([]);
    }
  });

  it('keeps the SPA catch-all last; the rewrites before it are exactly vercelRules().rewrites', () => {
    expect(config.rewrites.at(-1)).toEqual({
      source: '/(.*)',
      destination: '/',
    });
    expect(config.rewrites.slice(0, -1)).toEqual(vercelRules().rewrites);
  });

  it.each([
    ['/squat', '/'],
    ['/squat/', '/'],
    ['/row', '/'],
    ['/row/', '/'],
    ['/squat/assets/index-abc.js', '/assets/index-abc.js'],
    ['/squat/registerSW.js', '/registerSW.js'],
    ['/squat/manifest.webmanifest', '/manifest.webmanifest'],
    ['/squat/icons/icon-192.png', '/icons/icon-192.png'],
    ['/row/assets/index-abc.js', '/assets/index-abc.js'],
    ['/row/icons/icon-192.png', '/icons/icon-192.png'],
    ['/row/registerSW.js', '/registerSW.js'],
    ['/row/manifest.webmanifest', '/manifest.webmanifest'],
    ['/assets/index-abc.js', '/assets/index-abc.js'],
    // Not tool paths: the dashboard's AuthGate answers them.
    ['/rows', '/'],
    ['/row/extra', '/'],
    ['/ROW', '/'],
  ])('%s is served from %s', (path, served) => {
    expect(resolve(path)).toBe(served);
  });

  it('serves every data sample from its root file under both prefixes', () => {
    for (const name of SAMPLES) {
      for (const route of ROUTES) {
        expect(resolve(`${route}/assets/${name}`), route).toBe(
          `/assets/${name}`
        );
      }
    }
  });

  it("gives each movement's rewritten asset paths /assets/'s headers (index-abc.js and its own data samples)", () => {
    for (const { id, route } of MOVEMENTS) {
      const names = [
        'index-abc.js',
        ...DATASETS.filter((d) => d.movements.includes(id)).map(sampleName),
      ];
      for (const name of names) {
        const direct = headersFor(`/assets/${name}`);
        expect(direct['Cache-Control']).toBe(IMMUTABLE);
        expect(headersFor(`${route}/assets/${name}`), name).toEqual(direct);
      }
    }
  });

  it("serves every registered bin as octet-stream and immutable at the root and under its movements' prefixes; no other Content-Type rule exists", () => {
    const bins = DATASETS.filter((d) => d.ext === 'bin');
    expect(bins.length).toBeGreaterThan(0);
    for (const d of bins) {
      for (const prefix of ['', ...d.movements.map(routeOf)]) {
        const headers = headersFor(`${prefix}/assets/${sampleName(d)}`);
        expect(headers['Content-Type'], `${prefix} ${d.id}`).toBe(OCTET);
        expect(headers['Cache-Control'], `${prefix} ${d.id}`).toBe(IMMUTABLE);
      }
    }
    expect(sourcesSetting('Content-Type')).toEqual(vercelRules().octetStream);
    // A manifest keeps Vercel's default JSON type.
    for (const d of DATASETS.filter((x) => x.ext === 'json')) {
      expect(headersFor(`/assets/${sampleName(d)}`)['Content-Type']).toBe(
        undefined
      );
    }
  });

  it('marks exactly the registered asset paths immutable', () => {
    expect(sourcesSetting('Cache-Control')).toEqual(vercelRules().immutable);
  });
});
