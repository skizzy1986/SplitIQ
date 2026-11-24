"""The Python port of the runtime posing maths matches the page's own fixture to 1e-5 m (spec §4)."""
import json

import numpy as np
import pytest

from row.spike import curveskin as cs
from row.spike.squatdata import load_shipped

TOL = 1e-5


@pytest.fixture(scope='module')
def sh(paths):
    return load_shipped(paths)


@pytest.fixture(scope='module')
def fx(paths):
    p = paths.repo / 'web' / 'src' / 'anatomy' / 'utils' / '__tests__' / 'fixtures' / 'squat-skinning-fixture.json'
    return json.loads(p.read_text(encoding='utf-8'))


@pytest.mark.parametrize('key', ['0', '0.3125', '0.5', '1'])
def test_pose_matches_fixture(sh, fx, key):
    smp = fx['samples'][key]
    s = float(key)
    assert cs.depth_index(s, sh.ns) == (smp['i0'], smp['i1'], pytest.approx(smp['t']))
    F, cm, lb = cs.pose_shipped(sh, s)
    for v, want in smp['cm'].items():
        assert np.abs(cm[int(v)] - want).max() < TOL, v
    for v, want in smp['cm_left'].items():
        assert np.abs(cm[int(v)] * [1, 1, -1] - want).max() < TOL
    for v, want in smp['lb'].items():
        assert np.abs(lb[int(v)] - want).max() < TOL, v
    j = sh.fn.index('femur_r')
    assert np.abs(F[j].T.reshape(-1) - smp['frame_femur_r_matrix4_elements_column_major']).max() < TOL
    P, _, _, _ = sh.bone('femur_r')
    stored = fx['vertex_inputs']['bone_femur_r']['0']['stored']
    assert np.abs(P[0] - stored).max() < TOL
    assert np.abs(F[j, :3, :3] @ P[0] + F[j, :3, 3] - smp['bone_femur_r']['0']).max() < TOL


@pytest.mark.parametrize('key', ['0.3125', '0.5'])
def test_trace_intermediates(sh, fx, key):
    tr = fx['trace_cm_vertex_0'][key]
    i0, i1, t = cs.depth_index(tr['S'], sh.ns)
    curves = cs.curves_at(sh, i0, i1, t)
    cm = cs.cm_arrays(sh)
    posed = []
    for b, (c, s, l) in zip(tr['bindings'], [(cm['c1'][0], cm['s1'][0], cm['l1'][0]),
                                              (cm['c2'][0], cm['s2'][0], cm['l2'][0])]):
        P, Q, sg = curves[c]
        x, d = cs.eval_bind(P, Q, sg, sh.cv[c]['nseg'], np.array([s]), np.array([l]), sh.meta['LQ'], trace=True)
        assert b['curve'] == c and b['j'] == d['j'][0]
        assert d['u'][0] == pytest.approx(b['u']) and d['frac'][0] == pytest.approx(b['frac'], abs=1e-9)
        assert sg == pytest.approx(b['sig_at_S'], abs=1e-4)
        for k, got in (('point', d['point'][0]), ('quat_xyzw', d['quat'][0]), ('offset_curve_frame_m', d['offset'][0]),
                       ('posed', x[0])):
            assert np.abs(got - b[k]).max() < TOL, k
        posed.append(x[0])
    w = tr['w'] / 255
    assert np.abs(w * posed[0] + (1 - w) * posed[1] - tr['blended']).max() < TOL


def test_depth_rule_edges():
    assert cs.depth_index(1.0, 41) == (39, 40, 1.0)
    assert cs.depth_index(0.0, 41) == (0, 1, 0.0)
    assert cs.depth_index(1.5, 41) == (39, 40, 1.0) and cs.depth_index(-1, 41) == (0, 1, 0.0)


def test_blend_weight_is_on_i0():
    rest = np.array([[0.0, 0.0, 0.0]])
    A = np.eye(4)
    B = np.eye(4)
    B[:3, 3] = 1
    got = cs.blend_trunk(rest, np.array([0]), np.array([255]), np.stack([A, B]))
    assert np.allclose(got, 0)
    got = cs.blend_trunk(rest, np.array([0]), np.array([0]), np.stack([A, B]))
    assert np.allclose(got, 1)
