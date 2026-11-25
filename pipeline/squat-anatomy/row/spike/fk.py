"""Q1: a forward-kinematics joint model fitted to the squat's own 41 frames (frames3.npy), and its validation.

Fits on the even samples (0, 2, ..., 40); validates on all 41, odd samples reported separately. Frame convention
world = R(q)·v + p. Trunk frames map the shared trunk rest space; leg frames map body-local space.
Beyond the squat's range, splines clamp to their end value and the hip-centre quadratic continues on its end
slope; extrapolation() reports how far each pose is outside and what the clamp could be hiding.
"""
from dataclasses import dataclass, field

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.spatial.transform import Rotation as Rot

from core.geom import inv
from row.spike.squatdata import TRUNK, mat

LEG = ('femur_r', 'patella_r', 'tibia_r', 'talus_r')
LUMBAR = ('L5', 'L4', 'L3', 'L2', 'L1')
OUT = TRUNK + LEG + ('calcn_r', 'toes_r')
EVEN = np.arange(0, 41, 2)
ODD = np.arange(1, 41, 2)


def rv(R):
    return Rot.from_matrix(R).as_rotvec()


def rm(v):
    return Rot.from_rotvec(v).as_matrix()


def rotz(deg, c=None):
    M = np.eye(4)
    M[:3, :3] = Rot.from_rotvec([0, 0, np.radians(deg)]).as_matrix()
    if c is not None:
        M[:3, 3] = c - M[:3, :3] @ c
    return M


def ang(R):
    """Rotation angle of R in degrees."""
    return np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))


@dataclass(frozen=True, eq=False)
class Coords:
    pelvis: np.ndarray   # (n, 4): x, y, z, tilt φ (deg)
    lumbar: np.ndarray   # (n,) λ deg, + flexion
    hip: np.ndarray      # (n, 3): flexion, adduction, rotation (deg), intrinsic ZXY of R_pelvisᵀR_femur
    knee: np.ndarray     # (n,) deg, the readout (the driving coordinate)
    ankle: np.ndarray    # (n,) α deg about the fitted axis
    heel: np.ndarray     # (n,) ρ deg (0 in the squat)

    def q(self, i):
        return dict(pelvis=self.pelvis[i], lumbar=self.lumbar[i], hip=self.hip[i], knee=self.knee[i],
                    ankle=self.ankle[i], heel_lift=self.heel[i])


class Spline:
    """Natural cubic spline over knots x, clamped to its end values outside [x0, xn]."""

    def __init__(self, x, y):
        self.x = np.asarray(x, float)
        self.y = np.asarray(y, float)
        self.cs = CubicSpline(self.x, self.y, bc_type='natural', axis=0)

    def __call__(self, v):
        return self.cs(np.clip(v, self.x[0], self.x[-1]))

    def end_slope(self, v):
        """The spline's slope at the end the clamp uses (for the clamp-vs-linear uncertainty)."""
        return self.cs(self.x[0] if v < self.x[0] else self.x[-1], 1)


@dataclass(frozen=True, eq=False)
class FkModel:
    hip_c0: np.ndarray        # constant hip centre (pelvis rest space)
    hip_quad: np.ndarray      # (3, 3): per component [a0, a1, a2] in flexion (deg)
    hip_range: tuple
    knee_t: Spline            # tibia origin in the femur frame vs knee θ
    knee_r: Spline            # rotvec(R_k(θ)·R_k(θ0)ᵀ)
    knee_R0: np.ndarray
    pat_t: Spline
    pat_r: Spline
    pat_R0: np.ndarray
    ank_axis: np.ndarray      # talus-local unit axis
    ank_R0: np.ndarray        # R_tibiaᵀR_talus at sample 0
    talus_t: Spline           # talus origin in the tibia frame
    talus_by: str             # 'ankle' or 'knee': the spline's argument
    sub_t: Spline             # B(α) translation, B = T_talus⁻¹·T_calcn_static
    sub_r: Spline
    sub_R0: np.ndarray
    lum_c: np.ndarray         # (5, 3) rest-space centres, L5..L1
    lum_f: np.ndarray         # (5,) fractions of the total lumbar angle
    M0: np.ndarray            # T_calcn⁻¹·T_toes (static)
    mtp_p: np.ndarray         # MTP axis point, calcaneus-local
    mtp_d: np.ndarray         # MTP axis direction, calcaneus-local
    ranges: dict              # squat range per coordinate
    fits: dict = field(default_factory=dict)  # residuals and notes per fitted quantity

    def hip_centre(self, flex):
        lo, hi = self.hip_range
        a = self.hip_quad
        f = np.clip(flex, lo, hi)
        c = a[:, 0] + a[:, 1] * f + a[:, 2] * f * f
        if flex != f:
            c = c + (a[:, 1] + 2 * a[:, 2] * f) * (flex - f)
        return c


def extract(frames, readout, static, fn):
    """Coordinates read straight from the frames (spec §3 table). Axis-dependent ankle α needs a model: α=None."""
    n = len(frames)
    T = {name: np.stack([mat(frames[i, j, :3], frames[i, j, 3:]) for i in range(n)]) for j, name in enumerate(fn)}
    jp = fn.index('pelvis_rest')
    q = frames[:, jp, 3:]
    assert np.abs(q[:, :2]).max() < 1e-9, 'pelvis frame is not a pure z rotation'
    th = lambda name: np.degrees(2 * np.arctan2(frames[:, fn.index(name), 5], frames[:, fn.index(name), 6]))
    pel = np.c_[frames[:, jp, :3], th('pelvis_rest')]
    lum = -(th('thorax') - th('pelvis_rest'))
    hip = np.array([Rot.from_matrix(T['pelvis_rest'][i, :3, :3].T @ T['femur_r'][i, :3, :3]).as_euler('ZXY', degrees=True)
                    for i in range(n)])
    knee = np.array([r['knee'] for r in readout], float)
    return T, pel, lum, hip, knee


def fit(frames, readout, static, fn, foot):
    """foot: dict(mtp_p, mtp_d) in world at the static pose (from fk_foot_axis)."""
    T, pel, lum, hip, knee = extract(frames, readout, static, fn)
    E = EVEN
    fits = {}
    # 1. hip centre in pelvis rest space
    ch = np.array([(inv(T['pelvis_rest'][i]) @ T['femur_r'][i])[:3, 3] for i in range(41)])
    fl = hip[:, 0]
    c0 = ch[E].mean(0)
    quad = np.array([np.polynomial.polynomial.polyfit(fl[E], ch[E, k], 2) for k in range(3)])
    cq = np.stack([quad[k, 0] + quad[k, 1] * fl + quad[k, 2] * fl ** 2 for k in range(3)], 1)
    fits['hip centre (constant)'] = _res(np.linalg.norm(ch - c0, axis=1) * 1e3, 'mm', 'constant')
    fits['hip centre (quadratic)'] = _res(np.linalg.norm(ch - cq, axis=1) * 1e3, 'mm', 'quadratic in hip flexion')

    # 2-3. knee and patella relative to the femur, natural cubic splines in θ
    def rel(child):
        R = np.array([T['femur_r'][i, :3, :3].T @ T[child][i, :3, :3] for i in range(41)])
        t = np.array([T['femur_r'][i, :3, :3].T @ (T[child][i, :3, 3] - T['femur_r'][i, :3, 3]) for i in range(41)])
        r = np.array([rv(R[i] @ R[0].T) for i in range(41)])
        return R, t, r
    Rk, tk, rk = rel('tibia_r')
    Rp, tp, rp = rel('patella_r')
    knee_t, knee_r = Spline(knee[E], tk[E]), Spline(knee[E], rk[E])
    pat_t, pat_r = Spline(knee[E], tp[E]), Spline(knee[E], rp[E])
    fits['knee translation'] = _res(np.linalg.norm(knee_t(knee) - tk, axis=1) * 1e3, 'mm', 'natural cubic spline in knee θ')
    fits['knee rotation'] = _res(_rot_err(knee_r(knee), Rk, Rk[0]), '°', 'natural cubic spline in knee θ')
    fits['patella translation'] = _res(np.linalg.norm(pat_t(knee) - tp, axis=1) * 1e3, 'mm', 'natural cubic spline in knee θ')
    fits['patella rotation'] = _res(_rot_err(pat_r(knee), Rp, Rp[0]), '°', 'natural cubic spline in knee θ')

    # 4. ankle axis
    Ra = np.array([T['tibia_r'][i, :3, :3].T @ T['talus_r'][i, :3, :3] for i in range(41)])
    D = np.array([rv(Ra[0].T @ Ra[i]) for i in range(41)])
    _, _, Vt = np.linalg.svd(D[E])
    a = Vt[0] * np.sign(D[E][-1] @ Vt[0])
    alpha = np.degrees(D @ a)
    off = np.degrees(np.linalg.norm(D - np.outer(D @ a, a), axis=1))
    fits['ankle axis (off-axis)'] = _res(off, '°', 'single fixed axis, SVD of rotvec(R_a(0)ᵀR_a)')
    ta = np.array([T['tibia_r'][i, :3, :3].T @ (T['talus_r'][i, :3, 3] - T['tibia_r'][i, :3, 3]) for i in range(41)])
    cand = {}
    for by, x in (('ankle', alpha), ('knee', knee)):
        order = np.argsort(x[E])
        s = Spline(x[E][order], ta[E][order])
        cand[by] = (s, np.linalg.norm(s(x) - ta, axis=1) * 1e3)
    talus_by = min(cand, key=lambda k: np.sqrt((cand[k][1][ODD] ** 2).mean()))
    talus_t = cand[talus_by][0]
    for by in cand:
        fits[f'talus origin vs {by}'] = _res(cand[by][1], 'mm', 'spline' + (' (used)' if by == talus_by else ''))
    # 5. subtalar block B(α) = T_talus⁻¹·T_calcn_static
    Tc = static['calcn_r']
    B = np.array([inv(T['talus_r'][i]) @ Tc for i in range(41)])
    oa = np.argsort(alpha[E])
    xb = alpha[E][oa]
    rb = np.array([rv(B[i, :3, :3] @ B[0, :3, :3].T) for i in range(41)])
    sub_t, sub_r = Spline(xb, B[E][oa][:, :3, 3]), Spline(xb, rb[E][oa])
    fits['subtalar block B(α)'] = _res(np.linalg.norm(sub_t(alpha) - B[:, :3, 3], axis=1) * 1e3, 'mm',
                                       f'spline in α; B varies {np.ptp(B[:, :3, 3], 0).max() * 1e3:.2f} mm, '
                                       f'{max(ang(B[i, :3, :3] @ B[0, :3, :3].T) for i in range(41)):.2f}°')
    # 6. lumbar: rotation about z through a rest-space centre per joint
    tot = -np.radians(lum)
    lc, lf = [], []
    for k, name in enumerate(LUMBAR):
        par = TRUNK[k]
        G = np.array([inv(T[par][i]) @ T[name][i] for i in range(41)])
        dth = np.array([2 * np.arctan2(Rot.from_matrix(g[:3, :3]).as_quat()[2], Rot.from_matrix(g[:3, :3]).as_quat()[3])
                        for g in G])
        use = [i for i in E if abs(np.degrees(dth[i])) > 0.1]
        A = np.vstack([np.eye(3) - G[i, :3, :3] for i in use])
        b = np.concatenate([G[i, :3, 3] for i in use])
        c, *_ = np.linalg.lstsq(A, b, rcond=None)
        lc.append(c)
        m = np.abs(tot[E]) > 1e-6
        lf.append(float(np.linalg.lstsq(tot[E][m, None], dth[E][m], rcond=None)[0][0]))
    assert np.allclose(frames[:, fn.index('L1')], frames[:, fn.index('thorax')]), 'thorax is not L1'
    lc, lf = np.array(lc), np.array(lf)
    # 7. foot hinge: toes relative to calcn, MTP axis in calcaneus-local space
    M0 = inv(Tc) @ static['toes_r']
    Tci = inv(Tc)
    mtp_p = Tci[:3, :3] @ foot['mtp_p'] + Tci[:3, 3]
    mtp_d = Tci[:3, :3] @ foot['mtp_d']
    rng = dict(knee=(knee.min(), knee.max()), hip=(fl.min(), fl.max()), ankle=(alpha.min(), alpha.max()),
               lumbar=(lum.min(), lum.max()), pelvis_tilt=(pel[:, 3].min(), pel[:, 3].max()),
               hip_add=(hip[:, 1].min(), hip[:, 1].max()), hip_rot=(hip[:, 2].min(), hip[:, 2].max()))
    model = FkModel(hip_c0=c0, hip_quad=quad, hip_range=(fl[E].min(), fl[E].max()), knee_t=knee_t, knee_r=knee_r,
                    knee_R0=Rk[0], pat_t=pat_t, pat_r=pat_r, pat_R0=Rp[0], ank_axis=a, ank_R0=Ra[0], talus_t=talus_t,
                    talus_by=talus_by, sub_t=sub_t, sub_r=sub_r, sub_R0=B[0, :3, :3], lum_c=lc, lum_f=lf, M0=M0,
                    mtp_p=mtp_p, mtp_d=mtp_d / np.linalg.norm(mtp_d), ranges=rng, fits=fits)
    coords = Coords(pelvis=pel, lumbar=lum, hip=hip, knee=knee, ankle=alpha, heel=np.zeros(41))
    return model, coords, T


def _res(e, unit, form):
    e = np.asarray(e, float)
    return dict(unit=unit, form=form, rms=float(np.sqrt((e ** 2).mean())), max=float(e.max()),
                rms_odd=float(np.sqrt((e[ODD] ** 2).mean())), max_odd=float(e[ODD].max()))


def _rot_err(r_fit, R, R0):
    return np.array([ang(rm(r_fit[i]) @ R0 @ R[i].T) for i in range(len(R))])


def fk(model, q):
    """World 4x4 per frame for q = {pelvis: (x, y, z, φ°), lumbar: λ°, hip: (flex, add, rot)°, knee: θ°,
    ankle: α°, heel_lift: ρ°}. Root: the pelvis."""
    m = model
    x, y, z, phi = q['pelvis']
    Tp = rotz(phi)
    Tp[:3, 3] = (x, y, z)
    out = {'pelvis_rest': Tp}
    prev = Tp
    tot = -float(q['lumbar'])
    for k, name in enumerate(LUMBAR):
        prev = prev @ rotz(m.lum_f[k] * tot, m.lum_c[k])
        out[name] = prev
    out['thorax'] = out['L1'].copy()
    H = np.eye(4)
    H[:3, :3] = Rot.from_euler('ZXY', q['hip'], degrees=True).as_matrix()
    H[:3, 3] = m.hip_centre(q['hip'][0])
    Tf = Tp @ H
    out['femur_r'] = Tf
    th = q['knee']
    out['tibia_r'] = Tf @ _rt(rm(m.knee_r(th)) @ m.knee_R0, m.knee_t(th))
    out['patella_r'] = Tf @ _rt(rm(m.pat_r(th)) @ m.pat_R0, m.pat_t(th))
    al = q['ankle']
    ra = m.ank_R0 @ rm(m.ank_axis * np.radians(al))  # a hinge: the angle itself is never clamped
    ta = m.talus_t(al if m.talus_by == 'ankle' else th)
    out['talus_r'] = out['tibia_r'] @ _rt(ra, ta)
    out['calcn_r'] = out['talus_r'] @ _rt(rm(m.sub_r(al)) @ m.sub_R0, m.sub_t(al))
    out['toes_r'] = out['calcn_r'] @ hinge(m, q.get('heel_lift', 0.0)) @ m.M0
    return out


def hinge(model, rho):
    """Toes relative to the calcaneus about the MTP axis: + ρ lifts the heel off a fixed forefoot."""
    M = np.eye(4)
    R = rm(model.mtp_d * np.radians(rho))
    M[:3, :3] = R
    M[:3, 3] = model.mtp_p - R @ model.mtp_p
    return M


def _rt(R, t):
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = t
    return M


def foot_axis(sh, fax):
    """MTP hinge in world at the static pose: the mean of the 5 % of toes vertices with the smallest x; direction
    normalize(cross(FAX, ŷ))."""
    P, _, _, _ = sh.bone('toes_r')
    W = P @ sh.static['toes_r'][:3, :3].T + sh.static['toes_r'][:3, 3]
    k = max(1, int(0.05 * len(W)))
    p = W[np.argsort(W[:, 0])[:k]].mean(0)
    d = np.cross(fax, [0, 1, 0])
    return dict(mtp_p=p, mtp_d=d / np.linalg.norm(d))


def validate(model, coords, T, static, bones):
    """Per-frame position (mm) and rotation (°) error of the regenerated frames, plus the max bone-vertex
    displacement. bones: frame name -> (n, 3) vertices in that frame's space."""
    rows = {}
    regen = [fk(model, coords.q(i)) for i in range(41)]
    for name in OUT:
        true = [static[name]] * 41 if name in static else list(T[name])
        pe = np.array([np.linalg.norm(regen[i][name][:3, 3] - true[i][:3, 3]) * 1e3 for i in range(41)])
        re = np.array([ang(regen[i][name][:3, :3] @ true[i][:3, :3].T) for i in range(41)])
        V = bones.get(name)
        bv = 0.0
        if V is not None:
            bv = max(np.linalg.norm(V @ (regen[i][name][:3, :3] - true[i][:3, :3]).T
                                    + (regen[i][name][:3, 3] - true[i][:3, 3]), axis=1).max() for i in range(41)) * 1e3
        tot = pe + re  # worst sample by the sum, in mixed units, only to name a sample
        rows[name] = dict(pos_max_even=float(pe[EVEN].max()), pos_max_odd=float(pe[ODD].max()),
                          pos_rms=float(np.sqrt((pe ** 2).mean())), bone_max=float(bv),
                          rot_max_even=float(re[EVEN].max()), rot_max_odd=float(re[ODD].max()),
                          rot_rms=float(np.sqrt((re ** 2).mean())), worst_i=int(np.argmax(tot)))
    return rows, regen


def extrapolation(model, q):
    """Each coordinate outside the squat range, by how much, and the clamp-vs-linear difference it implies."""
    m = model
    rows = []
    vals = dict(knee=q['knee'], hip=q['hip'][0], ankle=q['ankle'], lumbar=q['lumbar'], pelvis_tilt=q['pelvis'][3],
                hip_add=q['hip'][1], hip_rot=q['hip'][2])
    for k, v in vals.items():
        lo, hi = m.ranges[k]
        d = v - hi if v > hi else (v - lo if v < lo else 0.0)
        if d == 0:
            continue
        unc = {}
        if k == 'knee':
            for nm, s, unit in (('knee translation', m.knee_t, 'mm'), ('knee rotation', m.knee_r, '°'),
                                ('patella translation', m.pat_t, 'mm'), ('patella rotation', m.pat_r, '°')):
                g = np.linalg.norm(s.end_slope(v)) * abs(d) * (1e3 if unit == 'mm' else np.degrees(1))
                unc[nm] = (float(g), unit)
            if m.talus_by == 'knee':
                unc['talus origin'] = (float(np.linalg.norm(m.talus_t.end_slope(v)) * abs(d) * 1e3), 'mm')
        elif k == 'ankle':
            unc['subtalar translation'] = (float(np.linalg.norm(m.sub_t.end_slope(v)) * abs(d) * 1e3), 'mm')
            if m.talus_by == 'ankle':
                unc['talus origin'] = (float(np.linalg.norm(m.talus_t.end_slope(v)) * abs(d) * 1e3), 'mm')
        elif k == 'hip':
            a = m.hip_quad
            quad = a[:, 0] + a[:, 1] * v + a[:, 2] * v * v
            unc['hip centre (linear vs quadratic)'] = (float(np.linalg.norm(m.hip_centre(v) - quad) * 1e3), 'mm')
        rows.append(dict(coord=k, value=float(v), lo=float(lo), hi=float(hi), beyond=float(d), unc=unc))
    return rows


def to_npz(model):
    """Fitted parameters as plain arrays (for slices 2/6)."""
    out = dict(hip_c0=model.hip_c0, hip_quad=model.hip_quad, hip_range=np.array(model.hip_range),
               ank_axis=model.ank_axis, ank_R0=model.ank_R0, knee_R0=model.knee_R0, pat_R0=model.pat_R0,
               sub_R0=model.sub_R0, lum_c=model.lum_c, lum_f=model.lum_f, M0=model.M0, mtp_p=model.mtp_p,
               mtp_d=model.mtp_d, talus_by=np.array(model.talus_by))
    for nm in ('knee_t', 'knee_r', 'pat_t', 'pat_r', 'talus_t', 'sub_t', 'sub_r'):
        s = getattr(model, nm)
        out[nm + '_x'] = s.x
        out[nm + '_y'] = s.y
    return out


def angles_check(model, coords, T, readout, gh_rest=None):
    """Q1-C: each readout angle against the same angle read from the frames (lean needs the shoulder point)."""
    ro = {k: np.array([r[k] for r in readout], float) for k in ('hip', 'knee', 'ankle', 'lumbar', 'lean')}
    Rk = [T['femur_r'][i, :3, :3].T @ T['tibia_r'][i, :3, :3] for i in range(41)]
    from_fr = dict(hip=coords.hip[:, 0], knee=coords.knee[0] + np.array([ang(R @ Rk[0].T) for R in Rk]),
                   ankle=coords.ankle, lumbar=coords.lumbar)
    note = dict(hip='intrinsic ZXY flexion of R_pelvisᵀR_femur; readout is v2 − δ',
                knee='angle of R_femurᵀR_tibia from sample 0, plus the readout at 0',
                ankle='α about the fitted axis', lumbar='−(θ_thorax − θ_pelvis)')
    if gh_rest is not None:
        lean = []
        for i in range(41):
            g = T['thorax'][i, :3, :3] @ gh_rest + T['thorax'][i, :3, 3]
            v = g - T['femur_r'][i, :3, 3]
            lean.append(np.degrees(np.arctan2(v[0], v[1])))
        from_fr['lean'] = np.array(lean)
        note['lean'] = 'hip centre (z = 0) to the shoulder centre, from vertical'
    rows = {}
    for k, v in from_fr.items():
        d = ro[k] - v
        off = float(d.mean())
        rows[k] = dict(offset=off, max_diff=float(np.abs(d - off).max()), max_raw=float(np.abs(d).max()),
                       range=(float(v.min()), float(v.max())), ro_range=(float(ro[k].min()), float(ro[k].max())),
                       note=note[k])
    return rows
