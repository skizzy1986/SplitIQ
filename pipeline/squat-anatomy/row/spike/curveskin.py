"""Python port of the runtime posing maths (web/src/anatomy/utils/{depth,curveSkin,lbs,frames,quat}.js).

The judge for every re-rig: re-skinned vertices are compared through this port, never through a shortcut.
Validated against web/src/anatomy/utils/__tests__/fixtures/squat-skinning-fixture.json (tests/row).
Quaternions are xyzw. Curves nlerp (across depth and along the curve); body frames slerp (three r128).
"""
import numpy as np

SPAN = 4000


def depth_index(s, ns):
    f = min(1.0, max(0.0, s)) * (ns - 1)
    i0 = min(ns - 2, int(np.floor(f)))
    return i0, i0 + 1, f - i0


def curves_at(sh, i0, i1, t):
    """Per-curve state (P (n,3), Q (n,4), sig) at depth (i0, i1, t), from the shipped int16 arrays."""
    out = []
    cvp = sh.arr['cv_pos']
    cvq = sh.arr['cv_quat']
    for ci, c in enumerate(sh.cv):
        n, o = c['n'], sh.offs[ci]
        a, b = o + i0 * n, o + i1 * n
        pa = cvp[a * 3:(a + n) * 3].astype(float).reshape(n, 3)
        pb = cvp[b * 3:(b + n) * 3].astype(float).reshape(n, 3)
        P = (pa + (pb - pa) * t) * 5e-5
        P[:, 1] += 0.8
        qa = cvq[a * 4:(a + n) * 4].astype(float).reshape(n, 4)
        qb = cvq[b * 4:(b + n) * 4].astype(float).reshape(n, 4)
        Q = qa + (qb - qa) * t
        Q /= np.linalg.norm(Q, axis=1, keepdims=True)
        sg = c['sig'][i0] + (c['sig'][i1] - c['sig'][i0]) * t
        out.append((P, Q, sg))
    return out


def qrot(q, v):
    """Rotate v (m,3) by unit quaternions q (m,4) xyzw, as evalBind writes it."""
    u = q[:, :3]
    t = 2 * np.cross(u, v)
    return v + q[:, 3:4] * t + np.cross(u, t)


def eval_bind(P, Q, sig, nseg, s, l, lq, trace=False):
    """Bindings on one curve: parameter s (m,), offsets l (m,3) int16 units."""
    n = len(P)
    u = np.asarray(s, float) / SPAN * nseg
    j = np.clip(np.floor(u).astype(int), 0, n - 2)
    f = (u - j)[:, None]
    p = P[j] + (P[j + 1] - P[j]) * f
    q = Q[j] + (Q[j + 1] - Q[j]) * f
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    v = np.asarray(l, float) * lq
    v[:, 1:] *= sig
    x = p + qrot(q, v)
    return (x, dict(u=u, j=j, frac=f[:, 0], point=p, quat=q, offset=v)) if trace else x


def _bind_all(curves, cv, c, s, l, lq):
    out = np.zeros((len(c), 3))
    for ci in np.unique(c):
        m = c == ci
        P, Q, sg = curves[ci]
        out[m] = eval_bind(P, Q, sg, cv[ci]['nseg'], s[m], l[m], lq)
    return out


def skin_curve_set(curves, cv, cm, lq):
    """Every curve-skinned vertex (world). curves: list of (P, Q, sig) per curve, shipped or re-rigged."""
    w = cm['w'].astype(float) / 255
    x1 = _bind_all(curves, cv, cm['c1'], cm['s1'], cm['l1'], lq)
    two = w < 0.999
    x = x1.copy()
    x2 = _bind_all(curves, cv, cm['c2'][two], cm['s2'][two], cm['l2'][two], lq)
    x[two] = x1[two] * w[two, None] + x2 * (1 - w[two, None])
    return x


def skin_curve_set_from(P, Q, sig, cv, cm, lq):
    """The entry point for rig output: P[c] (n,3), Q[c] (n,4), sig[c] float per curve."""
    return skin_curve_set(list(zip(P, Q, sig)), cv, cm, lq)


def cm_arrays(sh):
    a = sh.arr
    return {k: a[f'cm_{k}'] for k in ('c1', 'c2', 'w', 's1', 's2', 'l1', 'l2', 'mid')}


def blend_trunk(rest, i0, w, mats):
    """lbs.js: w = lb_w/255 on frame i0, 1 - w on frame i0 + 1 (clamped). mats (7, 4, 4) in meta.lbs.frames order."""
    k0 = i0.astype(int)
    k1 = np.minimum(k0 + 1, len(mats) - 1)
    ww = (w.astype(float) / 255)[:, None]
    h = np.c_[rest, np.ones(len(rest))]
    x0 = np.einsum('nij,nj->ni', mats[k0][:, :3], h)
    x1 = np.einsum('nij,nj->ni', mats[k1][:, :3], h)
    return ww * x0 + (1 - ww) * x1


def slerp_r128(a, b, t):
    """three r128 Quaternion.slerp(a -> b, t), xyzw, line for line (quat.js)."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    if t == 0:
        return a.copy()
    if t == 1:
        return b.copy()
    c = float(a @ b)
    if c < 0:
        b, c = -b, -c
    if c >= 1.0:
        return a.copy()
    s2 = 1.0 - c * c
    if s2 <= np.finfo(float).eps:
        r = (1 - t) * a + t * b
        return r / np.linalg.norm(r)
    s = np.sqrt(s2)
    h = np.arctan2(s, c)
    return a * (np.sin((1 - t) * h) / s) + b * (np.sin(t * h) / s)


def compose(p, q):
    """Matrix4.compose(p, q, 1) as a row-major 4x4 (quat.js composeColumnMajor, transposed)."""
    x, y, z, w = q
    M = np.eye(4)
    M[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                 [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                 [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]]
    M[:3, 3] = p
    return M


def frame_at(fr, i0, i1, t):
    """frames.js frameAt: positions lerp, rotations r128-slerp. fr (ns, nf, 7). Returns (nf, 4, 4) row-major."""
    return np.stack([compose(fr[i0, j, :3] + (fr[i1, j, :3] - fr[i0, j, :3]) * t,
                             slerp_r128(fr[i0, j, 3:], fr[i1, j, 3:], t)) for j in range(fr.shape[1])])


def pose_shipped(sh, s):
    """The runtime's poseAt(s): frames (nf,4,4), cm (n,3), lb (n,3)."""
    i0, i1, t = depth_index(s, sh.ns)
    F = frame_at(sh.frames, i0, i1, t)
    cm = skin_curve_set(curves_at(sh, i0, i1, t), sh.cv, cm_arrays(sh), sh.meta['LQ'])
    lbm = sh.meta['lbs']
    slots = [sh.fn.index(n) for n in lbm['frames']]
    lb = blend_trunk(sh.deq('lb', lbm), sh.arr['lb_i0'], sh.arr['lb_w'], F[slots])
    return F, cm, lb
