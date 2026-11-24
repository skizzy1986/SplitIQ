"""PNG renders (matplotlib, lazily imported: Agg, orthographic, painter's sort, Lambert shading) and GLB exports
(trimesh) of the five key poses, the squat S = 0 and S = 1 references and the skin at rest."""
import hashlib

import numpy as np

from row.spike import posing

VIEWS = {'side': (0.0, 0.0), 'three': (45.0, 20.0)}
COL = {'bone': (0.90, 0.87, 0.79), 'muscle': (0.74, 0.24, 0.22), 'erg': (0.35, 0.38, 0.42), 'skin': (0.86, 0.71, 0.60)}
MIRROR_SETS = ('cm', 'lb', 'st')


def view_matrix(az, el):
    a, e = np.radians(az), np.radians(el)
    Ry = np.array([[np.cos(a), 0, -np.sin(a)], [0, 1, 0], [np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
    return Rx @ Ry      # camera space: x right, y up, z toward the viewer


def mirrored(V, F):
    return V * [1, 1, -1], F[:, ::-1]


def layers_of(sh, bodyV, topo, extra=()):
    """[(V, F, colour)] for the right side, its mirror and the axial parts, from packed vertices."""
    out = []
    for g, bm in sh.meta['bones'].items():
        V = bodyV['bone'][g]
        F = sh.bone(g)[2]
        out.append((V, F, COL['bone']))
        if bm.get('mirror'):
            out.append((*mirrored(V, F), COL['bone']))
    for k, (F, mid) in topo.items():
        V = bodyV['set'][k]
        out.append((V, F, COL['muscle']))
        if k in MIRROR_SETS:
            out.append((*mirrored(V, F), COL['muscle']))
    return out + list(extra)


def box(c, size):
    c = np.asarray(c, float)
    h = np.asarray(size, float) / 2
    V = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]) * h + c
    F = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
                  [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]])
    return V, F


def cylinder_z(cx, cy, r, z0, z1, n=16):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ring = np.c_[cx + r * np.cos(t), cy + r * np.sin(t)]
    V = np.vstack([np.c_[ring, np.full(n, z0)], np.c_[ring, np.full(n, z1)]])
    F = []
    for i in range(n):
        j = (i + 1) % n
        F += [[i, j, n + j], [i, n + j, n + i]]
    return V, np.array(F)


def erg_parts(erg, pose):
    v = lambda k: erg[k]['value']
    hx, hy = pose['handle']
    seat_x = pose['hip_x']
    fly = v('ankle_x') + v('flywheel_dx')
    parts = [box((seat_x, v('seat_top_y') - 0.025, 0), (0.30, 0.05, 0.28)),
             box((-0.55, v('seat_top_y') - 0.09, 0), (v('rail_len'), 0.04, 0.07)),
             cylinder_z(hx, hy, v('handle_r'), -0.27, 0.27)]
    a = np.radians(v('footplate_deg'))
    d = np.array([np.cos(a), np.sin(a), 0])
    o = np.array([v('ankle_x'), v('ankle_y'), 0]) - 0.06 * np.array([np.sin(a), -np.cos(a), 0]) - 0.12 * d
    fp = np.array([o + s * d + [0, 0, z] for s in (0, 0.32) for z in (-0.22, 0.22)])
    parts.append((fp, np.array([[0, 1, 3], [0, 3, 2]])))
    ch = np.array([[hx, hy - 0.003, 0], [fly, hy - 0.003, 0], [fly, hy + 0.003, 0], [hx, hy + 0.003, 0]])
    parts.append((ch, np.array([[0, 1, 2], [0, 2, 3]])))
    return [(V, F2, COL['erg']) for V, F in parts for F2 in (F, F[:, ::-1])]  # two-sided


def draw(path, layers, view, title):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    R = view_matrix(*VIEWS[view])
    polys, cols, depth = [], [], []
    light = np.array([0.35, 0.55, 0.76])
    light /= np.linalg.norm(light)
    for V, F, c in layers:
        P = V @ R.T
        T = P[F]
        n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        ln = np.linalg.norm(n, axis=1)
        ok = ln > 0
        n[ok] /= ln[ok, None]
        front = n[:, 2] > 0
        T, n = T[front], n[front]
        shade = 0.35 + 0.65 * np.clip(n @ light, 0, 1)
        polys.append(T[:, :, :2])
        cols.append(np.clip(np.outer(shade, c), 0, 1))
        depth.append(T[:, :, 2].mean(1))
    polys = np.concatenate(polys)
    cols = np.concatenate(cols)
    order = np.argsort(np.concatenate(depth), kind='stable')
    fig = plt.figure(figsize=(16, 10), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.add_collection(PolyCollection(polys[order], facecolors=cols[order], edgecolors='none', antialiased=False))
    xy = polys.reshape(-1, 2)
    lo, hi = xy.min(0), xy.max(0)
    c, s = (lo + hi) / 2, max((hi - lo)[0] / 1.6, (hi - lo)[1]) * 0.55
    ax.set_xlim(c[0] - 1.6 * s, c[0] + 1.6 * s)
    ax.set_ylim(c[1] - s, c[1] + s)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.text(0.01, 0.98, title, transform=ax.transAxes, va='top', fontsize=14, color=(0.2, 0.2, 0.2))
    fig.savefig(path, dpi=100, facecolor='white')
    plt.close(fig)


def glb(path, layers):
    import trimesh
    scene = trimesh.Scene()
    for k, (V, F, c) in enumerate(layers):
        m = trimesh.Trimesh(np.asarray(V, np.float32), F, process=False)
        m.visual.face_colors = np.r_[np.array(c) * 255, 255].astype(np.uint8)
        scene.add_geometry(m, node_name=f'part{k}')
    path.write_bytes(scene.export(file_type='glb'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(r):
    import json
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return dict(files=[], glb=[], note='renders: not run (matplotlib missing)')
    sh, base = r.sh, r.ctx.base
    topo = posing.topology(sh, base)
    out_dir = r.out / 'renders'
    gdir = r.out / 'glb'
    out_dir.mkdir(parents=True, exist_ok=True)
    gdir.mkdir(parents=True, exist_ok=True)
    pj = json.loads((r.out / 'poses.json').read_text(encoding='utf-8'))
    pack = np.load(r.out / 'fit' / 'poses_body.npz')
    files, glbs = [], []

    def body_from_pack(e):
        d = {'bone': {}, 'set': {}}
        for k in pack.files:
            pe, kind, name = k.split('|')
            if pe == e:
                d[kind][name] = pack[k].astype(float)
        return d

    jobs = []
    for e in ('catch', 'legs_flat', 'trunk_open', 'finish', 'mid_recovery'):
        lay = layers_of(sh, body_from_pack(e), topo, erg_parts(pj['erg'], pj['poses'][e]))
        jobs.append((e, lay, f'{e.replace("_", " ")} (modelled pose; Engstrom 2023 targets)'))
        glb(gdir / f'{e}.glb', lay)
        glbs.append(dict(file=f'glb/{e}.glb', bytes=(gdir / f'{e}.glb').stat().st_size, sha256=sha(gdir / f'{e}.glb')))
    for i, nm in ((0, 'squat_S0'), (40, 'squat_S1')):
        b, _ = posing.squat_body(sh, base, topo, i)
        d = {'bone': {g: v[0] for g, v in b.bones.items()}, 'set': {k: v[0] for k, v in b.sets.items()}}
        jobs.append((nm, layers_of(sh, d, topo), f'squat reference, sample {i} (renderer check)'))
    sk = r.out / 'fit' / 'skin_rigid.npz'
    for name in ('warped', 'rigid'):
        p = r.out / 'fit' / f'skin_{name}.npz'
        if p.is_file():
            sk = p
            break
    if sk.is_file():
        z = np.load(sk)
        V, F = z['V'].astype(float), z['F'].astype(np.int64)
        jobs.append(('skin_rest', [(V, F, COL['skin']), (*mirrored(V, F), COL['skin'])],
                     f'BodyParts3D 4.0 skin FJ2810, right half decimated ({len(F)} triangles) and mirrored, rest'))
    for e, lay, title in jobs:
        for v in VIEWS:
            p = out_dir / f'{e}_{v}.png'
            draw(p, lay, v, title)
            files.append(dict(file=f'renders/{e}_{v}.png', pose=e, view=v, sha256=sha(p), bytes=p.stat().st_size))
            r.log('render', p.name)
    return dict(files=files, glb=glbs, note='1600×1000 px, orthographic; left side mirrored from the right.')
