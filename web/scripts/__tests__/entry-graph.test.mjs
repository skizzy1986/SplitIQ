import {
  dataFileProblems,
  entryFilesFrom,
  firstPaintLeaks,
  isCountedAsset,
  movementFiles,
  navigationProblems,
  onlyReachableVia,
  onlyReachableViaAny,
  precachedTool,
  prefixMismatch,
  precacheUrls,
  reachableFiles,
  servesIndexNavigation,
  toolOnlyFiles,
} from '../entry-graph.mjs';
import {
  DATASETS,
  TOOL_JS,
  dataPattern,
  isWebOnlyAsset,
  sampleName,
} from '../movementAssets.mjs';

// A trimmed but structurally faithful copy of a real dist/.vite/manifest.json
// from this app after the #331 split: one HTML entry, a static shared chunk,
// and lazy route chunks that import back into the entry.
const MANIFEST = {
  'index.html': {
    file: 'assets/index-abc.js',
    isEntry: true,
    imports: ['_shared-def.js'],
    dynamicImports: ['src/App.jsx', 'src/views/mobile/MobileApp.jsx'],
    css: ['assets/index-ghi.css'],
    assets: ['assets/archivo-var-jkl.woff2'],
  },
  '_shared-def.js': {
    file: 'assets/shared-def.js',
  },
  'src/App.jsx': {
    file: 'assets/App-mno.js',
    isDynamicEntry: true,
    // The back-edge that makes an unguarded walk loop forever.
    imports: ['index.html'],
    dynamicImports: ['src/views/ProgramView.jsx'],
  },
  'src/views/mobile/MobileApp.jsx': {
    file: 'assets/MobileApp-pqr.js',
    isDynamicEntry: true,
    imports: ['index.html'],
  },
  'src/views/ProgramView.jsx': {
    file: 'assets/ProgramView-stu.js',
    isDynamicEntry: true,
    css: ['assets/ProgramView-vwx.css'],
  },
};

describe('entryFilesFrom', () => {
  // The whole point of the entry budget. If this walk followed dynamicImports
  // it would report the total as the entry, pass every build, and silently
  // make the gate meaningless again — the exact defect #331 set out to fix.
  it('excludes lazy chunks, and the CSS that only they pull in', () => {
    const files = entryFilesFrom(MANIFEST);

    expect(files).toContain('assets/index-abc.js');
    expect(files).toContain('assets/shared-def.js');
    expect(files).toContain('assets/index-ghi.css');

    expect(files).not.toContain('assets/App-mno.js');
    expect(files).not.toContain('assets/MobileApp-pqr.js');
    expect(files).not.toContain('assets/ProgramView-stu.js');
    expect(files).not.toContain('assets/ProgramView-vwx.css');
  });

  it('terminates despite a lazy chunk importing back into the entry', () => {
    // Not a hypothetical: every capacitor web chunk in this build does exactly
    // this. Without the `seen` guard the walk never returns.
    expect(entryFilesFrom(MANIFEST)).toHaveLength(3);
  });

  it('follows static imports transitively, not just one level', () => {
    const chained = {
      'index.html': { file: 'assets/a.js', isEntry: true, imports: ['b'] },
      b: { file: 'assets/b.js', imports: ['c'] },
      c: { file: 'assets/c.js', css: ['assets/c.css'] },
    };
    expect(entryFilesFrom(chained)).toEqual([
      'assets/a.js',
      'assets/b.js',
      'assets/c.js',
      'assets/c.css',
    ]);
  });

  it('counts every entry when a build emits more than one', () => {
    const twoEntries = {
      'index.html': { file: 'assets/a.js', isEntry: true },
      'admin.html': { file: 'assets/b.js', isEntry: true },
      unused: { file: 'assets/c.js' },
    };
    expect(entryFilesFrom(twoEntries)).toEqual(['assets/a.js', 'assets/b.js']);
  });

  // A manifest with no isEntry means the build changed shape under us. Reading
  // that as "the entry is 0 KB" would pass the budget while measuring nothing.
  it('throws rather than reporting an empty entry', () => {
    expect(() => entryFilesFrom({ a: { file: 'assets/a.js' } })).toThrow(
      /No isEntry/
    );
  });

  it('ignores fonts and images, which no byte budget here counts', () => {
    expect(isCountedAsset('index-abc.js')).toBe(true);
    expect(isCountedAsset('index-ghi.css')).toBe(true);
    expect(isCountedAsset('archivo-var-jkl.woff2')).toBe(false);
    expect(isCountedAsset('icon-192.png')).toBe(false);
  });
});

// The shape this app's manifest takes since /squat landed: main.jsx renders
// RouteRoot, which lazy-loads one product or the other. AuthGate statically
// pulls supabase; SquatApp pulls a shared tokens chunk and lists its worker
// and data files under `assets`.
const TWO_PRODUCTS = {
  'index.html': {
    file: 'assets/index-a.js',
    isEntry: true,
    dynamicImports: ['src/AuthGate.jsx', 'src/squat/SquatApp.jsx'],
    css: ['assets/index-a.css'],
  },
  'src/AuthGate.jsx': {
    file: 'assets/AuthGate-b.js',
    isDynamicEntry: true,
    imports: ['index.html', '_supabase-c.js', '_tokens-t.js'],
    dynamicImports: ['src/App.jsx'],
  },
  '_supabase-c.js': { file: 'assets/supabase-c.js' },
  '_tokens-t.js': { file: 'assets/tokens-t.js' },
  'src/App.jsx': {
    file: 'assets/App-d.js',
    isDynamicEntry: true,
    imports: ['index.html'],
  },
  'src/squat/SquatApp.jsx': {
    file: 'assets/SquatApp-e.js',
    isDynamicEntry: true,
    imports: ['index.html', '_tokens-t.js'],
    assets: [
      'assets/anatomyDecode.worker-f.js',
      'assets/squat-anatomy-g.bin',
      'assets/squat-manifest-h.json',
    ],
  },
};

describe('entryFilesFrom with bootKeys', () => {
  it('adds the boot chunk and its static graph to first paint', () => {
    expect(
      entryFilesFrom(TWO_PRODUCTS, { bootKeys: ['src/AuthGate.jsx'] })
    ).toEqual([
      'assets/index-a.js',
      'assets/index-a.css',
      'assets/AuthGate-b.js',
      'assets/supabase-c.js',
      'assets/tokens-t.js',
    ]);
  });

  it("does not follow a boot chunk's own dynamic imports", () => {
    const files = entryFilesFrom(TWO_PRODUCTS, {
      bootKeys: ['src/AuthGate.jsx'],
    });
    expect(files).not.toContain('assets/App-d.js');
    expect(files).not.toContain('assets/SquatApp-e.js');
  });

  it('gives /squat a first paint with no supabase in it', () => {
    const files = entryFilesFrom(TWO_PRODUCTS, {
      bootKeys: ['src/squat/SquatApp.jsx'],
    });
    expect(files).toContain('assets/SquatApp-e.js');
    expect(files).toContain('assets/tokens-t.js');
    expect(files).not.toContain('assets/supabase-c.js');
    expect(files).not.toContain('assets/AuthGate-b.js');
  });

  it('behaves exactly as before with no boot keys', () => {
    expect(entryFilesFrom(TWO_PRODUCTS)).toEqual([
      'assets/index-a.js',
      'assets/index-a.css',
    ]);
  });

  // A renamed AuthGate must fail loudly, not shrink the entry by its size.
  it('throws on a boot key the manifest does not have', () => {
    expect(() =>
      entryFilesFrom(TWO_PRODUCTS, { bootKeys: ['src/Gone.jsx'] })
    ).toThrow(/Boot key src\/Gone.jsx/);
  });
});

describe('tool-only classification', () => {
  it('walks static, dynamic and asset edges, stopping where told', () => {
    const all = reachableFiles(TWO_PRODUCTS, ['index.html']);
    expect(all.has('assets/App-d.js')).toBe(true);
    expect(all.has('assets/anatomyDecode.worker-f.js')).toBe(true);
    const dash = reachableFiles(TWO_PRODUCTS, ['index.html'], {
      stopAt: ['src/squat/SquatApp.jsx'],
    });
    expect(dash.has('assets/SquatApp-e.js')).toBe(false);
    expect(dash.has('assets/tokens-t.js')).toBe(true);
  });

  it('charges the tool only for what the dashboard cannot reach', () => {
    expect(
      toolOnlyFiles(TWO_PRODUCTS, ['src/squat/SquatApp.jsx']).sort()
    ).toEqual(
      [
        'assets/SquatApp-e.js',
        'assets/anatomyDecode.worker-f.js',
        'assets/squat-anatomy-g.bin',
        'assets/squat-manifest-h.json',
      ].sort()
    );
  });

  it('throws when a tool root is missing', () => {
    expect(() => toolOnlyFiles(TWO_PRODUCTS, ['src/nope.jsx'])).toThrow(
      /Movement root src\/nope\.jsx/
    );
  });

  it('terminates on cycles and tolerates dangling keys', () => {
    const cyclic = {
      'index.html': {
        file: 'assets/a.js',
        isEntry: true,
        imports: ['x', 'gone'],
      },
      x: { file: 'assets/x.js', dynamicImports: ['index.html'] },
    };
    expect([...reachableFiles(cyclic, ['index.html'])]).toEqual([
      'assets/a.js',
      'assets/x.js',
    ]);
  });
});

// The squat tool lazily loads its scene, and the scene chunk statically
// imports back into the tool's chunk for the code they share.
const WITH_SCENE = {
  ...TWO_PRODUCTS,
  'src/squat/SquatApp.jsx': {
    ...TWO_PRODUCTS['src/squat/SquatApp.jsx'],
    dynamicImports: ['src/anatomy/scene/createAnatomyScene.js'],
  },
  'src/anatomy/scene/createAnatomyScene.js': {
    file: 'assets/anatomy-createAnatomyScene-z.js',
    isDynamicEntry: true,
    imports: ['src/squat/SquatApp.jsx', '_three-y.js'],
  },
  '_three-y.js': { file: 'assets/anatomy-three-y.js' },
};
const SCENE = 'src/anatomy/scene/createAnatomyScene.js';

describe('onlyReachableVia (the 3D chunk)', () => {
  it('is the scene and three only — not the tool chunk it imports', () => {
    expect(onlyReachableVia(WITH_SCENE, SCENE).sort()).toEqual([
      'assets/anatomy-createAnatomyScene-z.js',
      'assets/anatomy-three-y.js',
    ]);
  });

  it('is a subset of the tool-only files', () => {
    const tool = new Set(toolOnlyFiles(WITH_SCENE, ['src/squat/SquatApp.jsx']));
    for (const f of onlyReachableVia(WITH_SCENE, SCENE)) {
      expect(tool.has(f)).toBe(true);
    }
  });

  it('stays out of both first-paint graphs', () => {
    const scene = onlyReachableVia(WITH_SCENE, SCENE);
    for (const boot of ['src/AuthGate.jsx', 'src/squat/SquatApp.jsx']) {
      const first = entryFilesFrom(WITH_SCENE, { bootKeys: [boot] });
      expect(first.filter((f) => scene.includes(f))).toEqual([]);
    }
  });

  it('names the missing key', () => {
    expect(() =>
      onlyReachableVia(WITH_SCENE, 'src/gone.js', 'Scene root')
    ).toThrow(/Scene root src\/gone.js/);
  });
});

describe('service worker inspection', () => {
  const SW =
    'e.precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/index-a.js",revision:null}],{});' +
    'e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")));';

  it('lists the precache URLs', () => {
    expect(precacheUrls(SW)).toEqual(['index.html', 'assets/index-a.js']);
  });

  it('reads an empty or absent sw.js as no precache entries', () => {
    expect(precacheUrls('')).toEqual([]);
    expect(precacheUrls(undefined)).toEqual([]);
    expect(precacheUrls('self.skipWaiting();')).toEqual([]);
  });

  it('finds the index.html navigation handler, minified or not', () => {
    expect(servesIndexNavigation(SW)).toBe(true);
    expect(
      servesIndexNavigation(
        'new s.NavigationRoute(s.createHandlerBoundToURL("index.html"))'
      )
    ).toBe(true);
    expect(
      servesIndexNavigation(SW.replace('index.html")))', 'other.html")))'))
    ).toBe(false);
    expect(servesIndexNavigation('')).toBe(false);
  });
});

describe('tool split invariants, one tool', () => {
  const BOOTS = ['src/AuthGate.jsx', 'src/squat/SquatApp.jsx'];

  describe('firstPaintLeaks', () => {
    it('passes when the scene is reachable only lazily', () => {
      expect(firstPaintLeaks(WITH_SCENE, SCENE, BOOTS)).toEqual([]);
    });

    it('fails when the tool statically imports the scene', () => {
      const leaky = {
        ...WITH_SCENE,
        'src/squat/SquatApp.jsx': {
          ...WITH_SCENE['src/squat/SquatApp.jsx'],
          imports: [...WITH_SCENE['src/squat/SquatApp.jsx'].imports, SCENE],
        },
      };
      const problems = firstPaintLeaks(leaky, SCENE, BOOTS);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/src\/squat\/SquatApp.jsx's first paint/);
      expect(problems[0]).toMatch(/anatomy-createAnatomyScene-z\.js/);
      expect(problems[0]).toMatch(/anatomy-three-y\.js/);
    });

    it('fails when the entry statically imports the scene', () => {
      const leaky = {
        ...WITH_SCENE,
        'index.html': {
          ...WITH_SCENE['index.html'],
          imports: [...(WITH_SCENE['index.html'].imports ?? []), SCENE],
        },
      };
      const problems = firstPaintLeaks(leaky, SCENE, BOOTS);
      // On both first paints: every boot graph walks the entry.
      expect(problems).toHaveLength(2);
      expect(problems[0]).toMatch(/src\/AuthGate.jsx's first paint/);
    });

    it('fails when the scene chunk is folded into a shared one', () => {
      const merged = {
        ...WITH_SCENE,
        [SCENE]: { file: 'assets/tokens-t.js', imports: [] },
      };
      expect(firstPaintLeaks(merged, SCENE, BOOTS)[0]).toMatch(
        /Nothing is reachable only through/
      );
    });

    it('throws on a missing scene root', () => {
      expect(() => firstPaintLeaks(WITH_SCENE, 'src/gone.js', BOOTS)).toThrow(
        /src\/gone.js/
      );
    });
  });

  describe('prefixMismatch', () => {
    const graph = [
      'assets/anatomy-a.js',
      'assets/anatomy-b.js',
      'assets/x.bin',
    ];

    it('passes when the graph and the names agree', () => {
      expect(
        prefixMismatch(
          graph,
          ['anatomy-b.js', 'anatomy-a.js', 'index.js'],
          TOOL_JS
        )
      ).toEqual([]);
    });

    it('fails on a tool-only chunk without the prefix', () => {
      const [msg] = prefixMismatch(
        [...graph, 'assets/three-c.js'],
        ['anatomy-a.js', 'anatomy-b.js', 'three-c.js'],
        TOOL_JS
      );
      expect(msg).toMatch(/differ/);
      expect(msg).toMatch(/three-c\.js/);
    });

    it('fails on a prefixed chunk the dashboard also reaches', () => {
      expect(
        prefixMismatch(
          graph,
          ['anatomy-a.js', 'anatomy-b.js', 'anatomy-shared.js'],
          TOOL_JS
        )
      ).toHaveLength(1);
    });
  });

  describe('navigationProblems', () => {
    it('passes when index.html serves navigations', () => {
      expect(
        navigationProblems(
          'r(new s.NavigationRoute(s.createHandlerBoundToURL("index.html")))'
        )
      ).toEqual([]);
    });

    it('fails when the handler is missing or points elsewhere', () => {
      expect(navigationProblems('')).toHaveLength(1);
      expect(navigationProblems(undefined)).toHaveLength(1);
      expect(
        navigationProblems(
          'new s.NavigationRoute(s.createHandlerBoundToURL("offline.html"))'
        )
      ).toHaveLength(1);
    });
  });
});

// #756: two tool roots behind one entry. Both lazy-load the shared scene, and
// both import a tool-only chunk they share (anatomy code), which is exactly
// what a one-root walk mis-files: reachable from the other tool, it looks
// like the dashboard's.
const SQUAT = 'src/squat/SquatApp.jsx';
const ROW = 'src/row/RowApp.jsx';
const BOOT = 'src/AuthGate.jsx';
const ES = 'src/locales/es.po';
const TOOLS = [SQUAT, ROW];
const THREE_ROOTS = {
  'index.html': {
    file: 'assets/index-a.js',
    isEntry: true,
    dynamicImports: [BOOT, SQUAT, ROW],
    css: ['assets/index-a.css'],
  },
  [BOOT]: {
    file: 'assets/AuthGate-b.js',
    isDynamicEntry: true,
    imports: ['index.html', '_supabase-c.js', '_tokens-t.js'],
    dynamicImports: ['src/App.jsx', ES],
  },
  '_supabase-c.js': { file: 'assets/supabase-c.js' },
  '_tokens-t.js': { file: 'assets/tokens-t.js' },
  'src/App.jsx': {
    file: 'assets/App-d.js',
    isDynamicEntry: true,
    imports: ['index.html'],
  },
  [ES]: { file: 'assets/i18n-es-e.js', isDynamicEntry: true },
  [SQUAT]: {
    file: 'assets/anatomy-SquatApp-f.js',
    isDynamicEntry: true,
    imports: ['index.html', '_tokens-t.js', '_anatomy-shared-s.js'],
    dynamicImports: [SCENE],
    assets: [
      'assets/anatomy-anatomyDecode.worker-g.js',
      'assets/squat-manifest-h.json',
    ],
  },
  [ROW]: {
    file: 'assets/anatomy-RowApp-i.js',
    isDynamicEntry: true,
    imports: ['index.html', '_tokens-t.js', '_anatomy-shared-s.js'],
    dynamicImports: [SCENE],
    assets: [
      'assets/anatomy-anatomyDecode.worker-j.js',
      'assets/row-manifest-k.json',
    ],
  },
  '_anatomy-shared-s.js': { file: 'assets/anatomy-shared-s.js' },
  [SCENE]: {
    file: 'assets/anatomy-createAnatomyScene-z.js',
    isDynamicEntry: true,
    imports: ['_anatomy-shared-s.js', '_three-y.js'],
  },
  '_three-y.js': { file: 'assets/anatomy-three-y.js' },
};
const a = (...names) => names.map((n) => `assets/${n}`).sort();
const sorted = (list) => [...list].sort();
// Every file the build emitted, as dist/assets would list them.
const emitted = (m) => [...reachableFiles(m, ['index.html'])];

describe('the three-root graph', () => {
  const toolOnly = new Set(toolOnlyFiles(THREE_ROOTS, TOOLS));
  const scene3d = new Set(onlyReachableVia(THREE_ROOTS, SCENE));
  const movementTotal = (root) =>
    movementFiles(THREE_ROOTS, root, TOOLS).filter(
      (f) => isCountedAsset(f) && !scene3d.has(f)
    );

  it('shows the trap: one root at a time, the shared chunk, scene and three fall out of the squat', () => {
    expect(sorted(onlyReachableVia(THREE_ROOTS, SQUAT))).toEqual(
      a(
        'anatomy-SquatApp-f.js',
        'anatomy-anatomyDecode.worker-g.js',
        'squat-manifest-h.json'
      )
    );
  });

  it('toolOnlyFiles walks the tool roots together', () => {
    expect(sorted(toolOnly)).toEqual(
      a(
        'anatomy-SquatApp-f.js',
        'anatomy-RowApp-i.js',
        'anatomy-shared-s.js',
        'anatomy-createAnatomyScene-z.js',
        'anatomy-three-y.js',
        'anatomy-anatomyDecode.worker-g.js',
        'anatomy-anatomyDecode.worker-j.js',
        'squat-manifest-h.json',
        'row-manifest-k.json'
      )
    );
  });

  it('leaves the dashboard TOTAL only what the dashboard can reach', () => {
    const dashEs = new Set(onlyReachableVia(THREE_ROOTS, ES));
    const total = emitted(THREE_ROOTS).filter(
      (f) => isCountedAsset(f) && !toolOnly.has(f) && !dashEs.has(f)
    );
    expect(sorted(total)).toEqual(
      a(
        'index-a.js',
        'index-a.css',
        'AuthGate-b.js',
        'supabase-c.js',
        'tokens-t.js',
        'App-d.js'
      )
    );
  });

  it('keeps the 3D figure to the scene and three', () => {
    expect(sorted(scene3d)).toEqual(
      a('anatomy-createAnatomyScene-z.js', 'anatomy-three-y.js')
    );
  });

  it('counts the chunk the tools share in each movement total', () => {
    expect(sorted(movementTotal(SQUAT))).toEqual(
      a(
        'anatomy-SquatApp-f.js',
        'anatomy-shared-s.js',
        'anatomy-anatomyDecode.worker-g.js'
      )
    );
    expect(sorted(movementTotal(ROW))).toEqual(
      a(
        'anatomy-RowApp-i.js',
        'anatomy-shared-s.js',
        'anatomy-anatomyDecode.worker-j.js'
      )
    );
  });

  it('gives each movement an entry of the shared main chunk and its own static graph', () => {
    expect(entryFilesFrom(THREE_ROOTS, { bootKeys: [SQUAT] })).toEqual([
      'assets/index-a.js',
      'assets/index-a.css',
      'assets/anatomy-SquatApp-f.js',
      'assets/tokens-t.js',
      'assets/anatomy-shared-s.js',
    ]);
    expect(entryFilesFrom(THREE_ROOTS, { bootKeys: [ROW] })).toEqual([
      'assets/index-a.js',
      'assets/index-a.css',
      'assets/anatomy-RowApp-i.js',
      'assets/tokens-t.js',
      'assets/anatomy-shared-s.js',
    ]);
  });

  describe('prefixMismatch', () => {
    const names = (m) => emitted(m).map((f) => f.slice('assets/'.length));

    it('passes when every tool-only chunk, and nothing else, is named anatomy-*', () => {
      expect(
        prefixMismatch([...toolOnly], names(THREE_ROOTS), TOOL_JS)
      ).toEqual([]);
    });

    it('flags the shared tool chunk built with a plain name', () => {
      const plain = {
        ...THREE_ROOTS,
        '_anatomy-shared-s.js': { file: 'assets/shared-s.js' },
      };
      const [msg] = prefixMismatch(
        toolOnlyFiles(plain, TOOLS),
        names(plain),
        TOOL_JS
      );
      expect(msg).toMatch(/^The tool-only JS and the anatomy-\* JS differ\./);
      expect(msg).toMatch(/tool-only: .*shared-s\.js/);
      expect(msg).toMatch(/Fix scripts\/movementAssets\.mjs/);
    });

    it('flags an anatomy-* chunk the dashboard reaches too', () => {
      const shared = {
        ...THREE_ROOTS,
        [BOOT]: {
          ...THREE_ROOTS[BOOT],
          imports: [...THREE_ROOTS[BOOT].imports, '_anatomy-shared-s.js'],
        },
      };
      const [msg] = prefixMismatch(
        toolOnlyFiles(shared, TOOLS),
        names(shared),
        TOOL_JS
      );
      expect(msg).toMatch(/anatomy-\*: .*anatomy-shared-s\.js/);
      expect(msg.split('\n')[1]).not.toMatch(/shared-s/);
    });
  });

  describe('firstPaintLeaks', () => {
    const TOOL_CODE = {
      what: 'movement-tool code',
      fix: 'Lazy-load every tool root from RouteRoot.',
    };

    const tool = (title) => ({
      what: `the ${title} tool`,
      fix: 'Each tool root loads lazily, from RouteRoot only.',
    });

    it('passes: no tool on the dashboard first paint, no tool on another', () => {
      expect(firstPaintLeaks(THREE_ROOTS, TOOLS, [BOOT], TOOL_CODE)).toEqual(
        []
      );
      expect(firstPaintLeaks(THREE_ROOTS, ROW, [SQUAT], tool('Row'))).toEqual(
        []
      );
      expect(firstPaintLeaks(THREE_ROOTS, SQUAT, [ROW], tool('Squat'))).toEqual(
        []
      );
      expect(firstPaintLeaks(THREE_ROOTS, SCENE, [BOOT, ...TOOLS])).toEqual([]);
    });

    it('flags RowApp moved into the entry, on the dashboard first paint', () => {
      const eager = {
        ...THREE_ROOTS,
        'index.html': {
          ...THREE_ROOTS['index.html'],
          imports: [ROW],
          dynamicImports: [BOOT, SQUAT],
        },
      };
      expect(firstPaintLeaks(eager, TOOLS, [BOOT], TOOL_CODE)).toEqual([
        "Movement-tool code is on src/AuthGate.jsx's first paint: anatomy-RowApp-i.js, anatomy-shared-s.js. Lazy-load every tool root from RouteRoot.",
      ]);
    });

    it("flags RowApp on the squat's first paint", () => {
      const coupled = {
        ...THREE_ROOTS,
        [SQUAT]: {
          ...THREE_ROOTS[SQUAT],
          imports: [...THREE_ROOTS[SQUAT].imports, ROW],
        },
      };
      expect(firstPaintLeaks(coupled, ROW, [SQUAT], tool('Row'))).toEqual([
        "The Row tool is on src/squat/SquatApp.jsx's first paint: anatomy-RowApp-i.js. Each tool root loads lazily, from RouteRoot only.",
      ]);
    });

    it('names every root when nothing is reachable only through them', () => {
      const merged = {
        ...THREE_ROOTS,
        [SQUAT]: { file: 'assets/tokens-t.js' },
        [ROW]: { file: 'assets/tokens-t.js' },
      };
      expect(firstPaintLeaks(merged, TOOLS, [BOOT], TOOL_CODE)[0]).toBe(
        `Nothing is reachable only through ${SQUAT}, ${ROW} — movement-tool code was merged into something else, or renamed.`
      );
    });
  });

  it('refuses a root that is missing, unlisted, or no roots at all', () => {
    expect(() =>
      toolOnlyFiles(THREE_ROOTS, [SQUAT, 'src/gone/GoneApp.jsx'])
    ).toThrow('Movement root src/gone/GoneApp.jsx is not in the manifest.');
    expect(() => movementFiles(THREE_ROOTS, ROW, [SQUAT])).toThrow(
      `${ROW} is not one of the movement roots.`
    );
    expect(() => onlyReachableViaAny(THREE_ROOTS, [])).toThrow(/No Root key/);
  });
});

describe('with one tool root, the new figures equal the old', () => {
  // squatOnlyFiles as it was at 5def051, before #756 replaced it: the
  // reference the generalised walk must reproduce for a single tool.
  const squatOnlyAt5def051 = (manifest, key) => {
    const entries = Object.keys(manifest).filter((k) => manifest[k]?.isEntry);
    const others = reachableFiles(manifest, entries, { stopAt: [key] });
    return [...reachableFiles(manifest, [key])].filter((f) => !others.has(f));
  };

  it.each([
    ['TWO_PRODUCTS', TWO_PRODUCTS],
    ['WITH_SCENE', WITH_SCENE],
  ])('%s', (_, m) => {
    const old = sorted(squatOnlyAt5def051(m, SQUAT));
    expect(old.length).toBeGreaterThan(0);
    expect(sorted(toolOnlyFiles(m, [SQUAT]))).toEqual(old);
    expect(sorted(movementFiles(m, SQUAT, [SQUAT]))).toEqual(old);
    expect(sorted(onlyReachableViaAny(m, [SQUAT]))).toEqual(old);
    expect(firstPaintLeaks(m, [SQUAT], [BOOT])).toEqual(
      firstPaintLeaks(m, SQUAT, [BOOT])
    );
  });
});

describe('precachedTool', () => {
  it('passes a precache of app files', () => {
    expect(
      precachedTool(
        [
          'index.html',
          'assets/index-a.js',
          'assets/index-a.css',
          'assets/i18n-es-a.js',
          'icons/icon-192.png',
        ],
        isWebOnlyAsset
      )
    ).toEqual([]);
    expect(precachedTool([], isWebOnlyAsset)).toEqual([]);
  });

  it('precachedTool flags every registered tool and data sample, at the root and under a prefix', () => {
    const names = [
      'anatomy-SquatApp-Ab12Cd34.js',
      'anatomy-anatomyDecode.worker-Ab12Cd34.js',
      ...DATASETS.map(sampleName),
    ];
    for (const name of names) {
      for (const url of [`assets/${name}`, `row/assets/${name}`]) {
        expect(precachedTool(['index.html', url], isWebOnlyAsset)).toEqual([
          `sw.js precaches movement-tool files: ${url}. They belong in globIgnores.`,
        ]);
      }
    }
  });

  it('does not mistake a file outside assets/ for one', () => {
    expect(
      precachedTool(['icons/anatomy-icon.png', 'anatomy-x.js'], isWebOnlyAsset)
    ).toEqual([]);
  });
});

describe('dataFileProblems', () => {
  const REGISTERED = DATASETS.map((d) => ({ ...d, pattern: dataPattern(d) }));
  // The real 5def051 squat files.
  const SQUAT_FILES = {
    'squat-anatomy-1JgcrXkx.bin': 2_202_168,
    'squat-manifest-BdY4EZAe.json': 99_892,
  };
  const APP = [
    'index-a.js',
    'index-a.css',
    'archivo-var-a.woff2',
    'anatomy-SquatApp-f.js',
  ];
  const check = (datasets, sizes, extra = []) =>
    dataFileProblems(
      datasets,
      [...APP, ...Object.keys(sizes), ...extra],
      (name) => sizes[name]
    );
  const live = (budgetBytes) =>
    REGISTERED.map((d) =>
      d.pending ? { ...d, pending: null, budgetBytes } : d
    );
  const ROW_FILES = {
    'anatomy-body-b1.bin': 2_040_000,
    'row-motion-m1.bin': 650_000,
    'row-manifest-k1.json': 110_000,
  };
  const only = (id) => REGISTERED.filter((d) => d.id === id);

  it("passes the real registry's squat files, with its pending row files absent", () => {
    expect(check(REGISTERED, SQUAT_FILES)).toEqual({
      problems: [],
      files: [
        {
          id: 'squat-anatomy',
          file: 'squat-anatomy-1JgcrXkx.bin',
          bytes: 2_202_168,
          budgetBytes: 2_300_000,
          pending: null,
        },
        {
          id: 'squat-manifest',
          file: 'squat-manifest-BdY4EZAe.json',
          bytes: 99_892,
          budgetBytes: 105_000,
          pending: null,
        },
        ...['anatomy-body', 'row-motion', 'row-manifest'].map((id) => ({
          id,
          file: null,
          bytes: null,
          budgetBytes: null,
          pending: '#760',
        })),
      ],
    });
  });

  it('two registered bins and their manifest, live and within budget, pass the data rule', () => {
    const { files, problems } = check(live(2_300_000), {
      ...SQUAT_FILES,
      ...ROW_FILES,
    });
    expect(problems).toEqual([]);
    expect(files.map((f) => [f.id, f.file, f.bytes])).toEqual([
      ['squat-anatomy', 'squat-anatomy-1JgcrXkx.bin', 2_202_168],
      ['squat-manifest', 'squat-manifest-BdY4EZAe.json', 99_892],
      ['anatomy-body', 'anatomy-body-b1.bin', 2_040_000],
      ['row-motion', 'row-motion-m1.bin', 650_000],
      ['row-manifest', 'row-manifest-k1.json', 110_000],
    ]);
  });

  it('fails a live dataset with no file, saying it may have been inlined', () => {
    const [bin] = only('squat-anatomy');
    expect(check([bin], {}).problems).toEqual([
      `Expected exactly one squat-anatomy file (${bin.pattern}) in dist/assets, found none. Nothing imports squat-anatomy.bin with ?url, or Vite inlined it (under build.assetsInlineLimit): a data: URL that connect-src blocks.`,
    ]);
  });

  it('fails a live dataset with two files', () => {
    const sizes = { 'squat-anatomy-a.bin': 1, 'squat-anatomy-b.bin': 1 };
    const { files, problems } = check(only('squat-anatomy'), sizes);
    expect(problems).toEqual([
      'Expected exactly one squat-anatomy file, found 2: squat-anatomy-a.bin, squat-anatomy-b.bin. Two sources share the name, or dist/ is stale; rebuild from clean.',
    ]);
    expect(files[0].file).toBeNull();
  });

  it('fails a file over its budget', () => {
    expect(
      check(only('squat-manifest'), { 'squat-manifest-BdY4EZAe.json': 105_001 })
        .problems
    ).toEqual([
      'squat-manifest-BdY4EZAe.json is 105001 bytes, over its 105000-byte budget (squat-manifest). Raise it deliberately (#504) in scripts/movementAssets.mjs.',
    ]);
  });

  it('fails a pending dataset that already has a file', () => {
    expect(
      check(REGISTERED, { ...SQUAT_FILES, 'row-motion-m1.bin': 650_000 })
        .problems
    ).toEqual([
      'row-motion is pending (#760) but dist/assets has row-motion-m1.bin. Measure it, set its budget (#504) and mark it live in scripts/movementAssets.mjs.',
    ]);
  });

  it('fails a file two datasets claim (row versus row-motion)', () => {
    const overlapping = ['row', 'row-motion'].map((stem) => ({
      id: stem,
      stem,
      ext: 'bin',
      pattern: dataPattern({ stem, ext: 'bin' }),
      budgetBytes: 2_300_000,
      pending: null,
    }));
    expect(
      check(overlapping, { 'row-motion-m1.bin': 650_000 }).problems
    ).toContain(
      'row-motion-m1.bin matches more than one registered dataset (row, row-motion).'
    );
  });

  it('fails an unregistered .bin or .json, and only those', () => {
    expect(
      check(REGISTERED, SQUAT_FILES, ['other-x.bin', 'stats-y.json']).problems
    ).toEqual([
      'dist/assets/other-x.bin is an unregistered data file. Register it in scripts/movementAssets.mjs so it is budgeted, stripped from the APK and served with its headers.',
      'dist/assets/stats-y.json is an unregistered data file. Register it in scripts/movementAssets.mjs so it is budgeted, stripped from the APK and served with its headers.',
    ]);
  });
});
