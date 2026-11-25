"""Rowing arm IK: the squat's Arm with the girdle and the bar swapped for the pose (dataclasses.replace), the hand
closed on the erg handle. Variables: the 21 squat arm/hand DOF plus the handle's world x.

cost_row keeps cost3's penetration, snug and wrist terms (same expressions, the handle as the bar), ISB limits
widened to a rowing range, and adds elbow and shoulder targets from the data, the grip width and a body-clearance
term against the posed rectus abdominis.
"""
import dataclasses
import time

import numpy as np
from scipy.optimize import minimize

from row.spike.thresholds import GRIP_WEIGHT, GRIP_Z, IK_ELBOW_OK, IK_PEN_OK
from core.geom import inv, tpts

LIMITS = dict(er=(-20, 60), elev=(0, 120), plane=(-100, 110), elbow=(0, 145))
BODY_CLEAR = 0.025


def arm_for_pose(arm, Rsc, Rs, rb):
    return dataclasses.replace(arm, RSC=Rsc, RS=Rs, GH_NEW=tpts(Rs, arm.GH[None])[0], RB=rb)


def handle_rest(T_thorax, xh, yh):
    """The handle axis in thorax rest space: valid because the trunk frames are pure z rotations."""
    return tpts(inv(T_thorax), np.array([[xh, yh, 0.0]]))[0, :2]


def gaps(arm, C, bar):
    return {p: np.hypot(*(tpts(arm.bone_T(C, p), arm.HV[p])[:, :2] - bar).T) - arm.RB for p in arm.HP}


def shoulder_sag(arm, C):
    """Sagittal humerus angle relative to the thorax axis: 0 hanging along the trunk, + forward."""
    gh, ec, _, _ = arm.hframe(C['hum'] @ arm.Tcur[0])
    d = ec - gh
    x, y = d @ arm.TF[:, 0], d @ arm.TF[:, 1]
    return np.degrees(np.arctan2(x, -y))


def cost_row(z, arm, T_thorax, yh, tg, x_warm, body_pts, verbose=False):
    x, xh = z[:-1], z[-1]
    bar = handle_rest(T_thorax, xh, yh)
    C = arm.transforms(x)
    g = gaps(arm, C, bar)
    parts = {}
    parts['pen'] = sum(1e4 * np.sum(np.maximum(0, arm.MARG[p] - g[p]) ** 2) for p in arm.HP)
    sn = 0
    for f, (mc, p1, p2, p3) in arm.CH.items():
        sn += 3e3 * (min(g[p1].min(), g[p2].min()) - arm.MARG[p1]) ** 2 + 3e3 * (g[p3].min() - arm.MARG[p3]) ** 2 \
            + 2e3 * (g[mc].min() - 0.009) ** 2
    sn += 1e3 * (min(g[28].min(), g[29].min()) - arm.MARG[28]) ** 2
    parts['snug'] = sn
    dev, fl, _ = arm.wrist_angles(C)
    parts['wrist'] = 3e2 * (max(0, np.radians(abs(dev) - 6)) ** 2 + max(0, np.radians(fl - 5)) ** 2
                            + max(0, np.radians(-fl - 15)) ** 2) + 2 * np.radians(fl) ** 2 + 2 * np.radians(dev) ** 2
    a = arm.isb_angles(C['hum'] @ arm.Tcur[0])
    ef = arm.elbow_flex(C)
    vals = dict(er=a['er'], elev=a['elev'], plane=a['plane'], elbow=ef)
    parts['limits'] = 3e3 * sum(max(0, np.radians(vals[k] - hi)) ** 2 + max(0, np.radians(lo - vals[k])) ** 2
                                for k, (lo, hi) in LIMITS.items())
    parts['elbow'] = 2e2 * np.radians(ef - tg['elbow']) ** 2
    sh = shoulder_sag(arm, C)
    parts['shoulder'] = 20 * np.radians(sh - tg['shoulder']) ** 2
    parts['grip'] = GRIP_WEIGHT * (arm.mc3z(C) - GRIP_Z) ** 2
    hw = np.array([xh, yh])
    d = np.hypot(*(body_pts[:, :2] - hw).T).min() if len(body_pts) else 1.0
    parts['body'] = 1e3 * max(0, (arm.RB + BODY_CLEAR) - d) ** 2
    parts['reg'] = 0.004 * np.sum(((x - x_warm) / arm.SIG) ** 2)
    c = sum(parts.values())
    if not verbose:
        return c
    mc3 = tpts(C['hand'] @ arm.Tcur[13], arm.MC3_0).mean(0)
    return c, parts, dict(elbow=ef, plane=a['plane'], elev=a['elev'], er=a['er'], shoulder=sh, dev=dev, fl=fl,
                          mc3_axis=float((np.hypot(*(mc3[:2] - bar)) - arm.RB) * 1e3), body_d=float(d * 1e3),
                          handle=(float(xh), float(yh)))


def solve(arm, T_thorax, yh, tg, starts, x_warm, body_pts, xh_bounds, maxiter=1500):
    """L-BFGS-B from each start (z = 21 DOF + handle x); the lowest cost wins. Times each minimize."""
    bounds = [(None, None)] * arm.NV + [xh_bounds]
    runs = []
    best = None
    for z0 in starts:
        t0 = time.perf_counter()
        r = minimize(cost_row, z0, args=(arm, T_thorax, yh, tg, x_warm, body_pts), method='L-BFGS-B',
                     bounds=bounds, options={'maxiter': maxiter})
        runs.append(dict(wall=time.perf_counter() - t0, nit=int(r.nit), nfev=int(r.nfev), cost=float(r.fun),
                         message=str(r.message)))
        if best is None or r.fun < best.fun:
            best = r
    return best, runs


def cold_starts(x4, xh0, nv, seed=7):
    """zeros, the squat solution, and three ±15° perturbations of its first 7 DOF (default_rng(7))."""
    rng = np.random.default_rng(seed)
    s = [np.r_[np.zeros(nv), xh0], np.r_[x4, xh0]]
    for _ in range(3):
        s.append(np.r_[x4[:7] + np.radians(rng.uniform(-15, 15, 7)), x4[7:], xh0])
    return s


PEN_OK, ELBOW_OK = IK_PEN_OK, IK_ELBOW_OK          # see row/spike/thresholds.py for why 0.01


def converged(info, parts, tg):
    return parts['pen'] <= PEN_OK and abs(info['elbow'] - tg['elbow']) <= ELBOW_OK


def clearance_to(body_pts, handle, rb):
    if not len(body_pts):
        return None
    return float((np.hypot(*(body_pts[:, :2] - np.asarray(handle)).T).min() - rb) * 1e3)

