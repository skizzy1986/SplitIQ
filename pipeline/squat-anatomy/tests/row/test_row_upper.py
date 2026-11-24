"""Q3a: top-4 DQS weights reproduce the squat's posed upper body (spec §5a). Needs the STLs."""
import numpy as np
import pytest

from row.spike import upper
from row.spike.squatdata import load_shipped
from squat.inputs import STL_BUILD, STL_UPPER

pytestmark = pytest.mark.stl


@pytest.fixture(scope='module')
def q3a(ctx, paths, need_stl):
    need_stl(STL_BUILD + STL_UPPER)
    u3 = dict(np.load(paths.v3 / 'upper3.npz'))
    return upper.compute(ctx, np.load(paths.v3 / 'armik4_x.npy'), np.load(paths.v3 / 'st_W.npy'), u3,
                         load_shipped(paths)), u3


def test_top4_keeps_four_and_sums_to_one():
    W = np.array([[0.4, 0.3, 0.1, 0.1, 0.06, 0.04], [1, 0, 0, 0, 0, 0]], float)
    W4, dropped, nnz = upper.top4(W)
    assert ((W4 > 0).sum(1) <= 4).all() and np.allclose(W4.sum(1), 1)
    assert dropped[0] == pytest.approx(0.1) and dropped[1] == 0 and list(nnz) == [6, 1]


def test_reb_table_read_from_upper3():
    reb = upper.reb_parts()
    assert len(reb) == 6 and all(k.startswith(('Deltoid', 'Pectoralis major')) for k in reb)


def test_st_and_lb_within_threshold(q3a):
    (rows, _), _ = q3a
    for k in ('st kept', 'lb'):
        assert rows[k]['rms'] <= 1.0 and rows[k]['max'] <= 4.0, (k, rows[k])
    assert rows['st kept']['rows_gt4'] > 0


def test_rebuilt_parts_reproduce(q3a):
    (rows, ur), u3 = q3a
    assert len(ur.parts) == 6
    for name, mi, og, V, F, w in ur.parts:
        assert len(V) == int((u3['SM'] == mi).sum()), name
        assert rows[name]['max'] < 0.01, (name, rows[name])


def test_pose_upper_at_the_squat_arm_is_upper3(q3a, ctx, paths):
    (rows, ur), u3 = q3a
    C = ctx.arm.transforms(np.load(paths.v3 / 'armik4_x.npy'))
    for k in ur.gk:
        C.setdefault(k, np.eye(4))
    st, lb = upper.pose_upper(ur, C, upper.mt(C, ctx.arm.Tcur, ctx.base.tg))
    assert st.shape == u3['S'].shape
    assert np.linalg.norm(st - u3['S'], axis=1).max() < 0.0025 and np.abs(lb - u3['L']).max() < 1e-9
