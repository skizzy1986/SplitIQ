"""Q3a: shippable top-4 dual-quaternion weights for the upper body, judged against the squat's own upper3 output.

st: the 21-influence st_W cut to its 4 largest weights per vertex. lb: upper3's proximity weights, smoothed, cut
to 4. The rebuilt deltoid and pectoralis parts are re-decimated exactly as upper3 does and their 2-frame weight w
recovered per vertex (grid, then golden-section refinement).
"""
import ast
import inspect
from dataclasses import dataclass

import fast_simplification
import numpy as np
import trimesh
from scipy.spatial import cKDTree

from squat.geom import inv, tpts
from squat.model.dqs import dqs
from squat.model.skin import adjacency, smooth
from squat.stages import upper3

NEAR_BAR = 0.0006
WRAP, WRAP_FROM = 'Pectoralis major (abdominal part)', 'Pectoralis major (sternocostal part)'


def reb_parts():
    """upper3's REB table (name -> (FMA id, origin group, kind)), read from its source without executing it."""
    tree = ast.parse(inspect.getsource(upper3))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == 'REB' for t in node.targets):
            return ast.literal_eval(node.value)
    raise LookupError('REB not found in squat/stages/upper3.py')


def top4(W):
    """Keep the 4 largest weights per row, renormalised; also the dropped mass per row."""
    if not len(W):
        return W.copy(), np.zeros(0), np.zeros(0, int)
    idx = np.argsort(-W, axis=1, kind='stable')[:, :4]     # stable: ties keep the group order, run to run
    out = np.zeros_like(W)
    rows = np.arange(len(W))[:, None]
    out[rows, idx] = W[rows, idx]
    kept = out.sum(1)
    return out / kept[:, None], 1 - kept / W.sum(1), (W > 0).sum(1)


@dataclass(frozen=True, eq=False)
class UpperRig:
    keep: np.ndarray        # base st vertices that are not rebuilt parts
    S_base: np.ndarray      # base st rest positions (thorax rest space)
    W4: np.ndarray          # (n_keep, 21)
    L_base: np.ndarray
    WL4: np.ndarray
    parts: list             # (name, muscle id, origin group, V rest (model), F, w)
    gk: list


def mt(C, tcur, tg):
    return {'thx': np.eye(4), 'cla': C['cla'] @ tcur[38] @ inv(tg), 'sca': C['sca'] @ tcur[37] @ inv(tg),
            'hum': C['hum'] @ tcur[0] @ inv(tg)}


def _recover_w(V, target, M0, M1):
    """Per-vertex w in [0, 1] minimising |dqs(v, [1-w, w], [M0, M1]) - target|: grid 0.002, then golden."""
    grid = np.linspace(0, 1, 501)
    err = np.stack([np.linalg.norm(dqs(V, np.c_[np.full(len(V), 1 - w), np.full(len(V), w)], [M0, M1]) - target,
                                   axis=1) for w in grid], 1)
    w = grid[np.argmin(err, 1)]
    lo, hi = np.clip(w - 0.002, 0, 1), np.clip(w + 0.002, 0, 1)
    g = (np.sqrt(5) - 1) / 2

    def f(ww):
        return np.linalg.norm(dqs(V, np.c_[1 - ww, ww], [M0, M1]) - target, axis=1)
    for _ in range(30):
        a = hi - g * (hi - lo)
        b = lo + g * (hi - lo)
        left = f(a) < f(b)
        hi = np.where(left, b, hi)
        lo = np.where(left, lo, a)
    w = (lo + hi) / 2
    return w, f(w)


def compute(ctx, x4, st_W, u3, sh):
    """Q3a metrics and the UpperRig used to pose the upper body."""
    base, arm, skin, stl = ctx.base, ctx.arm, ctx.skin, ctx.stl
    gk = skin.gk
    C = arm.transforms(x4)
    for k in gk:
        C.setdefault(k, np.eye(4))
    Ms = [C[k] for k in gk]
    man, ARR, META = base.man, base.arr, base.meta
    st = man['st_meta']
    S = ARR['st_pos'].astype(float) * st['s'] + np.array(st['c'])
    SM = ARR['st_mid']
    MN = [m['name'] for m in META['muscles']]
    reb = reb_parts()
    rebuilt = [MN.index(n) for n in reb]
    keep = ~np.isin(SM, rebuilt)
    W4, dropped, nnz = top4(st_W)
    S4 = dqs(S[keep], W4[keep], Ms)
    U = u3['S']
    nk = int(keep.sum())
    bar = np.array(sh.meta['bar']['c'][:2])
    r = sh.meta['bar']['r']
    pushed = np.hypot(*(U[:, :2] - bar).T) < r + NEAR_BAR
    ship = sh.deq('st', sh.man['st_meta'])
    rows = {}

    def stat(d, n, extra=None):
        return dict(vertices=int(n), rms=float(np.sqrt((d ** 2).mean())) if len(d) else 0.0,
                    max=float(d.max()) if len(d) else 0.0, **(extra or {}))
    d_keep = np.linalg.norm(S4 - U[:nk], axis=1) * 1e3
    pk = pushed[:nk]
    wst = dict(rows_gt4=int((nnz[keep] > 4).sum()), dropped_max=float(dropped[keep].max()),
               dropped_mean=float(dropped[keep].mean()))
    rows['st kept'] = stat(d_keep[~pk], (~pk).sum(), {**wst, 'thresholded': True})
    rows['st bar_push: top-4 vs upper3'] = stat(d_keep[pk], pk.sum())
    dsh = np.linalg.norm(ship - U, axis=1) * 1e3
    rows['st bar_push: shipped vs upper3'] = stat(dsh[pushed], pushed.sum())
    rows['quantisation floor (shipped vs upper3)'] = stat(dsh[~pushed], (~pushed).sum())
    # rebuilt deltoid and pectoralis parts
    MT = mt(C, arm.Tcur, base.tg)
    parts = []
    off = nk
    for name, (fid, og, kind) in reb.items():
        mi = MN.index(name)
        n_old = int((SM == mi).sum())
        n_u3 = int((u3['SM'] == mi).sum())
        tm = stl.mesh(fid)
        V0 = tpts(base.tg, np.asarray(tm.vertices))
        F0 = np.asarray(tm.faces)
        red = max(0.0, 1 - int(n_old * 1.5) / len(V0))
        V, F = fast_simplification.simplify(V0.astype(np.float32), F0.astype(np.int32), target_reduction=red)
        V = V.astype(float)
        F = F.astype(np.int64)
        tgt = U[off:off + n_u3]
        off += n_u3
        if len(V) != n_u3:
            rows[name] = dict(vertices=n_u3, status='n/a: not reproducible', rms=None, max=None)
            continue
        w, res = _recover_w(V, tgt, MT[og], MT['hum'])
        note = ''
        if name == WRAP and parts and parts[-1][0] == WRAP_FROM:
            # upper3 wraps this slip over the sternocostal part (8-NN displacement) and tucks it; follow the wrap
            Vsc = parts[-1][3]
            dd, ii = cKDTree(Vsc).query(V, k=8)
            ww = 1 / (dd + 1e-4)
            ww /= ww.sum(1, keepdims=True)
            w = (ww, ii)
            sc_new = dqs(Vsc, np.c_[1 - parts[-1][5], parts[-1][5]], [MT[parts[-1][2]], MT['hum']])
            res = np.linalg.norm(wrap_tuck(V, w, sc_new - Vsc, sc_new, parts[-1][4]) - tgt, axis=1)
            note = 'follows the sternocostal part: wrap + tuck as upper3'
        rows[name] = stat(res * 1e3, len(V), {'note': note})
        parts.append((name, mi, og, V, F, w))
    # lb: proximity weights smoothed 4x (as upper3), then top-4
    lbm = META['lbs']
    L = ARR['lb_pos'].astype(float) * lbm['s'] + np.array(lbm['c'])
    LI = ARR['lb_idx'].reshape(-1, 3).astype(np.int64)
    WL = skin.prox_weights(L)
    Al, dl = adjacency(LI, len(L))
    WL = smooth(WL, Al, dl, 4)
    WL /= WL.sum(1, keepdims=True)
    WL4, dl4, nl = top4(WL)
    dlb = np.linalg.norm(dqs(L, WL4, Ms) - u3['L'], axis=1) * 1e3
    rows['lb'] = stat(dlb, len(L), dict(rows_gt4=int((nl > 4).sum()), dropped_max=float(dl4.max()),
                                        dropped_mean=float(dl4.mean()), thresholded=True))
    return rows, UpperRig(keep=keep, S_base=S, W4=W4[keep], L_base=L, WL4=WL4, parts=parts, gk=gk)


def wrap_tuck(V, w, disp, sc_new, sc_f):
    """upper3's abdominal slip: follow the sternocostal surface displacement (8-NN), then tuck any vertex lying
    on top of the sternocostal fibres (within 2 cm) to 4 mm beneath them."""
    ww, ii = w
    Vn = V + (ww[:, :, None] * disp[ii]).sum(1)
    tsc = trimesh.Trimesh(sc_new, sc_f, process=False)
    cp, dist, fi = trimesh.proximity.closest_point(tsc, Vn)
    nrm = tsc.face_normals[fi]
    tuck = (((Vn - cp) * nrm).sum(1) > 0) & (dist < 0.02)
    Vn[tuck] = cp[tuck] - nrm[tuck] * 0.004
    return Vn


def pose_upper(urig, C, MT):
    """st (kept + rebuilt parts) and lb at arm transforms C, in thorax rest space (before any trunk frame)."""
    Ms = [C[k] for k in urig.gk]
    st = [dqs(urig.S_base[urig.keep], urig.W4, Ms)]
    for name, mi, og, V, F, w in urig.parts:
        if isinstance(w, tuple):
            ww, ii = w
            sc = [p for p in urig.parts if p[0] == WRAP_FROM][0]
            st.append(wrap_tuck(V, w, st[-1] - sc[3], st[-1], sc[4]))  # the sternocostal part, posed just before
        else:
            st.append(dqs(V, np.c_[1 - w, w], [MT[og], MT['hum']]))
    return np.vstack(st), dqs(urig.L_base, urig.WL4, Ms)
