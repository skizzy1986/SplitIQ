"""The posed body at a rowing pose (right side + axial; the left is the mirror, z -> -z, for renders only).

Bones: legs and foot by the FK frames, pelvis and vertebrae by the trunk frames, the arm and hand parts of
thoraxR by the arm transforms then the thorax frame, the rest of thoraxR and the thorax by the thorax frame.
Muscles: cm by the curve rig (rule sig) through the skinning port; lb by top-4 DQS for the arm, then the trunk
blend; st by top-4 DQS (+ the rebuilt parts), then the thorax frame; sa by the thorax frame.
"""
from dataclasses import dataclass

import numpy as np

from row.spike import curveskin as cs
from row.spike import rig as rigmod
from row.spike import upper
from core.skin import group_of_pid

ARM_PIDS = set(range(30)) | {37, 38}


@dataclass(frozen=True, eq=False)
class Body:
    bones: dict      # group -> (V (n, 3) world, F (m, 3), pid (n,))
    sets: dict       # 'cm' | 'lb' | 'st' | 'sa' -> (V world, F, mid)
    frames: dict     # frame name -> 4x4


def apply(M, V):
    return V @ M[:3, :3].T + M[:3, 3]


def topology(sh, base):
    """Faces and muscle ids of each set as shipped (st in its upper3 order), and the base thoraxR rest bones."""
    a = sh.arr
    sets = {}
    for k in ('cm', 'lb', 'st', 'sa'):
        sets[k] = (a[f'{k}_idx'].reshape(-1, 3).astype(np.int64), a[f'{k}_mid'].astype(int))
    return sets


def pose_bones(sh, base, F, C=None):
    """Bones at frames F. thoraxR: base rest positions with arm transforms C (None: as shipped, already posed)."""
    out = {}
    for g, bm in sh.meta['bones'].items():
        V, pid, Fc, _ = sh.bone(g)
        fr = bm['frame'].lstrip('@')
        if g == 'thoraxR' and C is not None:
            V = base.pr.copy()
            for p in ARM_PIDS:
                m = base.pidr == p
                V[m] = apply(C[group_of_pid(p)], V[m])
        out[g] = (apply(F[fr], V), Fc, pid)
    return out


def lb_blend(sh, rest, F):
    lbm = sh.meta['lbs']
    return cs.blend_trunk(rest, sh.arr['lb_i0'], sh.arr['lb_w'], np.stack([F[n] for n in lbm['frames']]))


def pose_body(sh, base, topo, F, rigs, urig, C, MT, variant='A'):
    curves = rigmod.rig_curves_at(rigs, F, variant)
    cm = cs.skin_curve_set(curves, sh.cv, cs.cm_arrays(sh), sh.meta['LQ'])
    st, lb = upper.pose_upper(urig, C, MT)
    sets = {'cm': cm, 'lb': lb_blend(sh, lb, F), 'st': apply(F['thorax'], st),
            'sa': apply(F['thorax'], sh.deq('sa', sh.man['sa_meta']))}
    return Body(bones=pose_bones(sh, base, F, C), sets={k: (v, *topo[k]) for k, v in sets.items()}, frames=F), curves


def squat_body(sh, base, topo, i):
    """The shipped squat at sample i, exactly as the runtime poses it (the reference for baselines and volumes)."""
    F = {n: sh.T[n][i] for n in sh.fn}
    F.update({k: sh.static[k] for k in ('calcn_r', 'toes_r')})
    curves = cs.curves_at(sh, i, i, 0.0)
    cm = cs.skin_curve_set(curves, sh.cv, cs.cm_arrays(sh), sh.meta['LQ'])
    lbm = sh.meta['lbs']
    sets = {'cm': cm, 'lb': lb_blend(sh, sh.deq('lb', lbm), F), 'st': apply(F['thorax'], sh.deq('st', sh.man['st_meta'])),
            'sa': apply(F['thorax'], sh.deq('sa', sh.man['sa_meta']))}
    return Body(bones=pose_bones(sh, base, F), sets={k: (v, *topo[k]) for k, v in sets.items()}, frames=F), \
        [(P, Q, s) for P, Q, s in curves]


def curve_end_exclusion(sh, curves, V):
    """cm vertices within 1 cm of either end point of a curve they are bound to (c1; c2 when w < 255)."""
    cm = cs.cm_arrays(sh)
    ends = np.array([[P[0], P[-1]] for P, _, _ in curves])        # (n_curves, 2, 3)
    d1 = np.linalg.norm(V[:, None] - ends[cm['c1']], axis=-1).min(1)
    d2 = np.linalg.norm(V[:, None] - ends[cm['c2']], axis=-1).min(1)
    d2[cm['w'] >= 255] = np.inf
    return np.minimum(d1, d2) < 0.01
