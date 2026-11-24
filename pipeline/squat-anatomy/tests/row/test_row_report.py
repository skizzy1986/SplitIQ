"""report.py: every table header verbatim, the five verdict cases, byte-identical reruns, no stray numbers."""
import copy
import json
import re
from pathlib import Path

import pytest

from row.spike import report as rp

POSES = rp.POSES


def metrics(scale=0.5):
    """A complete synthetic metrics dict; every thresholded value is scale × its threshold."""
    fr = dict(pos_max_even=scale * rp.T_Q1_POS, pos_max_odd=0.1, pos_rms=0.05, bone_max=0.2,
              rot_max_even=scale * rp.T_Q1_ROT, rot_max_odd=0.01, rot_rms=0.01, worst_i=3)
    fit = dict(unit='mm', form='spline', rms=0.01, max=0.02, rms_odd=0.01, max_odd=0.02)
    fk = dict(frames={'femur_r': dict(fr), 'L1': dict(fr)}, fits={'knee translation': fit, 'hip centre (quadratic)': fit},
              ranges=dict(knee=[3, 131], hip=[3.1, 119], ankle=[0, 31], lumbar=[0, 15], pelvis_tilt=[-25, -8]),
              angles={'knee': dict(offset=0.0, max_diff=0.01, max_raw=0.01, range=[3, 131], ro_range=[3, 131], note='readout')},
              lumbar_fractions=[0.3, 0.25, 0.2, 0.15, 0.1], talus_by='ankle', ankle_axis=[0, 0, 1])
    curve = dict(curve=0, ends=['pelvis_rest', 'femur_r'], frames=['femur_r', 'pelvis_rest'], n=25, point_rms=0.4,
                 point_max=1.1, orient_rms=1.0, orient_p99=2.0, orient_max=3.0, k=0.5, sig_max_err=0.001,
                 sig_err_shipped_L=0.0012, delta_rotated=True, train_rms=0.35, candidates=['pelvis_rest', 'femur_r'])
    q2 = dict(curves=[curve], point_rms=scale * rp.T_PT_RMS, point_max=scale * rp.T_PT_MAX,
              vertex={'A': dict(p99=scale * rp.T_V_P99, max=scale * rp.T_V_MAX, mean=0.3),
                      'B': dict(p99=scale * rp.T_V_P99 + 0.25, max=scale * rp.T_V_MAX, mean=0.3)},
              length_max=scale * rp.T_LEN, length_floor=0.01, sig_max=scale * rp.T_SIG, test=[1, 3],
              muscles=[dict(muscle=0, name='Gluteus maximus', rel=0.1, abs_mm=0.3, floor=0.01)], note='')
    proxy = {k: v for k, v in copy.deepcopy(q2).items() if k != 'curves'}
    proxy['note'] = 'fitted on even i ≤ 32'
    up = dict(rows={'st kept': dict(vertices=100, rms=scale * rp.T_UP_RMS, max=scale * rp.T_UP_MAX, rows_gt4=3,
                                    dropped_max=0.04, dropped_mean=0.001, thresholded=True),
                    'lb': dict(vertices=50, rms=scale * rp.T_UP_RMS, max=scale * rp.T_UP_MAX, rows_gt4=0,
                               dropped_max=0.0, dropped_mean=0.0, thresholded=True),
                    'quantisation floor (shipped vs upper3)': dict(vertices=100, rms=0.004, max=0.006)})
    pen = dict(tested=1000, excl_attach=10, excl_baseline=5, deep=2, frac=0.002, max_depth=scale * rp.T_PEN,
               nogo_frac=0.0, raw_nogo_frac=0.001)
    pose = dict(u=[-0.3, -0.4, 5, 20, 90, 10, 3, -5, -14], hip_add=-5, hip_rot=-14, hip_x=-0.5, seat_x=-0.5,
                pelvis_tilt=5.0, lumbar=20.0, hip=90.0, knee=60.0, ankle=15.0, heel_lift=3.0, shin_from_vertical=20.0,
                theta_model=-10.0, theta_target=-10.5, lean=10.0, thorax_incl=-10.0, closure=0.01, seat=0.01,
                pitch_err=0.0, foot_z_drift=0.0, fixed_hip_z_drift=-12.0, solve_s=1.0, handle=[0.2, 0.75],
                outside=[dict(coord='lumbar', value=20.0, lo=0, hi=15, beyond=5.0,
                              unc={'knee translation': [0.5, 'mm']})])
    ik = dict(start='warm', starts=1, runs=[], nit=10, nfev=200, wall=12.3, cost=0.05,
              parts=dict(pen=0.0, snug=0.01, wrist=0.0, limits=0.0, elbow=0.01, shoulder=0.0, grip=0.0, body=0.0, reg=0.01),
              info=dict(elbow=40.0, plane=10.0, elev=60.0, er=5.0, shoulder=50.0, dev=0, fl=0, mc3_axis=1.0, body_d=80.0,
                        handle=[0.2, 0.75]), knee_clear=30.0, converged=True)
    vol = {'cm': {'0': dict(v_ref=1e-4, v=1.02e-4, dv=scale * rp.T_VOL, squat=[-3.0, 4.0],
                            method='mesh volume (watertight)'),
                  '1': dict(v_ref=1e-4, v=3e-4, dv=200.0, squat=[-1.0, 1.0], method='centroid proxy')}}
    tg = dict(index=30, knee=60.0, hip=80.0, ankle=-20.0, spinal=25.0, theta=-20.0, elbow=40.0, shoulder=50.0,
              handle_y=0.748)
    poses = dict(targets={e: dict(tg) for e in POSES}, poses={e: copy.deepcopy(pose) for e in POSES},
                 ik={e: copy.deepcopy(ik) for e in POSES}, pen={e: {'cm': dict(pen), 'st': dict(pen), 'all': dict(pen)} for e in POSES},
                 vol={e: copy.deepcopy(vol) for e in POSES}, erg={'footplate_deg': dict(value=41.0)},
                 events={e: 1 for e in POSES}, rules={e: 'rule' for e in POSES}, names={'0': 'Gluteus maximus'},
                 data=dict(n_subjects=11, drive_s=1.08, recovery_s=1.67, knee_peak_subjects=129.8, catch_subjects=59.4,
                           rfp013_catch=61, footplate_rfp013=31.8, rcis_travel=0.63, signs={}, raw_finish={},
                           raw_catch={}),
                 baseline=dict(pen={}, deep={'cm': 4}))
    poses['control'] = {'squat S = 1, shipped': {'cm': dict(pen), 'all': dict(pen)}}
    poses['deep_muscles'] = {e: [dict(set='cm', muscle='Gluteus maximus', n=3, max_depth=6.25, bone='femur_r:0')]
                             for e in POSES}
    poses['squat_ik'] = dict(cost=0.29, parts=dict(pen=0.0067, snug=0.045, wrist=0.039), elbow=130.2)
    poses['ik']['finish']['fallback'] = dict(starts=5, wall=300.5, cost=0.04, converged=True, used=True)
    poses['ik']['mid_recovery']['cold_compare'] = dict(starts=5, wall=150.0, nit=500, nfev=9000, cost=0.06,
                                                       info=dict(ik['info']), converged=True)
    clear = {'bones': dict(inside=3, inside_pct=0.05, min=1.0, p1=2.0, p50=8.0, tol_mm=0.0, where=[['Femur', 3]]),
             'nearest bone or muscle': dict(p50=6.0, p1=1.5, min=0.5)}
    skin = dict(steps=[dict(step='read', tris=203382, verts=102467, comps=3, open=900)],
                components=[dict(faces=109183, area=1.9e6, volume=6e7, outward=1.0)], header={}, rigid=True,
                registration=[dict(bone='humerus', fma='FMA23130', fj='FJ3368', fj_fma='FMA23466', t=0.5, rot=0.2,
                                   scale=1.0, icp_rms=0.4, three0='FMA23130')], leg_icp_rms={},
                variants={'rigid': dict(decimate=dict(tris=12000, verts=6100, half_tris=55000, half_open=300, dec_open=290,
                                                      hausdorff_max=2.0, hausdorff_mean=0.3, in_budget=True, min_z=0.0),
                                        clearance=clear, height=1.84)},
                verdict=dict(verdict='FITS (rigid)', checks={}, shell_closed=True, tris=12000))
    render = dict(files=[dict(file='renders/catch_side.png', pose='catch', view='side', sha256='ab' * 32, bytes=1)],
                  glb=[], note='note')
    return dict(fk=fk, rig=dict(main=q2, proxy=proxy), upper=up, poses=poses, skin=skin, render=render)


def test_every_header_verbatim():
    text = rp.render(metrics())
    for key, head in rp.HEAD.items():
        line = '| ' + ' | '.join(rp.esc(c) for c in head) + ' |'
        assert line in text, key


@pytest.mark.parametrize('scale, want', [(0.5, 'GO (pending Scott\'s render sign-off)'), (1.5, 'TIER-2'), (2.5, 'NO-GO')])
def test_verdict_by_threshold(scale, want):
    assert rp.verdict(metrics(scale))['verdict'] == want
    assert f'**VERDICT: {want}**' in rp.render(metrics(scale))


def test_nogo_by_the_kill_rule():
    m = metrics()
    m['poses']['pen']['finish']['all']['nogo_frac'] = 0.02
    v = rp.verdict(m)
    assert v['verdict'] == 'NO-GO' and v['nogo_rule'] == ['finish']
    m = metrics()
    m['poses']['pen']['trunk_open']['all']['nogo_frac'] = 0.5   # the rule binds at the catch and finish only
    assert rp.verdict(m)['verdict'] == 'GO (pending Scott\'s render sign-off)'


def test_incomplete():
    m = metrics()
    del m['upper']
    v = rp.verdict(m)
    assert v['verdict'] == 'INCOMPLETE' and any('Q3a' in x for x in v['missing'])
    m = metrics()
    m['poses']['ik']['catch']['converged'] = False
    v = rp.verdict(m)
    assert v['verdict'] == 'INCOMPLETE' and any('catch' in x for x in v['missing']) and v['not_converged'] == ['catch']


def test_rerun_is_byte_identical():
    assert rp.render(metrics()) == rp.render(copy.deepcopy(metrics()))


def test_every_number_is_formatted_or_a_threshold():
    text, tokens = rp.render_with_tokens(metrics())
    nums = re.findall(r'(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])', text)
    stray = sorted({n for n in nums if n not in tokens and n.lstrip('-') not in tokens})
    assert not stray, stray


def test_missing_steps_say_not_run():
    text = rp.render({})
    for q in ('Q1: not run', 'Q2: not run', 'Q3a: not run', 'Q3b: not run', 'Q4: not run'):
        assert q in text
    assert '**VERDICT: INCOMPLETE**' in text


GO = 'GO (pending Scott\'s render sign-off)'


def test_one_q1_tier2_among_passes():
    m = metrics()
    m['fk']['frames']['femur_r']['pos_max_odd'] = 1.5 * rp.T_Q1_POS
    v = rp.verdict(m)
    assert v['verdict'] == 'TIER-2' and v['tier2'] == ['Q1 position, worst frame (mm)']


def test_one_q3_tier2_among_passes():
    m = metrics()
    m['poses']['pen']['legs_flat']['all']['max_depth'] = 1.5 * rp.T_PEN
    v = rp.verdict(m)
    assert v['verdict'] == 'TIER-2' and v['tier2'] == ['Q3b legs_flat max penetration (mm)']


def test_a_single_fail_beside_missing_is_nogo():
    m = metrics()
    m['poses']['ik']['catch']['converged'] = False
    m['rig']['main']['sig_max'] = 3 * rp.T_SIG
    v = rp.verdict(m)
    assert v['verdict'] == 'NO-GO' and v['fails'] == ['Q2 sig max err'] and v['missing']


def test_go_with_a_skin_that_does_not_fit():
    m = metrics()
    m['skin']['verdict']['verdict'] = 'DOES NOT FIT'
    assert rp.verdict(m)['verdict'] == GO
    text = rp.render(m)
    assert f'**VERDICT: {GO}**' in text and '**SKIN: DOES NOT FIT**' in text


def test_proxy_volumes_are_not_thresholded():
    m = metrics()       # each pose carries a 200 % centroid-proxy row beside a passing watertight one
    assert rp.verdict(m)['verdict'] == GO
    assert 'proxy, report-only' in rp.render(m)


def test_partial_metrics_do_not_raise():
    m = metrics()
    del m['poses']['ik']
    v = rp.verdict(m)
    assert v['verdict'] == 'INCOMPLETE' and set(v['not_converged']) == set(rp.POSES)
    m = metrics()
    del m['poses']['vol']['finish']
    v = rp.verdict(m)
    assert 'Q3b finish max |ΔV| (%), watertight muscles' in v['missing']


def test_summary_drops_only_the_appendix():
    full, short = rp.render(metrics()), rp.render(metrics(), appendix=False)
    assert 'Appendix: Q3-vol' in full and 'Appendix: Q3-vol' not in short
    assert full.split('### Appendix')[0].split('### Renders')[0] == short.split('### Renders')[0]


def test_real_run_is_nogo_with_the_kill_rule_at_the_catch():
    th = json.loads((Path(__file__).parent / 'fixtures' / 'metrics-754-thresholded.json').read_text(encoding='utf-8'))
    v = rp.verdict_from(th)
    assert v['verdict'] == 'NO-GO' and v['nogo_rule'] == ['catch']
    assert set(v['not_converged']) == {'catch', 'finish'}
    assert any(n.startswith('Q2 point max') for n in v['fails'])
