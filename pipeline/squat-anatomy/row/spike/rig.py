"""Q2: each of the 54 muscle-path curves as a blend over up to three bone frames, fitted on the squat's even
samples and judged on the odd ones (through the curveskin port).

Per control point: P(i) ≈ Σ_f w_f (R_f(i) X_f + p_f(i)), w ≥ 0, Σw = 1 (alternating NNLS / least squares);
orientation = the normalised blend of q_f(i) ⊗ R_f. The shipped curves and frames3 both already carry the δ
re-balance, so the rig is fitted post-δ to post-δ and absorbs it.
"""
import itertools
from dataclasses import dataclass

import numpy as np
from scipy.optimize import nnls
from scipy.spatial.transform import Rotation as Rot

from row.spike import curveskin as cs

PARENT = {'femur_r': 'pelvis_rest', 'tibia_r': 'femur_r', 'talus_r': 'tibia_r', 'calcn_r': 'talus_r',
          'toes_r': 'calcn_r', 'patella_r': 'femur_r', 'L5': 'pelvis_rest', 'L4': 'L5', 'L3': 'L4', 'L2': 'L3',
          'L1': 'L2', 'thorax': 'L1'}
SIG_FLOOR = 0.82
EVEN = np.arange(0, 41, 2)
ODD = np.arange(1, 41, 2)


@dataclass(frozen=True, eq=False)
class CurveRig:
    frames: tuple
    W: np.ndarray      # (n, F)
    X: np.ndarray      # (n, F, 3) local positions
    R: np.ndarray      # (n, F, 4) local quaternions, xyzw
    sig0: float
    k: float
    L0: float
    train_rms: float


def chain(name):
    out = [name]
    while out[-1] in PARENT:
        out.append(PARENT[out[-1]])
    return out


def tree_path(a, b):
    ca, cb = chain(a), chain(b)
    common = next(x for x in ca if x in cb)
    return ca[:ca.index(common) + 1] + cb[:cb.index(common)][::-1]


def candidates(a, b, T):
    """Frames on the tree path between a and b, plus the patella when the path crosses the knee; frames identical
    to another over every sample collapse to one (the end named in curve_ends wins)."""
    p = tree_path(a, b)
    if 'femur_r' in p and 'tibia_r' in p:
        p = p + ['patella_r']
    out = []
    for f in p:
        dup = next((g for g in out if np.array_equal(T[g], T[f])), None)
        if dup is None:
            out.append(f)
        elif f in (a, b):
            out[out.index(dup)] = f
    return out


def frame_stack(sh):
    """frame name -> (41, 4, 4), frames3 for the 11 frames, the static foot frames tiled."""
    from row.spike.squatdata import mat
    F = sh.frames3
    T = {n: np.stack([mat(F[i, j, :3], F[i, j, 3:]) for i in range(sh.ns)]) for j, n in enumerate(sh.fn)}
    for k in ('calcn_r', 'toes_r'):
        T[k] = np.repeat(sh.static[k][None], sh.ns, 0)
    return T


def world_end(sh, P0, T):
    """A 'world' curve end belongs to the calcaneus or the toes: whichever bone's S = 0 vertices are nearer."""
    d = {}
    for b in ('calcn_r', 'toes_r'):
        V = sh.bone(b)[0]
        W = V @ T[b][0, :3, :3].T + T[b][0, :3, 3]
        d[b] = np.linalg.norm(W - P0, axis=1).min()
    return min(d, key=d.get)


def curve_ends(sh, ci, P, T):
    a, b = [str(x) for x in sh.ends[ci]]
    if a == 'world':
        a = world_end(sh, P[0, 0], T)
    if b == 'world':
        b = world_end(sh, P[0, -1], T)
    return a, b


def _quat(M):
    return Rot.from_matrix(M[..., :3, :3]).as_quat()


def fit_points(P, Q, Ts, train, iters=10, tol=1e-7):
    """P (41, n, 3), Q (41, n, 4); Ts (F, 41, 4, 4). Returns W, X, R and the training point RMS (m)."""
    Fn = len(Ts)
    n = P.shape[1]
    Tt = Ts[:, train]
    Rf = Tt[:, :, :3, :3]              # (F, m, 3, 3)
    pf = Tt[:, :, :3, 3]               # (F, m, 3)
    W = np.zeros((n, Fn))
    X = np.zeros((n, Fn, 3))
    R = np.zeros((n, Fn, 4))
    m = len(train)
    for j in range(n):
        y = P[train, j]                                            # (m, 3)
        Xj = np.einsum('fab,fb->fa', np.transpose(Ts[:, 0, :3, :3], (0, 2, 1)), P[0, j] - Ts[:, 0, :3, 3])
        prev = np.inf
        w = np.full(Fn, 1 / Fn)
        for _ in range(iters):
            cols = np.einsum('fmab,fb->fma', Rf, Xj) + pf           # (F, m, 3)
            A = np.vstack([cols.reshape(Fn, -1).T, 10 * np.ones((1, Fn)), 1e-4 * np.eye(Fn)])
            b = np.r_[y.reshape(-1), 10, np.zeros(Fn)]
            w, _ = nnls(A, b)
            w = w / w.sum()
            # X by least squares, Tikhonov 1e-8 toward the current X
            B = np.einsum('f,fmab->mafb', w, Rf).reshape(3 * m, 3 * Fn)
            rhs = (y - np.einsum('f,fma->ma', w, pf)).reshape(-1)
            lam = 1e-4  # sqrt(1e-8)
            Xn, *_ = np.linalg.lstsq(np.vstack([B, lam * np.eye(3 * Fn)]), np.r_[rhs, lam * Xj.reshape(-1)],
                                     rcond=None)
            Xj = Xn.reshape(Fn, 3)
            pred = np.einsum('f,fma->ma', w, np.einsum('fmab,fb->fma', Rf, Xj) + pf)
            rms = np.sqrt(((pred - y) ** 2).sum(1).mean())
            if prev - rms < tol:
                break
            prev = rms
        W[j], X[j] = w, Xj
        # local quaternions: hemisphere-aligned mean of q_f(i)⁻¹ ⊗ Q(i)
        for f in range(Fn):
            loc = (Rot.from_matrix(Rf[f]).inv() * Rot.from_quat(Q[train, j])).as_quat()
            loc *= np.sign(loc @ loc[0])[:, None]
            mq = loc.mean(0)
            R[j, f] = mq / np.linalg.norm(mq)
    pred = eval_points(W, X, R, Ts[:, train])[0]
    rms = float(np.sqrt(((pred - P[train]) ** 2).sum(-1).mean()))
    return W, X, R, rms


def eval_points(W, X, R, Ts):
    """Ts (F, m, 4, 4) -> P (m, n, 3), Q (m, n, 4)."""
    Pf = np.einsum('fmab,nfb->mnfa', Ts[:, :, :3, :3], X) + np.transpose(Ts[:, :, None, :3, 3], (1, 2, 0, 3))
    P = np.einsum('nf,mnfa->mna', W, Pf)
    qf = Rot.from_matrix(Ts[..., :3, :3].reshape(-1, 3, 3)).as_quat().reshape(Ts.shape[0], Ts.shape[1], 4)
    m, n, Fn = Ts.shape[1], W.shape[0], W.shape[1]
    terms = np.zeros((m, n, Fn, 4))
    for f in range(Fn):
        a = Rot.from_quat(np.repeat(qf[f], n, 0))
        b = Rot.from_quat(np.tile(R[:, f], (m, 1)))
        terms[:, :, f] = (a * b).as_quat().reshape(m, n, 4)
    big = np.argmax(W, 1)
    ref = terms[:, np.arange(n), big]                                   # (m, n, 4)
    s = np.sign(np.einsum('mnfq,mnq->mnf', terms, ref))
    s[s == 0] = 1
    Q = np.einsum('nf,mnf,mnfq->mnq', W, s, terms)
    return P, Q / np.linalg.norm(Q, axis=-1, keepdims=True)


def eval_curve_rig(rig, Tpose):
    """Tpose: frame name -> 4x4. Returns P (n, 3), Q (n, 4)."""
    Ts = np.stack([Tpose[f] for f in rig.frames])[:, None]
    P, Q = eval_points(rig.W, rig.X, rig.R, Ts)
    return P[0], Q[0]


def tangent_align(P, Q):
    """Variant B: rotate each Q minimally so its local x follows the rig-point tangent (central differences)."""
    t = np.gradient(P, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    x = Rot.from_quat(Q).apply([1.0, 0, 0])
    ax = np.cross(x, t)
    s = np.linalg.norm(ax, axis=1)
    c = np.einsum('ij,ij->i', x, t)
    rvec = np.where(s[:, None] > 1e-12, ax / np.maximum(s, 1e-300)[:, None], 0) * np.arctan2(s, c)[:, None]
    return (Rot.from_rotvec(rvec) * Rot.from_quat(Q)).as_quat()


def poly_len(P):
    return np.linalg.norm(np.diff(P, axis=-2), axis=-1).sum(-1)


def sig_rule(L, L0, sig0, k):
    return np.maximum(SIG_FLOOR, sig0 * (np.asarray(L) / L0) ** (-k))


def fit_sig(L, sig, train):
    """k by least squares on the logs over training samples where the shipped sig is above the floor."""
    use = [i for i in train if sig[i] > SIG_FLOOR + 1e-4 and i > 0]
    x = np.log(L[use] / L[0])
    y = np.log(sig[use] / sig[0])
    k = float(-(x @ y) / (x @ x)) if len(use) and (x @ x) > 0 else 0.0
    return float(sig[0]), k


def fit_curve(sh, ci, T, train=EVEN, max_frames=3):
    P, Q = sh.curve(ci)
    a, b = curve_ends(sh, ci, P, T)
    cand = candidates(a, b, T)
    sub, W, X, R, rms = select_frames(P, Q, T, a, b, cand, train, max_frames)
    L = poly_len(P)
    sig0, k = fit_sig(L, sh.sig[ci], train)
    return CurveRig(frames=sub, W=W, X=X, R=R, sig0=sig0, k=k, L0=float(L[0]), train_rms=rms), (a, b), cand


def select_frames(P, Q, T, a, b, cand, train=EVEN, max_frames=3):
    """Among subsets of up to max_frames candidates holding both ends, the lowest training point RMS."""
    fits = []
    for r in range(1, max_frames + 1):
        for sub in itertools.combinations(sorted(cand), r):
            if a in sub and b in sub:
                fits.append((sub, *fit_points(P, Q, np.stack([T[f] for f in sub]), train)))
    lo = min(f[4] for f in fits)
    # ties within 1e-6 m: the smaller subset, then the lexicographic order of frame names
    return min((f for f in fits if f[4] <= lo + 1e-6), key=lambda f: (len(f[0]), f[0]))


def rig_curves_at(rigs, Tpose, variant='A'):
    """Every curve's (P, Q, sig) at a pose, for the curveskin port."""
    out = []
    for rig in rigs:
        P, Q = eval_curve_rig(rig, Tpose)
        if variant == 'B':
            Q = tangent_align(P, Q)
        out.append((P, Q, float(sig_rule(poly_len(P), rig.L0, rig.sig0, rig.k))))
    return out


def lengths(curves_P, cm, n_s):
    """lengths3: per muscle, the cm-weighted mean of its curves' polyline lengths, absolute (m), (n_s,) each."""
    import collections
    CL = np.array([poly_len(P) for P in curves_P])      # (n_curves, n_s)
    W = collections.defaultdict(collections.Counter)
    w = cm['w'] / 255.
    for m, a_, b_, ww in zip(cm['mid'], cm['c1'], cm['c2'], w):
        W[int(m)][int(a_)] += ww
        W[int(m)][int(b_)] += 1 - ww
    return {m: sum(v * CL[c] for c, v in cnt.items()) / sum(cnt.values()) for m, cnt in W.items()}


def q2(sh, rigs, T, test, train_note=''):
    """Q2 metrics on the test samples: points, orientation, sig, re-skinned cm (variants A and B), lengths."""
    cm = cs.cm_arrays(sh)
    lq = sh.meta['LQ']
    per = []
    allp = []
    Prig_all = []
    for ci, rig in enumerate(rigs):
        P, Q = sh.curve(ci)
        Ts = np.stack([T[f] for f in rig.frames])
        Pr, Qr = eval_points(rig.W, rig.X, rig.R, Ts)          # all 41 samples
        Prig_all.append(Pr)
        e = np.linalg.norm(Pr[test] - P[test], axis=-1) * 1e3
        oe = np.degrees(2 * np.arccos(np.clip(np.abs(np.einsum('mnq,mnq->mn', Qr[test], Q[test])), 0, 1)))
        sg = sig_rule(poly_len(Pr[test]), rig.L0, rig.sig0, rig.k)
        allp.append(e.reshape(-1))
        per.append(dict(curve=ci, frames=list(rig.frames), n=int(P.shape[1]), point_rms=float(np.sqrt((e ** 2).mean())),
                        point_max=float(e.max()), orient_rms=float(np.sqrt((oe ** 2).mean())),
                        orient_p99=float(np.percentile(oe, 99)), orient_max=float(oe.max()), k=rig.k,
                        sig_max_err=float(np.abs(sg - sh.sig[ci][test]).max()),
                        sig_err_shipped_L=float(np.abs(sig_rule(poly_len(P[test]), rig.L0, rig.sig0, rig.k)
                                                       - sh.sig[ci][test]).max()),
                        delta_rotated=bool(np.any(np.asarray(sh.alpha[ci]) > 0)), train_rms=rig.train_rms * 1e3))
    allp = np.concatenate(allp)
    vert = {}
    for var in ('A', 'B'):
        d = []
        for i in test:
            Ti = {f: T[f][i] for f in T}
            got = cs.skin_curve_set(rig_curves_at(rigs, Ti, var), sh.cv, cm, lq)
            ref = cs.skin_curve_set(cs.curves_at(sh, i, i, 0.0), sh.cv, cm, lq)
            d.append(np.linalg.norm(got - ref, axis=1) * 1e3)
        d = np.concatenate(d)
        vert[var] = dict(p99=float(np.percentile(d, 99)), max=float(d.max()), mean=float(d.mean()))
    # lengths: rig curves vs mlen3, and the floor (shipped quantised curves vs mlen3)
    ship_P = [sh.curve(ci)[0] for ci in range(len(rigs))]
    ML_rig = lengths(Prig_all, cm, sh.ns)
    ML_ship = lengths(ship_P, cm, sh.ns)
    mus = []
    for m in sorted(sh.mlen):
        ref = np.asarray(sh.mlen[m], float)
        pr = 100 * ML_rig[m] / ML_rig[m][0]
        ps = 100 * ML_ship[m] / ML_ship[m][0]
        mus.append(dict(muscle=int(m), name=sh.meta['muscles'][m]['name'],
                        rel=float(np.abs(pr[test] / ref[test] - 1).max() * 100),
                        abs_mm=float(np.abs(ML_rig[m][test] - ML_ship[m][test]).max() * 1e3),
                        floor=float(np.abs(ps[test] / ref[test] - 1).max() * 100)))
    return dict(curves=per, point_rms=float(np.sqrt((allp ** 2).mean())), point_max=float(allp.max()),
                vertex=vert, length_max=max(r['rel'] for r in mus), length_floor=max(r['floor'] for r in mus),
                muscles=mus, sig_max=max(r['sig_max_err'] for r in per), test=[int(i) for i in test], note=train_note)


def to_npz(rigs):
    out = {}
    for ci, r in enumerate(rigs):
        out[f'c{ci}_frames'] = np.array(r.frames)
        out[f'c{ci}_W'] = r.W
        out[f'c{ci}_X'] = r.X
        out[f'c{ci}_R'] = r.R
        out[f'c{ci}_sig'] = np.array([r.sig0, r.k, r.L0])
    return out
