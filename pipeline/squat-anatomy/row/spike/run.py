"""Step orchestration for python -m row spike: each step writes its partial metrics (<step>.json) and fitted
artefacts under the out dir; 'report' merges them into metrics.json and report.md."""
import json
import time
from pathlib import Path

import numpy as np

from row.fetch import require_rowing, require_skin
from row.inputs import ENGSTROM_SUBJECTS
from row.spike.thresholds import HANDLE_X_BACK, HANDLE_X_FWD

STEPS_ALL = ('fk', 'rig', 'upper', 'poses', 'skin', 'render', 'report')


def jsonable(o):
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return jsonable(o.tolist())
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(jsonable(obj), indent=1, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')


class Run:
    """Shared, lazily built state for one python -m row spike invocation."""

    def __init__(self, paths, out, rowing_dir=None, skin_dir=None, renders=True, log=print):
        self.paths = paths
        self.out = Path(out)
        self.rowing_dir = Path(rowing_dir) if rowing_dir else None
        self.skin_dir = Path(skin_dir) if skin_dir else None
        self.renders = renders
        self.log = log
        self._c = {}

    def _get(self, k, fn):
        if k not in self._c:
            self._c[k] = fn()
        return self._c[k]

    @property
    def sh(self):
        from row.spike.squatdata import load_shipped
        return self._get('sh', lambda: load_shipped(self.paths))

    @property
    def ctx(self):
        from squat.context import Context
        return self._get('ctx', lambda: Context(self.paths))

    def rowing_root(self):
        return require_rowing(self.paths, root=self.rowing_dir)

    def skin_root(self):
        return require_skin(self.paths, root=self.skin_dir).parent

    @property
    def fk(self):
        from row.spike import fk
        def build():
            sh = self.sh
            foot = fk.foot_axis(sh, self.ctx.readouts.fax)
            return fk.fit(sh.frames3, sh.meta['readout'], sh.static, sh.fn, foot)
        return self._get('fk', build)

    @property
    def rigs(self):
        from row.spike import rig
        def build():
            T = rig.frame_stack(self.sh)
            out = [rig.fit_curve(self.sh, ci, T) for ci in range(len(self.sh.cv))]
            return T, out
        return self._get('rigs', build)

    @property
    def upper(self):
        from row.spike import upper
        def build():
            v3 = self.paths.v3
            return upper.compute(self.ctx, np.load(v3 / 'armik4_x.npy'), np.load(self.paths.require('v3/st_W.npy', 'fixed')),
                                 dict(np.load(v3 / 'upper3.npz')), self.sh)
        return self._get('upper', build)


def step_fk(r):
    from row.spike import fk
    model, coords, T = r.fk
    sh = r.sh
    bones = {}
    for g, bm in sh.meta['bones'].items():
        f = bm['frame'].lstrip('@')
        bones[f] = np.vstack([bones[f], sh.bone(g)[0]]) if f in bones else sh.bone(g)[0]
    rows, _ = fk.validate(model, coords, T, sh.static, bones)
    gh = None
    try:
        gh = r.ctx.kin.arm_points(np.load(r.paths.v3 / 'armik4_x.npy'))[0]
    except FileNotFoundError:
        pass  # the shoulder point needs the arm STLs; without them Q1-C simply has no lean row
    ang = fk.angles_check(model, coords, T, sh.meta['readout'], gh)
    np.savez(_fit(r) / 'fk_model.npz', **fk.to_npz(model))
    res = dict(frames=rows, fits=model.fits, ranges={k: list(v) for k, v in model.ranges.items()}, angles=ang,
               lumbar_fractions=list(model.lum_f), talus_by=model.talus_by, ankle_axis=list(model.ank_axis))
    write_json(r.out / 'fk.json', res)
    return res


def _fit(r):
    p = r.out / 'fit'
    p.mkdir(parents=True, exist_ok=True)
    return p


def step_rig(r):
    from row.spike import rig
    T, fits = r.rigs
    rigs = [f[0] for f in fits]
    sh = r.sh
    res = dict(main=rig.q2(sh, rigs, T, rig.ODD))
    for row, (cr, ends, cand) in zip(res['main']['curves'], fits):
        row['ends'] = list(ends)
        row['candidates'] = list(cand)
    proxy = [rig.fit_curve(sh, ci, T, train=np.arange(0, 33, 2))[0] for ci in range(len(sh.cv))]
    res['proxy'] = rig.q2(sh, proxy, T, np.arange(33, 41), 'fitted on even i ≤ 32 (S ≤ 0.8), tested on i = 33…40')
    res['proxy'].pop('curves')
    np.savez(_fit(r) / 'rig.npz', **rig.to_npz(rigs))
    write_json(r.out / 'rig.json', res)
    return res


def step_upper(r):
    rows, ur = r.upper
    np.savez(_fit(r) / 'upper_w4.npz', W4=ur.W4, WL4=ur.WL4, keep=ur.keep)
    write_json(r.out / 'upper.json', dict(rows=rows))
    return rows


def step_poses(r):
    from row.spike import armik, collide, engstrom, erg, poses, posing, upper
    from row.spike import curveskin as cs
    from row.spike import rig as rigmod
    root = r.rowing_root()
    sh, ctx = r.sh, r.ctx
    model, coords, T = r.fk
    rigs = [f[0] for f in r.rigs[1]]
    rows_u, ur = r.upper
    tg_all = engstrom.load(root)
    ergt = erg.erg(tg_all.ankle_y, tg_all.handle_y)
    x4 = np.load(r.paths.v3 / 'armik4_x.npy')
    gh = ctx.kin.arm_points(x4)[0]
    setup = poses.make_setup(sh, model, coords, T, ctx.readouts, ergt, gh)
    gp0 = np.load(r.paths.require('v3/girdle_p.npy', 'fixed'))
    base = ctx.base
    topo = posing.topology(sh, base)
    # squat S = 0 baseline (penetration) and the squat's own volume range
    sq0, sq_curves = posing.squat_body(sh, base, topo, 0)
    parts0 = collide.bone_parts(sq0.bones)
    base_d = collide.depths(sq0.sets, parts0)
    baseline = {k: d[0] > collide.DEEP for k, d in base_d.items()}
    base_pen = collide.penetration(sq0.sets, parts0, {'cm': posing.curve_end_exclusion(sh, sq_curves, sq0.sets['cm'][0])},
                                   {}, base_d)
    vref = {k: collide.muscle_volumes(*sq0.sets[k]) for k in sq0.sets}
    wt = {k: collide.watertight_muscles(*sq0.sets[k]) for k in sq0.sets}
    vrange = {k: {m: [0.0, 0.0] for m in vref[k]} for k in vref}
    for i in range(sh.ns):
        b, _ = posing.squat_body(sh, base, topo, i)
        for k in vref:
            for m, vv in collide.muscle_volumes(*b.sets[k]).items():
                dv = 100 * (vv / vref[k][m] - 1)
                lo, hi = vrange[k][m]
                vrange[k][m] = [min(lo, dv), max(hi, dv)]
    control = {}
    sq1, sq1_curves = posing.squat_body(sh, base, topo, sh.ns - 1)
    p1 = collide.bone_parts(sq1.bones)
    control['squat S = 1, shipped'] = collide.penetration(
        sq1.sets, p1, {'cm': posing.curve_end_exclusion(sh, sq1_curves, sq1.sets['cm'][0])}, baseline)
    F1 = dict(sq1.frames)
    rig_curves = rigmod.rig_curves_at(rigs, F1)
    cm1 = cs.skin_curve_set(rig_curves, sh.cv, cs.cm_arrays(sh), sh.meta['LQ'])
    sets1 = dict(sq1.sets)
    sets1['cm'] = (cm1, *sq1.sets['cm'][1:])
    control['squat S = 1, cm by the rig'] = collide.penetration(
        sets1, p1, {'cm': posing.curve_end_exclusion(sh, rig_curves, cm1)}, baseline)
    rect = sh.meta['muscles']
    ra = [i for i, m in enumerate(rect) if m['name'].lower().startswith('rectus abdominis')]
    lb_ra = np.isin(sh.arr['lb_mid'], ra)
    out = dict(targets={}, poses={}, ik={}, pen={}, vol={}, erg=ergt, events=tg_all.events, rules=tg_all.rules,
               names={i: mm['name'] for i, mm in enumerate(sh.meta['muscles'])},
               data=dict(n_subjects=len(ENGSTROM_SUBJECTS), drive_s=tg_all.drive_s, recovery_s=tg_all.recovery_s,
                         knee_peak_subjects=tg_all.knee_peak_subjects, catch_subjects=tg_all.catch_subjects, rfp013_catch=tg_all.rfp013_catch,
                         footplate_rfp013=tg_all.footplate_deg, rcis_travel=float(np.ptp(tg_all.rcis_y)),
                         signs=tg_all.signs, raw_finish={k: float(v[0]) for k, v in tg_all.raw.items()},
                         raw_catch={k: float(v[tg_all.events['catch']]) for k, v in tg_all.raw.items()}),
               baseline=dict(pen=base_pen, deep={k: int(v.sum()) for k, v in baseline.items()}), control=control,
               deep_muscles={}, squat_ik=_squat_ik(ctx, x4))
    bodies = {}
    prev = None
    order = ('catch', 'legs_flat', 'trunk_open', 'finish', 'mid_recovery')
    sols = {}
    for e in order:
        t0 = time.perf_counter()
        tg = engstrom.pose_targets(tg_all, e)
        out['targets'][e] = tg
        Rsc, Rs = ctx.girdle.girdle(poses.girdle_p(gp0, e))
        acr = poses.acromion_rest(base.pr, base.pidr, Rs)
        starts = [poses.start_from(coords, 0), poses.start_from(coords, 40)]
        fixed = poses.solve(setup, tg, acr, starts)
        _, Ff, inf_f = poses.residuals(fixed.x, setup, tg, acr, parts=True)
        sol = poses.solve(setup, tg, acr, starts, free_hip=True)
        _, F, info = poses.residuals(sol.x, setup, tg, acr, parts=True)
        rep = poses.report(setup, sol.x, F, info, tg)
        rep['fixed_hip_z_drift'] = poses.report(setup, fixed.x, Ff, inf_f, tg)['foot_z_drift']
        rep['solve_s'] = time.perf_counter() - t0
        out['poses'][e] = rep
        # arm IK
        arm_e = armik.arm_for_pose(ctx.arm, Rsc, Rs, ergt['handle_r']['value'])
        C0 = ctx.arm.transforms(x4)
        for k in ur.gk:
            C0.setdefault(k, np.eye(4))
        _, lb0 = upper.pose_upper(ur, C0, upper.mt(C0, ctx.arm.Tcur, base.tg))
        body_pts = posing.lb_blend(sh, lb0, F)[lb_ra]
        hip_x = rep['hip_x']
        # at the finish the handle meets the lower ribs, behind the hip centre once the trunk lies back
        xb = (hip_x - HANDLE_X_BACK, hip_x + HANDLE_X_FWD)
        yh = ergt['handle_y']['value']
        if e == 'catch' or prev is None:
            st = armik.cold_starts(x4, hip_x + 0.6, ctx.arm.NV)
            x_warm, kind = x4, 'cold'
        else:
            src = sols['catch'] if e == 'mid_recovery' else prev
            st = [np.r_[src[0], np.clip(src[1], *xb)]]
            x_warm, kind = src[0], 'warm'
        best, runs = armik.solve(arm_e, F['thorax'], yh, tg, st, x_warm, body_pts, xb)
        c, parts, inf = armik.cost_row(best.x, arm_e, F['thorax'], yh, tg, x_warm, body_pts, verbose=True)
        fallback = None
        if kind == 'warm' and not armik.converged(inf, parts, tg):
            # a warm start that does not converge gets the cold start set too; the lower cost wins
            cb, cr = armik.solve(arm_e, F['thorax'], yh, tg, armik.cold_starts(x4, hip_x + 0.6, ctx.arm.NV), x4,
                                 body_pts, xb)
            cc, cp, ci = armik.cost_row(cb.x, arm_e, F['thorax'], yh, tg, x4, body_pts, verbose=True)
            fallback = dict(starts=len(cr), wall=sum(x['wall'] for x in cr), cost=float(cc),
                            converged=bool(armik.converged(ci, cp, tg)), used=bool(cc < c))
            if cc < c:
                best, c, parts, inf, x_warm = cb, cc, cp, ci, x4
                runs = runs + cr
                kind = 'warm, then cold'
            else:
                runs = runs + cr
        knee_pts = np.vstack([posing.apply(F['patella_r'], sh.bone('patella_r')[0]),
                              posing.apply(F['femur_r'], sh.bone('femur_r')[0])])
        ik = dict(start=kind, starts=len(runs), runs=runs, nit=sum(x['nit'] for x in runs), nfev=sum(x['nfev'] for x in runs),
                  wall=sum(x['wall'] for x in runs), cost=float(c), parts={k: float(v) for k, v in parts.items()},
                  info=inf, knee_clear=armik.clearance_to(knee_pts, inf['handle'], arm_e.RB),
                  converged=bool(armik.converged(inf, parts, tg)), fallback=fallback)
        if e == 'mid_recovery':
            cold, cruns = armik.solve(arm_e, F['thorax'], yh, tg, armik.cold_starts(x4, hip_x + 0.6, ctx.arm.NV), x4,
                                      body_pts, xb)
            cc, cp, ci = armik.cost_row(cold.x, arm_e, F['thorax'], yh, tg, x4, body_pts, verbose=True)
            ik['cold_compare'] = dict(starts=len(cruns), wall=sum(x['wall'] for x in cruns), nit=sum(x['nit'] for x in cruns),
                                      nfev=sum(x['nfev'] for x in cruns), cost=float(cc), info=ci,
                                      converged=bool(armik.converged(ci, cp, tg)))
        out['ik'][e] = ik
        sols[e] = (best.x[:-1], best.x[-1])
        prev = sols[e]
        r.log(e, 'pose %.1fs, IK %s %.1fs cost %.4f converged %s' % (rep['solve_s'], kind, ik['wall'], c, ik['converged']))
        # posing, penetration, volumes
        C = arm_e.transforms(best.x[:-1])
        for k in ur.gk:
            C.setdefault(k, np.eye(4))
        MT = upper.mt(C, ctx.arm.Tcur, base.tg)
        body, curves = posing.pose_body(sh, base, topo, F, rigs, ur, C, MT)
        parts_b = collide.bone_parts(body.bones)
        ex = {'cm': posing.curve_end_exclusion(sh, curves, body.sets['cm'][0])}
        D = collide.depths(body.sets, parts_b)
        out['pen'][e] = collide.penetration(body.sets, parts_b, ex, baseline, D)
        out['deep_muscles'][e] = collide.deep_muscles(body.sets, parts_b, ex, baseline, out['names'], D)
        vol = {}
        for k in body.sets:
            vv = collide.muscle_volumes(*body.sets[k])
            vol[k] = {m: dict(v_ref=vref[k][m], v=vv[m], dv=100 * (vv[m] / vref[k][m] - 1), squat=vrange[k][m],
                              method='mesh volume (watertight)' if wt[k][m] else 'centroid proxy')
                      for m in vv if m in vref[k]}
        out['vol'][e] = vol
        bodies[e] = body
        out['poses'][e]['handle'] = inf['handle']
    np.savez_compressed(_fit(r) / 'poses_body.npz', **_pack(bodies, sq0, sh))
    write_json(r.out / 'poses.json', out)
    return out


def _squat_ik(ctx, x4):
    """The squat's own accepted hand, for scale: cost3 parts at armik4_x."""
    c, parts, info = ctx.arm.cost3(x4, True)
    return dict(cost=float(c), parts={k: float(v) for k, v in parts.items()}, elbow=float(info['elbow']))


def _pack(bodies, sq0, sh):
    out = {}
    for e, b in list(bodies.items()) + [('squat_S0', sq0)]:
        for g, (V, F, pid) in b.bones.items():
            out[f'{e}|bone|{g}'] = V.astype(np.float32)
        for k, (V, F, mid) in b.sets.items():
            out[f'{e}|set|{k}'] = V.astype(np.float32)
    return out


def run(paths, step, out, rowing_dir=None, skin_dir=None, renders=True, log=print):
    r = Run(paths, out, rowing_dir, skin_dir, renders, log)
    r.out.mkdir(parents=True, exist_ok=True)
    steps = STEPS_ALL if step == 'all' else (step,)
    if step in ('all', 'poses'):
        r.rowing_root()           # fail fast (exit 5) before any long computation
    if step in ('all', 'skin'):
        r.skin_root()
    tp = r.out / 'timing.json'
    for s in steps:
        if s == 'render' and not renders:
            continue
        t0 = time.perf_counter()
        STEP_FN[s](r)
        dt = time.perf_counter() - t0
        log(f'step {s}: {dt:.1f} s')
        if s != 'report':
            # written per step so that the report step (last in 'all') merges it
            prev = json.loads(tp.read_text(encoding='utf-8')) if tp.is_file() else {}
            write_json(tp, {**prev, s: dt})
    return 0


def step_skin(r):
    from row.spike import skin
    res = skin.run(r.paths, r.skin_root(), r.sh, r.ctx, r, log=r.log)
    write_json(r.out / 'skin.json', res)
    return res


def step_render(r):
    from row.spike import render
    res = render.run(r)
    write_json(r.out / 'render.json', res)
    return res


def step_report(r):
    from row.spike import report
    m = report.merge(r.out)
    write_json(r.out / 'metrics.json', m)
    (r.out / 'report.md').write_text(report.render(m), encoding='utf-8')
    # the same report without the per-muscle volume appendix: short enough for a PR body
    (r.out / 'report-summary.md').write_text(report.render(m, appendix=False), encoding='utf-8')
    return m


STEP_FN = dict(fk=step_fk, rig=step_rig, upper=step_upper, poses=step_poses, skin=step_skin, render=step_render,
               report=step_report)
