"""metrics.json -> report.md: the spike's tables and its computed verdict. Pure: a metrics dict in, text out.

Every number in the report is formatted here from the metrics (mm, °, % to 2 dp, s to 1 dp) or is one of the
threshold constants below. A missing step leaves its tables marked "not run" and the verdict INCOMPLETE.
"""
import json
from pathlib import Path

from row.spike.thresholds import (ATTACH_CM, NOGO_DEEP_MM, NOGO_FRAC_PCT, SKIN_BONE_PCT, SKIN_H_MAX, SKIN_H_MEAN,
                                  SKIN_MED_HI, SKIN_MED_LO, SKIN_MUSCLE_MM, SKIN_MUSCLE_PCT, SKIN_TOL_PCT, SKIN_TRIS,
                                  T_LEN, T_PEN, T_PT_MAX, T_PT_RMS, T_Q1_POS, T_Q1_ROT, T_SIG, T_UP_MAX, T_UP_RMS, T_V_MAX,
                                  T_V_P99, T_VOL, TIER, GRIP_WEIGHT, GRIP_Z, HANDLE_X_BACK, HANDLE_X_FWD,
                                  IK_ELBOW_OK, IK_PEN_OK, LBFGSB_MAXFUN)

HIP_AR_SIGMA = 10                                  # the free-hip prior σ (°), as poses.SIGMA['hip_ar']
THRESHOLDS = (T_Q1_POS, T_Q1_ROT, T_PT_RMS, T_PT_MAX, T_V_P99, T_V_MAX, T_LEN, T_SIG, T_UP_RMS, T_UP_MAX, T_PEN,
              T_VOL, NOGO_DEEP_MM, NOGO_FRAC_PCT, TIER, SKIN_BONE_PCT, SKIN_MUSCLE_PCT, SKIN_MUSCLE_MM, SKIN_MED_LO,
              SKIN_MED_HI, SKIN_TRIS, SKIN_TOL_PCT, SKIN_H_MAX, SKIN_H_MEAN, ATTACH_CM, HIP_AR_SIGMA, IK_PEN_OK,
              IK_ELBOW_OK, GRIP_Z, HANDLE_X_BACK, HANDLE_X_FWD)
CITATION = 'measured, group mean, Engstrom et al. 2023 (n = {n}, Concept2 Model D)'
LABEL_NUMBERS = ('2023', '754', '3.0', '4.0')   # citation year, issue number, BodyParts3D versions
DECISIONS = ('Scott\'s decisions of 2026-11-24: the runtime curve rig is NO-GO, and the tier-2 route for the muscle '
             'paths is an offline via-point and wrapping path generator from the OpenSim models the squat\'s curves '
             'follow, baked per sample; the Q3b penetration and volume thresholds will be re-based on the shipped squat '
             'before later slices use them (the re-based rows below are that proposal, report-only).')
POSES = ('catch', 'legs_flat', 'trunk_open', 'finish', 'mid_recovery')
PARTS = ('fk', 'rig', 'upper', 'poses', 'skin', 'render', 'timing')

HEAD = {
    'Q1-A': ['frame', 'pos max even (mm)', 'pos max odd (mm)', 'pos RMS (mm)', 'bone-vertex max (mm)', 'rot max even (°)',
             'rot max odd (°)', 'rot RMS (°)', 'worst i', 'status'],
    'Q1-B': ['quantity', 'form', 'residual RMS', 'residual max', 'squat range', 'rowing range needed',
             'extrapolation Δ (clamp vs linear)', 'note'],
    'Q1-C': ['angle', 'from frames', 'readout', 'max |diff| (°)'],
    'Q2-A': ['curve', 'ends', 'frames used', 'n', 'δ-rotated', 'point RMS (mm)', 'point max (mm)', 'orient p99 (°)', 'k',
             'sig max err', 'status'],
    'Q2-B': ['metric', 'value', 'threshold', '2×', 'status'],
    'Q2-C': ['muscle', 'max |ΔL|/L (%)', 'max |ΔL| (mm)', 'floor (%)', 'status'],
    'Q3a': ['set', 'vertices', 'rows >4 influences', 'dropped mass max', 'dropped mass mean', 'RMS (mm)', 'max (mm)',
            'threshold', 'status'],
    'Q3-targets': ['pose', 'index (%)', 'rule', 'knee', 'hip', 'ankle', 'spinal Λ', 'trunk Θ', 'elbow', 'shoulder',
                   'handle y'],
    'Q3-poses': ['pose', 'seat x (m)', 'pelvis tilt (°)', 'lumbar λ (°)', 'hip (°)', 'knee (°)', 'ankle (°)',
                 'heel lift (°)', 'shin from vertical (°)', 'trunk Θ model / target', 'lean (°)', 'thorax incl (°)',
                 'closure (mm)', 'seat contact (mm)', 'foot z drift (mm)', 'coords outside squat range'],
    'Q3-IK': ['pose', 'start', 'starts', 'nit', 'nfev', 'wall (s)', 'cost', 'pen', 'snug', 'wrist', 'limits',
              'elbow term', 'grip', 'body', 'elbow (°)', 'plane/elev/er (°)', 'MC3–handle (mm)', 'handle (x, y)',
              'handle–knee clearance (mm)', 'converged'],
    'Q3-pen': ['pose', 'set', 'tested', 'excl. attachment', 'excl. baseline', '>3 mm', 'fraction', 'max depth (mm)',
               '>5 mm fraction', 'raw >5 mm fraction', 'status'],
    'Q3-vol': ['pose', 'muscle', 'set', 'method', 'V_ref (cm³)', 'V (cm³)', 'ΔV (%)', 'squat ΔV range (%)', 'status'],
    'Renders': ['file', 'pose', 'view', 'sha256'],
    'Q4-A': ['step', 'triangles', 'vertices', 'components', 'open edges'],
    'Q4-B': ['bone', 'FMA', 'FJ', 't (mm)', 'rot (°)', 'scale', 'ICP RMS (mm)'],
    'Q4-C': ['surface set', 'registration', 'skin verts inside (n, %)', 'clearance min', 'p1', 'p50 (mm)', 'status'],
}


def merge(out_dir):
    from row import inputs
    out_dir = Path(out_dir)
    m = {'licence': dict(page=inputs.SKIN_LICENCE_PAGE, header=inputs.SKIN_LICENCE_HEADER,
                         treated=inputs.SKIN_LICENCE_TREATED, attribution=inputs.SKIN_ATTRIBUTION)}
    for k in PARTS:
        p = out_dir / f'{k}.json'
        if p.is_file():
            m[k] = json.loads(p.read_text(encoding='utf-8'))
    return m


class Fmt:
    """Formats numbers and remembers every token it produced (the report test checks against these)."""

    def __init__(self):
        self.seen = set()

    def __call__(self, x, dp=2):
        if x is None:
            return 'n/a'
        s = f'{float(x):.{dp}f}'
        self.seen.add(s)
        return s

    def i(self, x):
        s = str(int(x))
        self.seen.add(s)
        return s

    def pct(self, frac, dp=2):
        return self(100 * frac, dp)

    def text(self, s):
        """A string taken from the metrics (a licence line, a message): its numbers count as formatted."""
        import re
        self.seen.update(re.findall(r'\d+(?:\.\d+)?', s))
        return s


def cls(v, tau):
    if v is None:
        return 'MISSING'
    return 'PASS' if v <= tau else ('TIER-2' if v <= TIER * tau else 'FAIL')


def esc(h):
    return h.replace('|', '\\|')


def table(key, rows, head=None):
    h = head or HEAD[key]
    out = ['| ' + ' | '.join(esc(c) for c in h) + ' |', '|' + '---|' * len(h)]
    out += ['| ' + ' | '.join(esc(str(c)) for c in r) + ' |' for r in rows]
    return '\n'.join(out)


def watertight_dv(vol):
    """Max |ΔV| over the muscles measured as closed meshes (the thresholded number), and over the centroid-proxy
    ones (report-only: an open mesh's proxy volume is not a volume)."""
    w = [abs(r['dv']) for s in vol.values() for r in s.values() if r['method'].startswith('mesh volume')]
    p = [abs(r['dv']) for s in vol.values() for r in s.values() if not r['method'].startswith('mesh volume')]
    return (max(w) if w else None), (max(p) if p else None)


def thresholded(m):
    """The verdict's inputs, compactly: every thresholded value as [name, value, tau, ik_not_converged] (value None
    when its step did not run), the kill-rule fractions at the catch and finish, and the poses whose IK failed."""
    out = []
    fk_ = m.get('fk')
    fr = list((fk_ or {}).get('frames', {}).values())
    out.append(['Q1 position, worst frame (mm)', max(max(r['pos_max_even'], r['pos_max_odd']) for r in fr) if fr else None,
                T_Q1_POS, False])
    out.append(['Q1 rotation, worst frame (°)', max(max(r['rot_max_even'], r['rot_max_odd']) for r in fr) if fr else None,
                T_Q1_ROT, False])
    rg = (m.get('rig') or {}).get('main')
    v = (rg or {}).get('vertex', {})
    best = min(v, key=lambda k: v[k]['p99']) if v else None
    out += [['Q2 point RMS (mm)', rg and rg['point_rms'], T_PT_RMS, False],
            ['Q2 point max (mm)', rg and rg['point_max'], T_PT_MAX, False],
            [f'Q2 vertex p99 (mm, variant {best})', best and v[best]['p99'], T_V_P99, False],
            [f'Q2 vertex max (mm, variant {best})', best and v[best]['max'], T_V_MAX, False],
            ['Q2 length max rel err (%)', rg and rg['length_max'], T_LEN, False],
            ['Q2 sig max err', rg and rg['sig_max'], T_SIG, False]]
    up = (m.get('upper') or {}).get('rows')
    for k in ('st kept', 'lb'):
        out += [[f'Q3a {k} RMS (mm)', up and up[k]['rms'], T_UP_RMS, False],
                [f'Q3a {k} max (mm)', up and up[k]['max'], T_UP_MAX, False]]
    ps = m.get('poses') or {}
    nogo, not_conv = {}, []
    for e in POSES:
        have = e in ps.get('pen', {})
        pen = ps['pen'][e]['all']['max_depth'] if have else None
        vol = watertight_dv(ps['vol'][e])[0] if have and e in ps.get('vol', {}) else None
        nc = have and not ps.get('ik', {}).get(e, {}).get('converged', False)
        if nc:
            not_conv.append(e)
        out += [[f'Q3b {e} max penetration (mm)', pen, T_PEN, nc],
                [f'Q3b {e} max |ΔV| (%), watertight muscles', vol, T_VOL, nc]]
        if have and e in ('catch', 'finish'):
            nogo[e] = ps['pen'][e]['all']['nogo_frac']
    return dict(checks=out, nogo=nogo, not_converged=not_conv)


def checks(m):
    """Every thresholded metric: (name, value, tau). None when its step did not run."""
    return [(n, v, t) for n, v, t, _ in thresholded(m)['checks']]


def verdict(m):
    return verdict_from(thresholded(m))


def verdict_from(th):
    cs = []
    for n, v, t, nc in th['checks']:
        cs.append((n + (' [IK not converged]' if nc else ''), v, t, 'MISSING' if nc else cls(v, t)))
    rule = [e for e, frac in th['nogo'].items() if frac * 100 > NOGO_FRAC_PCT]
    missing = [n for n, v, t, c in cs if c == 'MISSING']
    fails = [n for n, v, t, c in cs if c == 'FAIL']
    tier = [n for n, v, t, c in cs if c == 'TIER-2']
    if fails or rule:
        v = 'NO-GO'
    elif missing:
        v = 'INCOMPLETE'
    elif tier:
        v = 'TIER-2'
    else:
        v = 'GO (pending Scott\'s render sign-off)'
    return dict(verdict=v, checks=cs, fails=fails, tier2=tier, missing=missing, not_converged=th['not_converged'],
                nogo_rule=rule)


def render(m, appendix=True):
    return render_with_tokens(m, appendix)[0]


def render_with_tokens(m, appendix=True):
    f = Fmt()
    vd = verdict(m)
    L = ['# #754 rowing re-rig feasibility spike: report', '',
         'Generated by `python -m row spike report` from `metrics.json`. Thresholds are constants in '
         '`row/spike/thresholds.py`; every pose, angle and volume below is modelled unless it says measured.', '']
    L += [f'**VERDICT: {vd["verdict"]}**', '']
    sk = (m.get('skin') or {}).get('verdict')
    if sk:
        L += [f'**SKIN: {sk["verdict"]}**, {f.i(sk["tris"])} triangles for the right half at budget.', '']
    if vd['fails']:
        L.append('FAIL (beyond twice the threshold): ' + '; '.join(vd['fails']) + '.')
    if vd['nogo_rule']:
        L.append('Kill rule triggered (more than the limit of vertices deep in bone) at: ' + ', '.join(vd['nogo_rule']) + '.')
        ps_ = m.get('poses') or {}
        for e in vd['nogo_rule']:
            if e in vd['not_converged'] and 'cm' in ps_.get('pen', {}).get(e, {}):
                L.append(f'The kill rule fires at the {e} although its arm IK did not converge; the leg and hip muscles '
                         f'(the cm set, which the arm does not move) alone have {f.pct(ps_["pen"][e]["cm"]["nogo_frac"])} % '
                         f'of their vertices more than {NOGO_DEEP_MM} mm inside bone, which would fire it on its own.')
    if vd['tier2']:
        L.append('TIER-2 (within twice the threshold): ' + '; '.join(vd['tier2']) + '. A baked fallback covers only the '
                 'Q2 metrics; a Q1 or Q3 tier-2 needs Scott.')
    L.append(f.text(DECISIONS))
    if vd['missing']:
        L.append('Missing (step not run or IK not converged): ' + '; '.join(vd['missing']) + '.')
    ctl = ((m.get('poses') or {}).get('control') or {}).get('squat S = 1, shipped')
    if ctl:
        L.append(f'Control: the squat as shipped, at its deepest sample, under the same rules: '
                 f'{f.pct(ctl["all"]["nogo_frac"])} % of vertices more than {NOGO_DEEP_MM} mm inside bone, max depth '
                 f'{f(ctl["all"]["max_depth"])} mm.')
    L += ['', table('Q2-B', [(n, f(v, 4 if 'sig' in n else 2), f(t, 4 if 'sig' in n else 2),
                              f(TIER * t, 4 if 'sig' in n else 2), c) for n, v, t, c in vd['checks']],
                    head=['metric', 'value', 'threshold', '2×', 'status']), '']
    L += _q1(m, f) + _q2(m, f) + _q3(m, f, appendix) + _q4(m, f)
    return '\n'.join(L) + '\n', f.seen | {f'{t:g}' for t in THRESHOLDS} | set(LABEL_NUMBERS)


def _q1(m, f):
    L = ['## Q1: joint model (frames3 regenerated from a fitted FK model)', '']
    fk_ = m.get('fk')
    if not fk_:
        return L + ['Q1: not run.', '']
    rows = []
    for n, r in fk_['frames'].items():
        st = max(cls(max(r['pos_max_even'], r['pos_max_odd']), T_Q1_POS), cls(max(r['rot_max_even'], r['rot_max_odd']), T_Q1_ROT),
                 key=['PASS', 'TIER-2', 'FAIL'].index)
        rows.append((n, f(r['pos_max_even']), f(r['pos_max_odd']), f(r['pos_rms']), f(r['bone_max']), f(r['rot_max_even']),
                     f(r['rot_max_odd']), f(r['rot_rms']), f.i(r['worst_i']), st))
    L += ['### Q1-A', '', table('Q1-A', rows), '']
    need = _needed(m)
    unc = _unc(m, f)
    coord = {'hip centre (constant)': 'hip', 'hip centre (quadratic)': 'hip', 'knee translation': 'knee',
             'knee rotation': 'knee', 'patella translation': 'knee', 'patella rotation': 'knee',
             'ankle axis (off-axis)': 'ankle', 'talus origin vs ankle': 'ankle', 'talus origin vs knee': 'knee',
             'subtalar block B(α)': 'ankle'}
    rows = []
    rng = fk_['ranges']
    for q, r in fk_['fits'].items():
        c = coord.get(q)
        lo, hi = rng[c] if c else (None, None)
        nd = need.get(c)
        rows.append((q, r['form'], f'{f(r["rms"])} {r["unit"]}', f'{f(r["max"])} {r["unit"]}',
                     f'{f(lo)} – {f(hi)}' if c else '', f'{f(nd[0])} – {f(nd[1])}' if nd else 'not run',
                     unc.get(q, '') if nd else '', 'odd-sample RMS ' + f(r['rms_odd']) + ' ' + r['unit']))
    lf = fk_['lumbar_fractions']
    lo, hi = rng['lumbar']
    nd = need.get('lumbar')
    rows.append(('lumbar split', 'z rotations through fitted centres, fractions ' + ' / '.join(f(x) for x in lf),
                 f'{f(fk_["frames"]["L1"]["pos_rms"])} mm', f'{f(fk_["frames"]["L1"]["pos_max_odd"])} mm',
                 f'{f(lo)} – {f(hi)}', f'{f(nd[0])} – {f(nd[1])}' if nd else 'not run',
                 'unchanged fractions and centres (no clamp)', 'all spinal flexion in L5–L1 (A6)'))
    L += ['### Q1-B', '', 'Ranges in degrees (hip: intrinsic ZXY flexion; ankle: α about the fitted axis).', '',
          table('Q1-B', rows), '']
    rows = [(k, f'{f(a["range"][0])} – {f(a["range"][1])} ({a["note"]}; offset {f(a["offset"])})',
             f'{f(a["ro_range"][0])} – {f(a["ro_range"][1])}' if 'ro_range' in a else 'readout', f(a['max_diff']))
            for k, a in fk_['angles'].items()]
    L += ['### Q1-C', '', 'max |diff| after removing the constant offset shown.', '', table('Q1-C', rows), '']
    return L


def _needed(m):
    ps = (m.get('poses') or {}).get('poses')
    fk_ = m.get('fk')
    if not ps or not fk_:
        return {}
    vals = {'knee': [], 'hip': [], 'ankle': [], 'lumbar': []}
    for e in POSES:
        if e not in ps:
            continue
        p = ps[e]
        vals['knee'].append(p['knee'])
        vals['hip'].append(p['hip'])
        vals['ankle'].append(p['u'][5])
        vals['lumbar'].append(p['lumbar'])
    return {k: (min(v), max(v)) for k, v in vals.items() if v}


def _unc(m, f):
    ps = (m.get('poses') or {}).get('poses') or {}
    best = {}
    for e in POSES:
        for o in ps.get(e, {}).get('outside', []):
            for q, (val, unit) in o['unc'].items():
                key = {'hip centre (linear vs quadratic)': 'hip centre (quadratic)', 'talus origin': 'talus origin vs ankle',
                       'subtalar translation': 'subtalar block B(α)'}.get(q, q)
                if key not in best or val > best[key][0]:
                    best[key] = (val, unit, e)
    return {k: f'{f(v)} {u} ({e})' for k, (v, u, e) in best.items()}


def _q2(m, f):
    L = ['## Q2: curve rig (each curve a blend over up to three frames; even samples fit, odd samples judged)', '']
    rg = m.get('rig')
    if not rg:
        return L + ['Q2: not run.', '']
    g = rg['main']
    L += [f'{f.i(len(g["curves"]))} curves.', '']
    rows = []
    for c in g['curves']:
        st = max(cls(c['point_rms'], T_PT_RMS), cls(c['point_max'], T_PT_MAX), key=['PASS', 'TIER-2', 'FAIL'].index)
        rows.append((f.i(c['curve']), ' → '.join(c['ends']), ', '.join(c['frames']), f.i(c['n']),
                     'yes' if c['delta_rotated'] else 'no', f(c['point_rms']), f(c['point_max']), f(c['orient_p99']),
                     f(c['k'], 3), f(c['sig_max_err'], 4), st))
    L += ['### Q2-A', '', table('Q2-A', rows), '']
    L += ['### Q2-B', '', table('Q2-B', _q2b(g, f)), '',
          'Diagnostics: training (even-sample) point RMS is ' + _train_note(g, f) + ', so the misses are model '
          'capacity (a per-point frame blend cannot follow paths that wrap over the knee or slide over the hip), not '
          'over-fitting. The sig rule on the shipped curve length misses by at most ' +
          f(max(c['sig_err_shipped_L'] for c in g['curves']), 4) + ' (F5); on the rig length by ' + f(g['sig_max'], 4) + '.', '']
    rows = [(r['name'], f(r['rel']), f(r['abs_mm']), f(r['floor']), cls(r['rel'], T_LEN)) for r in g['muscles']]
    n_pass = sum(1 for r in g['muscles'] if r['rel'] <= T_LEN)
    L += ['### Q2-C', '', f'{f.i(n_pass)} of {f.i(len(g["muscles"]))} muscles within the threshold; floor = the '
          'shipped (quantised) curves against mlen3.', '', table('Q2-C', rows), '']
    L += ['### Q2-D (extrapolation proxy, report-only)', '', rg['proxy']['note'] + '. The only pre-pose evidence about '
          'extrapolation.', '', table('Q2-B', _q2b(rg['proxy'], f)), '']
    return L


def _train_note(g, f):
    tr = [c['train_rms'] for c in g['curves']]
    te = [c['point_rms'] for c in g['curves']]
    return f'{f(sum(tr) / len(tr))} mm mean per curve against {f(sum(te) / len(te))} mm on the odd samples'


def _q2b(g, f):
    rows = [('point RMS (mm)', g['point_rms'], T_PT_RMS), ('point max (mm)', g['point_max'], T_PT_MAX)]
    for var in sorted(g['vertex']):
        rows += [(f'vertex p99 (mm), variant {var}', g['vertex'][var]['p99'], T_V_P99),
                 (f'vertex max (mm), variant {var}', g['vertex'][var]['max'], T_V_MAX)]
    rows += [('length max rel err (%)', g['length_max'], T_LEN), ('sig max err', g['sig_max'], T_SIG)]
    return [(n, f(v, 4 if 'sig' in n else 2), f(t, 4 if 'sig' in n else 2), f(TIER * t, 4 if 'sig' in n else 2), cls(v, t))
            for n, v, t in rows]


def _q3(m, f, appendix=True):
    L = ['## Q3: upper body and five rowing poses', '']
    up = (m.get('upper') or {}).get('rows')
    if up:
        rows = []
        for k, r in up.items():
            thr = r.get('thresholded')
            st = r.get('status') or (max(cls(r['rms'], T_UP_RMS), cls(r['max'], T_UP_MAX), key=['PASS', 'TIER-2', 'FAIL'].index)
                                     if thr else 'report-only')
            rows.append((k, f.i(r['vertices']), f.i(r['rows_gt4']) if 'rows_gt4' in r else '',
                         f(r['dropped_max'], 4) if 'dropped_max' in r else '', f(r['dropped_mean'], 4) if 'dropped_mean' in r else '',
                         f(r['rms'], 4) if r.get('rms') is not None else 'n/a', f(r['max'], 4) if r.get('max') is not None else 'n/a',
                         f'RMS ≤ {T_UP_RMS:g}, max ≤ {T_UP_MAX:g}' if thr else '', st))
        L += ['### Q3a', '', table('Q3a', rows), '']
    else:
        L += ['Q3a: not run.', '']
    ps = m.get('poses')
    if not ps:
        return L + ['Q3b: not run.', '']
    n = ps['data']['n_subjects']
    rows = []
    for e in POSES:
        t = ps['targets'][e]
        rows.append((e, f.i(t['index']), ps['rules'][e], f(t['knee']), f(t['hip']), f(t['ankle']), f(t['spinal']),
                     f(t['theta']), f(t['elbow']), f(t['shoulder']), f(t['handle_y'], 3)))
    d = ps['data']
    L += ['### Q3-targets', '', CITATION.format(n=f.i(n)) + '; trunk Θ and the handle height from one subject (RFP013). '
          f'Drive {f(d["drive_s"], 2)} s, recovery {f(d["recovery_s"], 2)} s; mean of the subjects\' peak knee flexion '
          f'{f(d["knee_peak_subjects"])}° at index {f(d["catch_subjects"], 1)}; RFP013\'s own catch (wrist furthest '
          f'toward the flywheel) at index {f.i(d["rfp013_catch"])}; RFP013 footplate line {f(d["footplate_rfp013"])}° '
          f'against the {f(ps["erg"]["footplate_deg"]["value"])}° used; RFP013 iliac-crest travel {f(d["rcis_travel"], 3)} m.',
          '', table('Q3-targets', rows), '']
    rows = []
    rng = (m.get('fk') or {}).get('ranges', {})
    hip_rows = []
    for e in POSES:
        p = ps['poses'][e]
        outside = [(o['coord'], o['value'], o['beyond']) for o in p['outside']
                   if o['coord'] not in ('hip_add', 'hip_rot')]
        for key, name in (('hip_add', 'hip adduction'), ('hip_rot', 'hip rotation')):
            if key in p and key in rng:
                lo, hi = rng[key]
                dd = p[key] - hi if p[key] > hi else (p[key] - lo if p[key] < lo else 0.0)
                if dd:
                    outside.append((name, p[key], dd))
        if 'hip_add' in p:
            hip_rows.append((e, f(p['hip_add']), f(p['hip_rot']),
                             f'{f(rng["hip_add"][0])} – {f(rng["hip_add"][1])}' if 'hip_add' in rng else 'n/a',
                             f'{f(rng["hip_rot"][0])} – {f(rng["hip_rot"][1])}' if 'hip_rot' in rng else 'n/a'))
        out = '; '.join(f'{c} {f(v)} ({"+" if b > 0 else ""}{f(b)})' for c, v, b in outside) or 'none'
        rows.append((e, f(p['seat_x'], 3), f(p['pelvis_tilt']), f(p['lumbar']), f(p['hip']), f(p['knee']), f(p['ankle']),
                     f(p['heel_lift']), f(p['shin_from_vertical']), f'{f(p["theta_model"])} / {f(p["theta_target"])}',
                     f(p['lean']), f(p['thorax_incl']), f(p['closure']), f(p['seat']), f(p['foot_z_drift']), out))
    travel = ps['poses']['finish']['hip_x'] - ps['poses']['catch']['hip_x']
    L += ['### Q3-poses (modelled)', '', f'Solved with hip adduction and rotation free (soft, σ {HIP_AR_SIGMA}° about the squat\'s '
          'standing values) and the talus held in its footplate plane; the spec\'s fixed-hip solve drifts the foot '
          'out of plane by ' + ', '.join(f'{e} {f(ps["poses"][e]["fixed_hip_z_drift"])}' for e in POSES) + ' mm. '
          f'Hip-centre travel catch → finish {f(abs(travel), 3)} m against RFP013\'s iliac crest '
          f'{f(d["rcis_travel"], 3)} m ({f(100 * (1 - abs(travel) / d["rcis_travel"]), 0)} % short). '
          'Pelvis tilt is a world rotation: the rig is invariant to it.', '', table('Q3-poses', rows), '']
    if hip_rows:
        L += ['Hip adduction and rotation of the free-hip solve (report-only), against the squat\'s own range:', '',
              table('', hip_rows, head=['pose', 'hip adduction (°)', 'hip rotation (°)', 'squat adduction range (°)',
                                        'squat rotation range (°)']), '']
    rows = []
    for e in POSES:
        k = ps['ik'][e]
        pt, inf = k['parts'], k['info']
        rows.append((e, k['start'], f.i(len(k['runs']) if k.get('runs') else k['starts']), f.i(k['nit']), f.i(k['nfev']), f(k['wall'], 1), f(k['cost'], 4),
                     f(pt['pen'], 4), f(pt['snug'], 4), f(pt['wrist'], 4), f(pt['limits'], 4), f(pt['elbow'], 4),
                     f(pt['grip'], 4), f(pt['body'], 4), f(inf['elbow']), f'{f(inf["plane"])} / {f(inf["elev"])} / {f(inf["er"])}',
                     f(inf['mc3_axis']), f'({f(inf["handle"][0], 3)}, {f(inf["handle"][1], 3)})',
                     f(k['knee_clear']), 'yes' if k['converged'] else 'IK not converged'))
        if 'cold_compare' in k:
            c = k['cold_compare']
            rows.append((e, 'cold (comparison)', f.i(c['starts']), f.i(c['nit']), f.i(c['nfev']), f(c['wall'], 1),
                         f(c['cost'], 4), '', '', '', '', '', '', '', f(c['info']['elbow']),
                         f'{f(c["info"]["plane"])} / {f(c["info"]["elev"])} / {f(c["info"]["er"])}',
                         f(c['info']['mc3_axis']), f'({f(c["info"]["handle"][0], 3)}, {f(c["info"]["handle"][1], 3)})', '',
                         'yes' if c['converged'] else 'IK not converged'))
    note = [f'Wall time is the sum over starts (`time.perf_counter` per minimize). "Converged" is a penalty-level '
            f'label, not an optimiser status: penetration term ≤ {f(IK_PEN_OK, 4)} and elbow within {f(IK_ELBOW_OK, 0)}° '
            f'of the data.']
    sq = ps.get('squat_ik')
    if sq:
        sq_pen = sq['parts']['pen']
        n_strict = sum(1 for e in POSES if ps['ik'][e]['parts']['pen'] <= sq_pen
                       and abs(ps['ik'][e]['info']['elbow'] - ps['targets'][e]['elbow']) <= IK_ELBOW_OK)
        note.append(f'The squat\'s own hand (cost3 at armik4_x): penetration term {f(sq_pen, 4)}, snug '
                    f'{f(sq["parts"]["snug"], 4)}, wrist {f(sq["parts"]["wrist"], 4)}; at that level {f.i(n_strict)} '
                    f'of {f.i(len(POSES))} poses would count as converged.')
    runs = [(e, i, r) for e in POSES for i, r in enumerate(ps['ik'][e].get('runs', []))]
    capped = [(e, i, r) for e, i, r in runs if r['nfev'] > LBFGSB_MAXFUN]
    if runs:
        warm = [r['wall'] for e, i, r in capped if ps['ik'][e]['start'].startswith('warm') and i == 0]
        note.append(f'{f.i(len(capped))} of {f.i(len(runs))} minimize runs stopped at L-BFGS-B\'s default evaluation cap '
                    f'(maxfun {f.i(LBFGSB_MAXFUN)}; with finite-difference gradients each iteration costs about '
                    f'{f(sum(r["nfev"] for _, _, r in runs) / max(1, sum(r["nit"] for _, _, r in runs)), 0)} evaluations), so they ended on the cap, not on a tolerance'
                    + (f'; the warm solves\' {f(min(warm), 1)}–{f(max(warm), 1)} s is the cap\'s cost.' if warm else '.'))
    for e in POSES:
        fb = ps['ik'][e].get('fallback')
        if fb:
            note.append(f'{e}: the warm start did not converge, so the cold start set ran too ({f.i(fb["starts"])} '
                        f'starts, {f(fb["wall"], 1)} s, cost {f(fb["cost"], 4)}, '
                        f'{"used" if fb["used"] else "not better"}).')
    L += ['### Q3-IK', '', ' '.join(note), '', table('Q3-IK', rows), '']
    L += _ik_failures(ps, f)
    if runs:
        rr = [(e, f.i(i + 1), f.i(r['nit']), f.i(r['nfev']), f(r['wall'], 1), f(r['cost'], 4),
               f.text(r['message']) if r.get('message') else
               ('evaluation cap (inferred: nfev > maxfun)' if r['nfev'] > LBFGSB_MAXFUN else 'not recorded'))
              for e, i, r in runs]
        L += ['Every minimize run (report-only):', '',
              table('', rr, head=['pose', 'run', 'nit', 'nfev', 'wall (s)', 'cost', 'stop']), '']
    rows = []
    for e in POSES:
        for s, r in ps['pen'][e].items():
            st = cls(r['max_depth'], T_PEN) if s == 'all' else ''
            if s == 'all' and e in ('catch', 'finish') and r['nogo_frac'] * 100 > NOGO_FRAC_PCT:
                st += ' (kill rule)'
            rows.append((e, s, f.i(r['tested']), f.i(r['excl_attach']), f.i(r['excl_baseline']), f.i(r['deep']),
                         f.pct(r['frac']) + ' %', f(r['max_depth']), f.pct(r['nogo_frac']) + ' %',
                         f.pct(r['raw_nogo_frac']) + ' %', st))
    for name, ctl in ps.get('control', {}).items():
        for s_, r in ctl.items():
            rows.append((f'control: {name}', s_, f.i(r['tested']), f.i(r['excl_attach']), f.i(r['excl_baseline']),
                         f.i(r['deep']), f.pct(r['frac']) + ' %', f(r['max_depth']), f.pct(r['nogo_frac']) + ' %',
                         f.pct(r['raw_nogo_frac']) + ' %', cls(r['max_depth'], T_PEN) + ' (control)' if s_ == 'all' else ''))
    b = ps['baseline']
    L += ['### Q3-pen', '', f'Exclusions: cm vertices within {ATTACH_CM} cm of a bound curve end (attachment) and every vertex '
          f'already more than {T_PEN:g} mm inside bone in the squat\'s own standing pose (baseline: ' +
          ', '.join(f'{k} {f.i(v)}' for k, v in b['deep'].items()) + '). The control rows pose the squat\'s own '
          'deepest sample under the same rules: as shipped, and with its cm through the rig.', '', table('Q3-pen', rows), '']
    L += _rebased_pen(ps, f)
    dm = ps.get('deep_muscles', {})
    if dm:
        L += [f'Muscles with the most vertices more than {NOGO_DEEP_MM} mm inside bone, after the exclusions:', '']
        for e in POSES:
            L.append(f'- {e}: ' + '; '.join(f'{r["muscle"]} ({r["set"]}) {f.i(r["n"])}, max {f(r["max_depth"])} mm '
                                            f'in {r["bone"]}' for r in dm.get(e, [])))
        L.append('')
    vrows, summary = [], []
    for e in POSES:
        n_w = n_p = n_rb = 0
        for s_, mus in ps['vol'][e].items():
            for mid, r in mus.items():
                wt = r['method'].startswith('mesh volume')
                bad = abs(r['dv']) > T_VOL
                n_w += bad and wt
                n_p += bad and not wt
                n_rb += wt and not (r['squat'][0] - T_VOL <= r['dv'] <= r['squat'][1] + T_VOL)
                vrows.append((abs(r['dv']), e, mid, s_, r))
        summary.append(f'{e} {f.i(n_w)} watertight (re-based: {f.i(n_rb)}) and {f.i(n_p)} proxy')
    names = ps.get('names', {})

    def vrow(e, mid, s_, r):
        return (e, names.get(str(mid), mid), s_, r['method'], f(r['v_ref'] * 1e6), f(r['v'] * 1e6), f(r['dv']),
                f'{f(r["squat"][0])} – {f(r["squat"][1])}',
                cls(abs(r['dv']), T_VOL) if r['method'].startswith('mesh volume') else 'proxy, report-only')
    key = lambda x: (-x[0], x[1], str(x[2]), x[3])
    worst_w = sorted((v for v in vrows if v[4]['method'].startswith('mesh volume')), key=key)[:10]
    worst_p = sorted((v for v in vrows if not v[4]['method'].startswith('mesh volume')), key=key)[:5]
    L += ['### Q3-vol', '', f'The thresholded max |ΔV| uses the muscles measured as closed meshes only; an open mesh\'s '
          f'centroid proxy is not a volume and is reported separately. Muscles outside ±{T_VOL:g} % per pose: '
          + ', '.join(summary) + f'. "Re-based" (a proposal for later slices, report-only, not the verdict) counts the '
          f'watertight muscles outside their own squat range widened by {T_VOL:g} points. The ten worst watertight:', '',
          table('Q3-vol', [vrow(*w[1:]) for w in worst_w]), '', 'The five worst centroid-proxy rows (report-only):', '',
          table('Q3-vol', [vrow(*w[1:]) for w in worst_p]), '']
    rd = m.get('render')
    if rd:
        L += ['### Renders', '', rd.get('note', ''), '',
              table('Renders', [(x['file'], x['pose'], x['view'], x['sha256']) for x in rd['files']]), '']
    else:
        L += ['Renders: not run (matplotlib missing or --no-renders).', '']
    if appendix:
        L += ['### Appendix: Q3-vol, every muscle', '',
              table('Q3-vol', [vrow(*w[1:]) for w in sorted(vrows, key=lambda x: (x[1], x[3], str(x[2])))]), '']
    else:
        L += ['The appendix (Q3-vol, every muscle) is in the full report.md.', '']
    return L


def _rebased_pen(ps, f):
    """Report-only: Q3-pen re-based on the shipped squat (a proposal for later slices, not the verdict). Legs (cm)
    against the squat's own worst sample, upper body (st, lb) against the issue's 3 mm."""
    ctl = (ps.get('control') or {}).get('squat S = 1, shipped')
    if not ctl or 'cm' not in ctl:
        return []
    lim_max, lim_frac = ctl['cm']['max_depth'], ctl['cm']['nogo_frac']
    rows = []
    for e in POSES:
        pen = ps['pen'][e]
        legs = pen['cm']
        legs_ok = legs['max_depth'] <= lim_max and legs['nogo_frac'] <= lim_frac
        up = max((pen[k]['max_depth'] for k in ('st', 'lb') if k in pen), default=None)
        rows.append((e, f(legs['max_depth']), f.pct(legs['nogo_frac']) + ' %', 'PASS' if legs_ok else 'FAIL', f(up),
                     'n/a' if up is None else ('PASS' if up <= T_PEN else 'FAIL')))
    return [f'Re-based on the shipped squat (report-only; a proposal for later slices, not the verdict): legs (cm) '
            f'pass at max depth ≤ {f(lim_max)} mm and > {NOGO_DEEP_MM} mm fraction ≤ {f.pct(lim_frac)} %, the shipped '
            f'squat\'s own worst sample; the upper body (st, lb) at ≤ {T_PEN:g} mm.', '',
            table('', rows, head=['pose', 'legs max depth (mm)', 'legs > 5 mm fraction', 'legs re-based',
                                  'upper body max depth (mm)', 'upper body re-based']), '']


def _ik_failures(ps, f):
    """For each pose whose IK did not converge: the cost term that dominates, the shoulder target against the solve,
    and where the handle ended up relative to the hip centre and the body."""
    out = []
    for e in POSES:
        k = ps['ik'][e]
        if k['converged']:
            continue
        pt, inf = k['parts'], k['info']
        big = max(pt, key=pt.get)
        t = ps['targets'][e]
        hip_x = ps['poses'][e]['hip_x']
        hx = inf['handle'][0]
        line = (f'- {e}: the largest cost term is {big} ({f(pt[big], 2)} of {f(k["cost"], 2)}); shoulder target '
                f'{f(t["shoulder"], 1)}°, solved {f(inf["shoulder"], 1)}° (shoulder term {f(pt["shoulder"], 2)}); penetration '
                f'term {f(pt["pen"], 4)}; grip term {f(pt["grip"], 2)}, i.e. the hand is '
                f'{f((pt["grip"] / GRIP_WEIGHT) ** 0.5, 2)} m off the {f(GRIP_Z, 2)} m grip width.')
        if hx < hip_x:
            line += (f' The handle axis is at x {f(hx, 3)} m, {f(hip_x - hx, 3)} m behind the hip centre ({f(hip_x, 3)} m) '
                     f'and {f(inf["body_d"], 0)} mm from the nearest rectus-abdominis vertex: the body term measures an '
                     f'unsigned distance, so a handle inside the trunk also scores 0. The handle\'s lower bound is the hip '
                     f'centre − {f(HANDLE_X_BACK, 1)} m (the spec said pelvis x).')
        out.append(line)
    if out:
        out = ['Where the unconverged poses fail:', ''] + out + ['']
    return out


def _q4(m, f):
    L = ['## Q4: skin source (BodyParts3D 4.0 FJ2810)', '']
    sk = m.get('skin')
    if not sk:
        return L + ['Q4: not run.', '']
    lic = m.get('licence')
    if lic:
        L += [f.text(f'Licence: {lic["page"]}; {lic["header"]}; treated as {lic["treated"]}. Attribution: '
                     f'"{lic["attribution"]}".'), '']
    rows = [(s['step'], f.i(s['tris']), f.i(s['verts']), f.i(s['comps']) if s['comps'] is not None else '', f.i(s['open']))
            for s in sk['steps']]
    for name, v in sk['variants'].items():
        d = v['decimate']
        rows.append((f'right half ({name})', f.i(d['half_tris']), '', '', f.i(d['half_open']) + ' (the mid-plane seam)'))
        rows.append((f'decimated ({name}); Hausdorff max {f(d["hausdorff_max"])} mm, mean {f(d["hausdorff_mean"])} mm',
                     f.i(d['tris']), f.i(d['verts']), '',
                     f.i(d['dec_open']) + (f' ({f.i(d["dec_open_off_seam"])} off the seam)' if 'dec_open_off_seam' in d else '')))
    hl = sk.get('header', {}).get('licence_line', '')
    L += ['### Q4-A', '', table('Q4-A', rows), '',
          'Components: ' + '; '.join(f'{f.i(c["faces"])} faces, area {f(c["area"] / 1e6, 2)} m², signed volume '
                                     f'{f(c["volume"] / 1e9, 4)} m³' for c in sk['components'][:6]) + '.', '']
    if hl:
        L += [f.text('The OBJ files\' own header reads: "' + hl + '"'), '']
    rows = [(r['bone'], r['fma'], r['fj'] + (f' ({r["fj_fma"]})' if r.get('fj_fma') else ''), f(r['t']), f(r['rot']),
             f(r['scale'], 4), f(r['icp_rms'])) for r in sk['registration']]
    L += ['### Q4-B', '', 'Each 4.0 bone registered onto its 3.0 counterpart by trimmed ICP, scale fixed; t is the '
          'displacement of the bone centroid. Rigid holds when every bone is within 2 mm and 1°: '
          + ('yes.' if sk['rigid'] else 'no, so the skin is also warped (thin-plate RBF from the bone fields).'), '',
          table('Q4-B', rows), '']
    rows = []
    for name, v in sk['variants'].items():
        for s, r in v['clearance'].items():
            if s == 'nearest bone or muscle':
                st = 'PASS' if SKIN_MED_LO <= r['p50'] <= SKIN_MED_HI else 'FAIL'
                rows.append((s, name, '', f(r['min']), f(r['p1']), f(r['p50']), st))
                continue
            lim = SKIN_BONE_PCT if s == 'bones' else SKIN_MUSCLE_PCT
            rows.append((s, name, f'{f.i(r["inside"])}, {f(r["inside_pct"])} %', f(r['min']), f(r['p1']), f(r['p50']),
                         'PASS' if r['inside_pct'] <= lim else 'FAIL'))
    where = []
    for name, v in sk['variants'].items():
        for s_, r in v['clearance'].items():
            if r.get('where'):
                where.append(f'- {name}, {s_}: ' + ', '.join(f'{n} {f.i(c)}' for n, c in r['where']))
    L += ['### Q4-C', '', f'Skin = the decimated right half; inside a muscle counts only beyond {SKIN_MUSCLE_MM} mm.', '',
          table('Q4-C', rows), '', 'Where the skin vertices that are inside sit (the parts holding most of them):', '']
    L += where + ['',
          f'**SKIN: {sk["verdict"]["verdict"]}**, {f.i(sk["verdict"]["tris"])} triangles (right half; mirrored for the left).', '']
    return L
