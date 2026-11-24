"""The rowing arm IK on the squat's Arm (needs the STLs)."""
import numpy as np
import pytest

from row.spike import armik
from squat.inputs import STL_BUILD

pytestmark = pytest.mark.stl


@pytest.fixture(scope='module')
def setup(ctx, paths, need_stl):
    need_stl(STL_BUILD)
    x4 = np.load(paths.v3 / 'armik4_x.npy')
    Rsc, Rs = ctx.girdle.girdle(np.load(paths.v3 / 'girdle_p.npy'))
    return ctx.arm, x4, Rsc, Rs


def test_replaced_arm_with_squat_inputs_is_the_squat_arm(setup):
    arm, x4, Rsc, Rs = setup
    a = armik.arm_for_pose(arm, Rsc, Rs, arm.RB)
    A, B = a.transforms(x4), arm.transforms(x4)
    assert set(A) == set(B) and all(np.array_equal(A[k], B[k]) for k in A)
    assert np.array_equal(a.GH_NEW, arm.GH_NEW)
    # with the bar where the squat put it, the gaps are the squat's gaps
    bar = arm.BAR
    g1, g2 = armik.gaps(a, B, bar), arm.gaps(B)
    assert all(np.array_equal(g1[p], g2[p]) for p in arm.HP)


def _tg():
    return dict(elbow=40.0, shoulder=50.0)


def test_cost_row_is_finite_and_deterministic(setup):
    arm, x4, Rsc, Rs = setup
    a = armik.arm_for_pose(arm, Rsc, Rs, 0.016)
    T = np.eye(4)
    z = np.r_[x4, 0.1]
    body = np.array([[0.3, 1.0, 0.05]])
    c1 = armik.cost_row(z, a, T, 1.2, _tg(), x4, body)
    c2 = armik.cost_row(z, a, T, 1.2, _tg(), x4, body)
    assert np.isfinite(c1) and c1 == c2
    c, parts, info = armik.cost_row(z, a, T, 1.2, _tg(), x4, body, verbose=True)
    assert set(parts) >= {'pen', 'snug', 'wrist', 'limits', 'elbow', 'shoulder', 'grip', 'body', 'reg'}
    assert c == pytest.approx(sum(parts.values()))


def test_warm_solve_runs(setup):
    arm, x4, Rsc, Rs = setup
    a = armik.arm_for_pose(arm, Rsc, Rs, 0.016)
    best, runs = armik.solve(a, np.eye(4), 1.2, _tg(), [np.r_[x4, 0.0]], x4, np.zeros((0, 3)), (-0.3, 0.3), maxiter=50)
    assert np.isfinite(best.fun) and runs[0]['nit'] <= 50 and runs[0]['wall'] > 0
    assert -0.3 <= best.x[-1] <= 0.3


def test_the_squats_own_hand_counts_as_converged(setup):
    """Pins the relaxed limit to its reason: cost3 at armik4_x (the accepted squat hand) must pass converged()."""
    arm, x4, Rsc, Rs = setup
    c, parts, info = arm.cost3(x4, True)
    assert 1e-3 < parts['pen'] <= armik.PEN_OK            # stricter than the spec's 1e-3 would fail it
    assert armik.converged(dict(elbow=info['elbow']), parts, dict(elbow=info['elbow']))
