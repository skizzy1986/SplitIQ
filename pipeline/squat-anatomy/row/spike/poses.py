"""Q3b: the five key poses. The leg and trunk come from a least-squares pose solve on the fitted joint model
(row/spike/fk.py) against the Engstrom targets on the erg geometry; everything here is modelled.

Unknowns per pose: pelvis x, y, tilt φ, lumbar λ, hip flexion h, ankle α, heel lift ρ. Fixed: knee θ = the data,
hip adduction and rotation = the squat's standing values, pelvis z. Hard residuals (×1000): the talus origin on
the footplate target, the foot pitch, and the ischial tuberosities on the seat. Soft residuals in σ units: hip,
ankle, spinal flexion, the trunk line Θ and ρ.
"""
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

from row.spike import fk
from row.spike.erg import v
from squat.geom import rot_about, tpts

POSES = ('catch', 'legs_flat', 'trunk_open', 'finish', 'mid_recovery')
# shoulder-girdle retraction per pose (°): modelled, the squat's 12.015° at the finish, protracted at the catch
GIRDLE_R = dict(catch=-10.0, legs_flat=-10.0, trunk_open=-5.0, finish=12.015, mid_recovery=-10.0)
SIGMA = dict(hip=8.0, ankle=8.0, spinal=6.0, theta=3.0, rho=20.0, hip_ar=10.0)
HARD = 1000.0
PELVIS_Z = -0.0006        # the squat's pelvis z (it stays in the mid-plane)


@dataclass(frozen=True, eq=False)
class Setup:
    model: object
    q0: dict                 # the squat's standing coordinates
    ankle_off: float         # readout ankle − α
    foot_hd: dict            # heel-down calcn/toes, talus point, MTP axis (world)
    ischial: np.ndarray      # pelvis rest-space vertices of the ischial tuberosities
    crest: np.ndarray        # iliac-crest landmark, pelvis rest space
    fax_c: np.ndarray        # heel-to-toe axis in calcaneus-local space
    erg: dict
    epi: np.ndarray          # femoral epicondyle centre, femur-local (the knee point)
    gh: np.ndarray           # shoulder centre, thorax rest space (lean)


def pitch(Tc, fax_c):
    a = Tc[:3, :3] @ fax_c
    return np.degrees(np.arctan2(a[1], a[0]))


def heel_down(sh, model, coords, T, readouts, ergt):
    """The squat's static foot rotated about world z through the MTP point to the footplate pitch, then moved so
    the talus origin sits on the ankle point (x, y)."""
    Tc, Tt = sh.static['calcn_r'], sh.static['toes_r']
    mtp_w = Tc[:3, :3] @ model.mtp_p + Tc[:3, 3]
    d_w = Tc[:3, :3] @ model.mtp_d
    R = rot_about([0, 0, 1], np.radians(v(ergt, 'footplate_deg')), mtp_w)
    talus0 = T['talus_r'][0, :3, 3]
    t = R[:3, :3] @ talus0 + R[:3, 3]
    M = np.eye(4)
    M[:3, 3] = [v(ergt, 'ankle_x') - t[0], v(ergt, 'ankle_y') - t[1], 0]
    H = M @ R
    return dict(calcn=H @ Tc, toes=H @ Tt, talus=H[:3, :3] @ talus0 + H[:3, 3], mtp_p=H[:3, :3] @ mtp_w + H[:3, 3],
                mtp_d=H[:3, :3] @ d_w)


def foot_target(setup, rho):
    """Heel lift ρ: the calcaneus and talus turn about the MTP axis, the forefoot stays on the footplate."""
    f = setup.foot_hd
    L = rot_about(f['mtp_d'], -np.radians(rho), f['mtp_p'])
    return L @ f['calcn'], L[:3, :3] @ f['talus'] + L[:3, 3]


def make_setup(sh, model, coords, T, readouts, ergt, gh):
    Pp, pid, _, bm = sh.bone('pelvisR')
    c0 = model.hip_c0
    low = Pp[:, 1] < Pp[:, 1].min() + 0.03
    isch = Pp[low & (Pp[:, 0] < c0[0])]
    ilium = Pp[Pp[:, 0] < c0[0] + 0.08]
    crest = ilium[np.argmax(ilium[:, 1])]
    Tc = sh.static['calcn_r']
    fax_c = Tc[:3, :3].T @ readouts.fax
    ro = sh.meta['readout']
    return Setup(model=model, q0=coords.q(0), ankle_off=float(ro[0]['ankle'] - coords.ankle[0]),
                 foot_hd=heel_down(sh, model, coords, T, readouts, ergt), ischial=isch, crest=crest, fax_c=fax_c,
                 erg=ergt, epi=readouts.epi, gh=gh)


def q_of(setup, u, knee):
    """u = (pelvis x, y, φ, λ, h, α, ρ) for the spec's solve, plus (hip adduction, rotation) for the free-hip one."""
    px, py, phi, lam, h, al, rho = u[:7]
    q0 = setup.q0
    add, rot = (u[7], u[8]) if len(u) > 7 else (q0['hip'][1], q0['hip'][2])
    return dict(pelvis=np.array([px, py, PELVIS_Z, phi]), lumbar=lam, hip=np.array([h, add, rot]), knee=knee,
                ankle=al, heel_lift=rho)


def theta_model(F, setup, acromion):
    p = F['pelvis_rest'][:3, :3] @ setup.crest + F['pelvis_rest'][:3, 3]
    a = F['thorax'][:3, :3] @ acromion + F['thorax'][:3, 3]
    d = a - p
    return float(np.degrees(np.arctan2(-d[0], d[1])))


def seat_gap(F, setup):
    W = setup.ischial @ F['pelvis_rest'][:3, :3].T + F['pelvis_rest'][:3, 3]
    return float(W[:, 1].min() - (v(setup.erg, 'seat_top_y') + v(setup.erg, 'ischial_tissue'))), W


def residuals(u, setup, tg, acromion, parts=False):
    q = q_of(setup, u, tg['knee'])
    F = fk.fk(setup.model, q)
    Tc_t, tal_t = foot_target(setup, u[6])
    tal = F['talus_r'][:3, 3]
    gap, _ = seat_gap(F, setup)
    hard = np.r_[(tal[:2] - tal_t[:2]), np.radians(pitch(F['calcn_r'], setup.fax_c) - pitch(Tc_t, setup.fax_c)), gap]
    th = theta_model(F, setup, acromion)
    soft = np.r_[(u[4] - tg['hip']) / SIGMA['hip'], (u[5] + setup.ankle_off - tg['ankle']) / SIGMA['ankle'],
                 (u[3] - tg['spinal']) / SIGMA['spinal'], (th - tg['theta']) / SIGMA['theta'], u[6] / SIGMA['rho']]
    if len(u) > 7:
        # free-hip solve: the foot stays in its footplate plane; adduction and rotation lean on the squat's values
        hard = np.r_[hard, tal[2] - setup.foot_hd['talus'][2]]
        soft = np.r_[soft, (u[7] - setup.q0['hip'][1]) / SIGMA['hip_ar'], (u[8] - setup.q0['hip'][2]) / SIGMA['hip_ar']]
    r = np.r_[HARD * hard, soft]
    return (r, F, dict(theta=th, closure=float(np.linalg.norm(hard[:2]) * 1e3), pitch_err=float(np.degrees(hard[2])),
                       seat=float(gap * 1e3))) if parts else r


# bounds (spec §5b): φ ∈ [−60, 40]°, λ ∈ [−25, 55]°, ρ ∈ [0, 40]°, α up to 36° dorsiflexion; the rest free
LO = [-np.inf, -np.inf, -60, -25, -np.inf, -np.inf, 0]


def solve(setup, tg, acromion, starts, free_hip=False):
    """least_squares ('trf') from each start; the lowest cost wins."""
    al_hi = 36.0 - setup.ankle_off
    lo = LO + [-45, -60] if free_hip else LO
    # free hip: adduction within ±45°, rotation within ±60° (well past the squat's own range)
    hi = [np.inf, np.inf, 40, 55, np.inf, al_hi, 40] + ([45, 60] if free_hip else [])
    best = None
    for u0 in starts:
        u0 = np.r_[u0, setup.q0['hip'][1:]] if free_hip else np.asarray(u0, float)
        u0 = np.clip(u0, np.array(lo) + 1e-9, np.array(hi) - 1e-9)
        r = least_squares(residuals, u0, args=(setup, tg, acromion), bounds=(lo, hi), method='trf', x_scale='jac',
                          max_nfev=4000)
        if best is None or r.cost < best.cost:
            best = r
    return best


def start_from(coords, i):
    q = coords.q(i)
    return [q['pelvis'][0], q['pelvis'][1], q['pelvis'][3], q['lumbar'], q['hip'][0], q['ankle'], 0.0]


def girdle_p(girdle_p0, e):
    return (GIRDLE_R[e] / girdle_p0[0]) * np.asarray(girdle_p0, float)


def acromion_rest(pr, pidr, Rs):
    """Max-z vertex of the upper 10 % (by height) of the scapula, posed by the girdle, thorax rest space."""
    S = tpts(Rs, pr[pidr == 37])
    up = S[S[:, 1] >= np.percentile(S[:, 1], 90)]
    return up[np.argmax(up[:, 2])]


def report(setup, u, F, info, tg):
    m = setup.model
    q = q_of(setup, u, tg['knee'])
    knee_pt = F['femur_r'][:3, :3] @ setup.epi + F['femur_r'][:3, 3]
    tal = F['talus_r'][:3, 3]
    sh_v = knee_pt - tal
    shin = float(np.degrees(np.arctan2(abs(sh_v[0]), sh_v[1])))
    gap, W = seat_gap(F, setup)
    g = F['thorax'][:3, :3] @ setup.gh + F['thorax'][:3, 3]
    hipc = F['femur_r'][:3, 3]
    lean = float(np.degrees(np.arctan2(g[0] - hipc[0], g[1] - hipc[1])))
    Rt = F['thorax'][:3, :3]
    incl = float(np.degrees(np.arctan2(-Rt[0, 1], Rt[1, 1])))
    return dict(u=[float(x) for x in u], hip_add=float(q['hip'][1]), hip_rot=float(q['hip'][2]),
                hip_x=float(F['femur_r'][0, 3]), seat_x=float(W[np.argmin(W[:, 1]), 0]), pelvis_tilt=float(u[2]),
                lumbar=float(u[3]), hip=float(u[4]), knee=float(tg['knee']), ankle=float(u[5] + setup.ankle_off),
                heel_lift=float(u[6]), shin_from_vertical=shin, theta_model=info['theta'], theta_target=tg['theta'],
                lean=lean, thorax_incl=incl, closure=info['closure'], seat=info['seat'], pitch_err=info['pitch_err'],
                foot_z_drift=float((tal[2] - setup.foot_hd['talus'][2]) * 1e3),
                outside=fk.extrapolation(m, q),
                targets=dict(hip=(tg['hip'], float(u[4])), ankle=(tg['ankle'], float(u[5] + setup.ankle_off)),
                             spinal=(tg['spinal'], float(u[3])), theta=(tg['theta'], info['theta'])))
