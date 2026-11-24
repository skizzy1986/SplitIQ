"""Q4: does the BodyParts3D 4.0 skin (FJ2810, CC BY 4.0) fit our skeleton, and what does it cost at budget?

Outer shell -> hole fill -> T_global into model rest space -> per-bone 3.0 <-> 4.0 registration (rigid check; a
thin-plate warp if it fails) -> right half at z = 0 -> 12,000-triangle decimation -> clearance to bones and
muscles in rest space. OBJs are untrusted data: read_obj_vf reads v and f lines only (no trimesh.load: material
lookups on untrusted files are not verified).
"""
import fast_simplification
import numpy as np
import trimesh
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot

from row import inputs
from row.spike import collide
from row.spike import thresholds as th
from row.spike import rig as rigmod
from squat.geom import inv, tpts

BUDGET, BUDGET_TOL = th.SKIN_TRIS, th.SKIN_TOL_PCT / 100
ARM_PAIRS = {'humerus': 'FMA23130', 'radius': 'FMA23464', 'ulna': 'FMA23467', 'metacarpal3': 'FMA24468',
             'capitate': 'FMA24446', 'lunate': 'FMA24437', 'clavicle': 'FMA13322', 'scapula': 'FMA13395'}
TRUNK_PAIRS = {'hip_bone': 'pelvisR', 'sacrum': 'pelvis'}
LEG_FRAMES = {'femur_r': ('femur',), 'tibia_r': ('tibia', 'fibula'), 'patella_r': ('patella',),
              'talus_r': ('talus',), 'calcn_r': ('calcaneus',)}
RIGID_T, RIGID_R = 2.0, 1.0      # mm, degrees


def read_obj_vf(path):
    """(V float64 (n, 3), F int64 (m, 3)) from the v and f lines of an OBJ; polygons fan-triangulated, 1-based
    and 'a/b/c' indices accepted, everything else ignored."""
    V, F = [], []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if line.startswith('v '):
                V.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('f '):
                idx = [int(tok.split('/')[0]) for tok in line.split()[1:]]
                idx = [i - 1 if i > 0 else len(V) + i for i in idx]
                for k in range(1, len(idx) - 1):
                    F.append([idx[0], idx[k], idx[k + 1]])
    return np.array(V, float).reshape(-1, 3), np.array(F, np.int64).reshape(-1, 3)


def obj_header(path):
    """The '# key : value' header lines (Concept ID, English name, licence text) as a dict."""
    out = {}
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if not line.startswith('#'):
                break
            body = line[1:].strip()
            if ' : ' in body:
                k, v = body.split(' : ', 1)
                out[k.strip()] = v.strip()
            elif 'license' in body.lower():
                out['licence_line'] = body
    return out


def open_edges(F):
    e = np.sort(np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return int((c == 1).sum())


def boundary_loops(F):
    """Directed boundary edges (as they appear in their face), chained into loops."""
    d = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    key = np.sort(d, axis=1)
    _, inv_, c = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    b = d[c[inv_] == 1]
    nxt = {}
    for a, z in b:
        nxt.setdefault(int(a), []).append(int(z))
    loops, seen = [], set()
    for a0, _ in b:
        a0 = int(a0)
        if a0 in seen:
            continue
        loop, a = [], a0
        while a not in seen and a in nxt:
            seen.add(a)
            loop.append(a)
            a = nxt[a].pop() if len(nxt[a]) > 1 else nxt[a][0]
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def fan_fill(V, F):
    """Close every boundary loop with a fan from its centroid, wound against the boundary edges."""
    V = [V]
    newF = [F]
    n = len(V[0])
    for loop in boundary_loops(F):
        c = V[0][loop].mean(0)
        V.append(c[None])
        k = len(loop)
        tri = np.array([[loop[(i + 1) % k], loop[i], n] for i in range(k)], np.int64)
        newF.append(tri)
        n += 1
    return np.vstack(V), np.vstack(newF)


def components(V, F):
    m = trimesh.Trimesh(V, F, process=False)
    out = []
    for c in m.split(only_watertight=False, repair=False):  # repair would call fill_holes (networkx)
        cf = c.triangles_center - c.vertices.mean(0)
        out.append(dict(mesh=c, faces=int(len(c.faces)), area=float(c.area), volume=float(c.volume),
                        outward=float(np.einsum('ij,ij->i', cf, c.face_normals).mean())))
    return out


def icp(src, tgt, T0, iters=40, trim=95):
    """squat/stages/regcur.py's trimmed ICP (scale fixed at T0's), plus the RMS of the final fit."""
    pts, tree = tgt
    T = T0.copy()
    s = np.cbrt(np.linalg.det(T[:3, :3]))
    for _ in range(iters):
        P = tpts(T, src)
        d, ii = tree.query(P)
        b = pts[ii]
        w = d <= np.percentile(d, trim)
        a, b = src[w], b[w]
        ma, mb = a.mean(0), b.mean(0)
        U, _, Vt = np.linalg.svd((b - mb).T @ (a - ma))
        D = np.diag([1, 1, np.sign(np.linalg.det(U @ Vt))])
        R = U @ D @ Vt
        T = np.eye(4)
        T[:3, :3] = s * R
        T[:3, 3] = mb - s * R @ ma
    d, ii = tree.query(tpts(T, src))
    w = d <= np.percentile(d, trim)
    a, b = tpts(T, src)[w], pts[ii][w]
    # Procrustes scale of the final correspondences (reported only)
    sc = np.sqrt(((b - b.mean(0)) ** 2).sum() / ((a - a.mean(0)) ** 2).sum())
    return T, float(np.sqrt((d ** 2).mean())), float(sc)


def target_of(V, F, n=20000, seed=1):
    m = trimesh.Trimesh(V, F, process=False)
    pts, _ = trimesh.sample.sample_surface(m, n, seed=seed)
    pts = np.vstack([pts, V])
    return pts, cKDTree(pts)


def register_bones(paths, obj_dir, sh, ctx):
    """4.0 OBJ (mm) -> 3.0 geometry (mm) per bone. Returns rows and the per-bone transforms + sample points."""
    tg = ctx.base.tg
    rows, fields = [], []
    pairs = []
    for name, fma in ARM_PAIRS.items():
        m = ctx.stl.mesh(fma)
        pairs.append((name, fma, np.asarray(m.vertices, float), np.asarray(m.faces)))
    for name, g in TRUNK_PAIRS.items():
        P, pid, Fc, bm = sh.bone(g)
        pairs.append((name, f'base:{g}', tpts(inv(tg), P), Fc))
    for name, fma, V3, F3 in pairs:
        fj = inputs.BONE_FJ[name]
        V4, F4 = read_obj_vf(obj_dir / f'{fj}.obj')
        hdr = obj_header(obj_dir / f'{fj}.obj')
        T, rms, sc = icp(V4, target_of(V3, F3), np.eye(4))
        c = V4.mean(0)
        t = np.linalg.norm(tpts(T, c[None])[0] - c)
        ang = float(np.degrees(np.linalg.norm(Rot.from_matrix(T[:3, :3]).as_rotvec())))
        rows.append(dict(bone=name, fma=fma if fma.startswith('FMA') else hdr.get('Concept ID', ''), fj=fj,
                         fj_fma=hdr.get('Concept ID', ''), t=float(t), rot=ang, scale=sc, icp_rms=rms,
                         three0=fma))
        S = trimesh.sample.sample_surface(trimesh.Trimesh(V4, F4, process=False), 200, seed=2)[0]
        fields.append((S, tpts(T, S)))
    return rows, fields


def warp_fn(fields):
    src = np.vstack([a for a, _ in fields])
    dst = np.vstack([b for _, b in fields])
    rbf = RBFInterpolator(src, dst - src, kernel='thin_plate_spline', smoothing=1.0)
    return lambda X: X + rbf(X)


def half_cut(V, F):
    """Keep z >= 0: triangles clipped at the plane, seam vertices shared between neighbours, winding kept.
    (trimesh.intersections.slice_mesh_plane imports shapely, which the pinned environment does not install.)"""
    keep = V[:, 2] >= 0
    # each crossing edge gets one seam vertex, keyed by the sorted edge, so neighbours share it and the half
    # has a single clean boundary on z = 0 (the mirror seam)
    newV = [V]
    cut = {}

    def x(a, b):
        k = (min(a, b), max(a, b))
        if k not in cut:
            t = V[a, 2] / (V[a, 2] - V[b, 2])
            p = V[a] + t * (V[b] - V[a])
            p[2] = 0.0
            cut[k] = len(V) + len(cut)
            newV.append(p[None])
        return cut[k]
    out = []
    for f in F:
        k = keep[f]
        n = int(k.sum())
        if n == 3:
            out.append(f)
        elif n == 0:
            continue
        else:
            r = int(np.argmax(k)) if n == 1 else int(np.argmin(k))
            a, b, c = f[r], f[(r + 1) % 3], f[(r + 2) % 3]
            if n == 1:                       # a kept
                out.append([a, x(a, b), x(a, c)])
            else:                            # a dropped, b and c kept
                ab, ca = x(a, b), x(c, a)
                out += [[ab, b, c], [ab, c, ca]]
    Vn = np.vstack(newV)
    Fn = np.array(out, np.int64)
    used = np.unique(Fn)
    remap = -np.ones(len(Vn), np.int64)
    remap[used] = np.arange(len(used))
    return Vn[used], remap[Fn]


def off_seam(V, F, tol=5e-4):
    """Open edges not lying on the z = 0 seam (the only boundary the mirrored half may have)."""
    e = np.sort(np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    u, c = np.unique(e, axis=0, return_counts=True)
    b = u[c == 1]
    return int((np.abs(V[b][:, :, 2]).max(1) > tol).sum())


def half_and_decimate(Vm, F):
    m = trimesh.Trimesh(Vm, F, process=False)
    half = trimesh.Trimesh(*half_cut(np.asarray(m.vertices), np.asarray(m.faces)), process=False)
    Vd, Fd = fast_simplification.simplify(np.asarray(half.vertices, float), np.asarray(half.faces, np.int32),
                                          target_count=BUDGET)
    dec = trimesh.Trimesh(np.asarray(Vd, float), np.asarray(Fd, np.int64), process=False)
    _, d1, _ = trimesh.proximity.closest_point(dec, np.asarray(half.vertices))
    _, d2, _ = trimesh.proximity.closest_point(half, np.asarray(dec.vertices))
    return half, dec, dict(tris=int(len(dec.faces)), verts=int(len(dec.vertices)),
                           half_tris=int(len(half.faces)), half_open=open_edges(np.asarray(half.faces)),
                           dec_open=open_edges(np.asarray(dec.faces)),
                           dec_open_off_seam=off_seam(np.asarray(dec.vertices), np.asarray(dec.faces)),
                           hausdorff_max=float(max(d1.max(), d2.max()) * 1e3), hausdorff_mean=float(d1.mean() * 1e3),
                           in_budget=bool(abs(len(dec.faces) - BUDGET) <= BUDGET_TOL * BUDGET),
                           min_z=float(np.asarray(dec.vertices)[:, 2].min()))


def rest_surfaces(paths, obj_dir, sh, ctx, rigs, urig):
    """Bones and muscles in the trunk rest space (the space T_global maps BodyParts3D into)."""
    tg = ctx.base.tg
    base = ctx.base
    bones = {}
    # trunk bones as stored (thoraxR's arm parts are replaced by the T_global-mapped arm STLs)
    for g in ('pelvis', 'pelvisR', 'L1', 'L2', 'L3', 'L4', 'L5', 'thorax'):
        P, pid, Fc, _ = sh.bone(g)
        bones[g] = (P, Fc, pid)
    keep = ~np.isin(base.pidr, list(range(30)) + [37, 38])
    Ir = base.ir
    fk_ = np.all(keep[Ir], axis=1)
    remap = -np.ones(len(keep), np.int64)
    remap[keep] = np.arange(keep.sum())
    bones['thoraxR_trunk'] = (base.pr[keep], remap[Ir[fk_]], base.pidr[keep])
    for k, (name, fma) in enumerate(ARM_PAIRS.items()):
        m = ctx.stl.mesh(fma)
        bones[f'arm:{name}'] = (tpts(tg, np.asarray(m.vertices)), np.asarray(m.faces), np.zeros(len(m.vertices), int))
    # leg bones placed by ICP onto the T_global-mapped 4.0 leg OBJs
    T0p = inv(sh.T['pelvis_rest'][0])
    Tleg = {}
    for fr, names in LEG_FRAMES.items():
        g = fr
        P, pid, Fc, bm = sh.bone(g)
        tgt_V, tgt_F, off = [], [], 0
        for nm in names:
            V4, F4 = read_obj_vf(obj_dir / f'{inputs.BONE_FJ[nm]}.obj')
            tgt_V.append(tpts(tg, V4))
            tgt_F.append(F4 + off)
            off += len(V4)
        Tw = sh.static[fr] if fr in sh.static else sh.T[fr][0]
        # our calcn_r body carries the whole midfoot: register only its calcaneus to the 4.0 calcaneus
        src = P[pid == bm['names'].index('Calcaneus')] if fr == 'calcn_r' else P
        T, rms, _ = icp(src, target_of(np.vstack(tgt_V), np.vstack(tgt_F)), T0p @ Tw)
        Tleg[fr] = (T, rms)
        bones[f'leg:{fr}'] = (tpts(T, P), Fc, pid)
    Tc = Tleg['calcn_r'][0]
    Pt, pidt, Ft, _ = sh.bone('toes_r')
    Tt = Tc @ inv(sh.static['calcn_r']) @ sh.static['toes_r']
    bones['leg:toes_r'] = (tpts(Tt, Pt), Ft, pidt)
    # muscles: lb without the latissimus, sa, thorax-bound st, and cm by the rig at the rest leg frames (modelled)
    names = [m['name'] for m in sh.meta['muscles']]
    lat = names.index('Latissimus dorsi')
    lbm = base.meta['lbs']
    L = base.arr['lb_pos'].astype(float) * lbm['s'] + np.array(lbm['c'])
    LF = sh.arr['lb_idx'].reshape(-1, 3).astype(np.int64)
    lmid = sh.arr['lb_mid'].astype(int)
    sets = {}
    sets['lb (no latissimus)'] = _subset(L, LF, lmid, lmid != lat)
    sets['sa'] = (sh.deq('sa', sh.man['sa_meta']), sh.arr['sa_idx'].reshape(-1, 3).astype(np.int64),
                  sh.arr['sa_mid'].astype(int))
    thx = urig.W4[:, urig.gk.index('thx')] >= 0.99
    st_mid = base.arr['st_mid'].astype(int)[urig.keep]
    st_idx = base.arr['st_idx'].reshape(-1, 3).astype(np.int64)
    kmap = -np.ones(len(urig.keep), np.int64)
    kmap[urig.keep] = np.arange(urig.keep.sum())
    fk2 = np.all(urig.keep[st_idx], axis=1)
    sets['st (thorax-bound)'] = _subset(urig.S_base[urig.keep], kmap[st_idx[fk2]], st_mid, thx)
    Tpose = {n: np.eye(4) for n in ('pelvis_rest', 'L5', 'L4', 'L3', 'L2', 'L1', 'thorax')}
    Tpose.update({k: v[0] for k, v in Tleg.items()})
    Tpose['toes_r'] = Tt
    from row.spike import curveskin as cs
    cm = cs.skin_curve_set(rigmod.rig_curves_at(rigs, Tpose), sh.cv, cs.cm_arrays(sh), sh.meta['LQ'])
    sets['cm (rig at the rest leg frames, modelled)'] = (cm, sh.arr['cm_idx'].reshape(-1, 3).astype(np.int64),
                                                        sh.arr['cm_mid'].astype(int))
    return bones, sets, {k: float(v[1] * 1e3) for k, v in Tleg.items()}


def _subset(V, F, mid, mask):
    fm = np.all(mask[F], axis=1)
    remap = -np.ones(len(V), np.int64)
    remap[mask] = np.arange(mask.sum())
    return V[mask], remap[F[fm]], mid[mask]


def clearance(Vs, bones, sets, namer=lambda part: part):
    """Per surface set: skin vertices inside (count, %), where (the parts holding most of them) and the clearance
    distribution (mm)."""
    rows = {}
    alld = []
    parts_b = collide.bone_parts(bones)
    d_in, who = collide.depth(Vs, parts_b)
    dist = _surface_dist(Vs, [(V, F) for V, F, _ in bones.values()])
    rows['bones'] = _row(d_in, dist, 0.0, _where(d_in > 0, who, parts_b, namer))
    alld.append(dist)
    for k, (V, F, mid) in sets.items():
        parts = collide.bone_parts({k: (V, F, mid)})
        d_in, who = collide.depth(Vs, parts)
        dist = _surface_dist(Vs, [(V, F)])
        rows[k] = _row(d_in, dist, th.SKIN_MUSCLE_MM / 1e3, _where(d_in > th.SKIN_MUSCLE_MM / 1e3, who, parts, namer))
        alld.append(dist)
    d = np.min(np.stack(alld), 0)
    rows['nearest bone or muscle'] = dict(p50=float(np.median(d) * 1e3), p1=float(np.percentile(d, 1) * 1e3),
                                          min=float(d.min() * 1e3))
    return rows


def _where(mask, who, parts, namer, top=5):
    names = [namer(parts[w][0]) for w in who[mask]]
    out = {}
    for n in names:
        out[n] = out.get(n, 0) + 1
    return sorted(([n, c] for n, c in out.items()), key=lambda x: (-x[1], x[0]))[:top]


def _row(d_in, dist, tol, where):
    inside = d_in > tol
    return dict(inside=int(inside.sum()), inside_pct=float(100 * inside.mean()), min=float(dist.min() * 1e3),
                p1=float(np.percentile(dist, 1) * 1e3), p50=float(np.median(dist) * 1e3), tol_mm=tol * 1e3,
                where=where)


def part_namer(sh):
    """'group:pid' -> an anatomical name (bones by their part names, muscle sets by muscle)."""
    bones = sh.meta['bones']
    mus = [m['name'] for m in sh.meta['muscles']]

    def name(part):
        g, p = part.rsplit(':', 1)
        p = int(p)
        g = g.split(':', 1)[1] if g.startswith('leg:') else g
        if g.startswith('arm:'):
            return g[4:]
        if g == 'thoraxR_trunk':
            g = 'thoraxR'
        if g in bones:
            return bones[g]['names'][p]
        return mus[p] if p < len(mus) else part
    return name


def _surface_dist(X, meshes):
    pts = []
    for V, F in meshes:
        m = trimesh.Trimesh(V, F, process=False)
        n = int(min(200000, max(2000, m.area / 1e-6)))       # about one sample per mm²
        pts.append(np.vstack([trimesh.sample.sample_surface(m, n, seed=3)[0], V]))
    return cKDTree(np.vstack(pts)).query(X)[0]


def run(paths, root, sh, ctx, r, log=print):
    obj = root / 'obj'
    path = obj / f'{inputs.SKIN_FJ}.obj'
    hdr = obj_header(path)
    V, F = read_obj_vf(path)
    steps = [dict(step='read FJ2810.obj', tris=int(len(F)), verts=int(len(V)), comps=None, open=open_edges(F))]
    comps = components(V, F)
    steps[0]['comps'] = len(comps)
    outer = max((c for c in comps if c['outward'] > 0), key=lambda c: c['area'])
    om = outer['mesh']
    Vo, Fo = np.asarray(om.vertices, float), np.asarray(om.faces, np.int64)
    steps.append(dict(step='outer shell', tris=int(len(Fo)), verts=int(len(Vo)), comps=1, open=open_edges(Fo)))
    try:
        mm = trimesh.Trimesh(Vo, Fo, process=False)
        trimesh.repair.fill_holes(mm)
        tm_note = 'trimesh.repair.fill_holes'
        Vo, Fo = np.asarray(mm.vertices, float), np.asarray(mm.faces, np.int64)
    except Exception as e:  # fill_holes needs networkx, which the pinned environment does not install
        tm_note = f'trimesh.repair.fill_holes not run ({type(e).__name__}: networkx is not installed)'
    steps.append(dict(step=tm_note, tris=int(len(Fo)), verts=int(len(Vo)), comps=1, open=open_edges(Fo)))
    Vf, Ff = fan_fill(Vo, Fo)
    steps.append(dict(step='fan fill from loop centroids', tris=int(len(Ff)), verts=int(len(Vf)), comps=1,
                      open=open_edges(Ff)))
    tg = ctx.base.tg
    reg, fields = register_bones(paths, obj, sh, ctx)
    rigid = all(x['t'] <= RIGID_T and x['rot'] <= RIGID_R for x in reg)
    Vm = tpts(tg, Vf)
    variants = {'rigid': Vm}
    if not rigid:
        wf = warp_fn(fields)
        variants['warped'] = tpts(tg, wf(Vf))
    rigs = [f[0] for f in r.rigs[1]]
    _, urig = r.upper
    bones, sets, leg_rms = rest_surfaces(paths, obj, sh, ctx, rigs, urig)
    out = dict(steps=steps, components=[{k: v for k, v in c.items() if k != 'mesh'} for c in comps],
               header=hdr, registration=reg, rigid=rigid, leg_icp_rms=leg_rms, variants={})
    for name, Vv in variants.items():
        half, dec, info = half_and_decimate(Vv, Ff)
        rows = clearance(np.asarray(dec.vertices), bones, sets, part_namer(sh))
        out['variants'][name] = dict(decimate=info, clearance=rows, height=float(np.ptp(Vv[:, 1])))
        log('skin', name, info, rows['nearest bone or muscle'])
        out['variants'][name]['_mesh'] = dec
    for name, v in out['variants'].items():
        dec = v.pop('_mesh')
        np.savez_compressed(r.out / 'fit' / f'skin_{name}.npz', V=np.asarray(dec.vertices, np.float32),
                            F=np.asarray(dec.faces, np.int32))
    out['verdict'] = verdict(out)
    return out


def fits(v):
    c = v['clearance']
    d = v['decimate']
    bone_ok = c['bones']['inside_pct'] <= th.SKIN_BONE_PCT
    mus_ok = all(r['inside_pct'] <= th.SKIN_MUSCLE_PCT for k, r in c.items() if k not in ('bones', 'nearest bone or muscle'))
    med = c['nearest bone or muscle']['p50']
    return dict(bones=bone_ok, muscles=mus_ok, median=th.SKIN_MED_LO <= med <= th.SKIN_MED_HI,
                decimated=d['in_budget'] and d['hausdorff_max'] <= th.SKIN_H_MAX
                and d['hausdorff_mean'] <= th.SKIN_H_MEAN and d['dec_open_off_seam'] == 0)


def verdict(out):
    shell_ok = out['steps'][-1]['open'] == 0
    checks = {k: fits(v) for k, v in out['variants'].items()}
    ok = {k: shell_ok and all(c.values()) for k, c in checks.items()}
    if out['rigid'] and ok.get('rigid'):
        v = 'FITS (rigid)'
    elif ok.get('warped'):
        v = 'FITS AFTER WARP'
    else:
        v = 'DOES NOT FIT'
    used = 'rigid' if out['rigid'] or 'warped' not in out['variants'] else 'warped'
    return dict(verdict=v, checks=checks, shell_closed=shell_ok,
                tris=out['variants'][used]['decimate']['tris'])

