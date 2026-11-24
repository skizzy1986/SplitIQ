"""collide.py: the two depth methods agree, normals face out, and the kill fraction counts what it should."""
import numpy as np
import pytest
import trimesh

from row.spike import collide


def _sphere_parts(remove_patch=False, invert=False):
    s = trimesh.creation.icosphere(subdivisions=4, radius=0.05)
    V, F = np.asarray(s.vertices), np.asarray(s.faces)
    if remove_patch:
        F = F[~np.all(V[F][:, :, 2] > 0.045, axis=1)]          # a small cap off the top: no longer watertight
    if invert:
        F = F[:, ::-1]
    return collide.bone_parts({'b': (V, F, np.zeros(len(V), int))})


def test_bone_parts_orient_normals_outward():
    for inv in (False, True):
        (name, m, wt), = _sphere_parts(invert=inv)
        assert wt and m.volume > 0, inv


def test_watertight_and_open_methods_agree_away_from_the_hole():
    rng = np.random.default_rng(0)
    d = rng.normal(size=(400, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    d = d[d[:, 2] < 0.5]                                        # well away from the removed cap
    r = rng.uniform(0.01, 0.07, len(d))
    P = d * r[:, None]
    closed = _sphere_parts()
    opened = _sphere_parts(remove_patch=True)
    assert closed[0][2] and not opened[0][2]
    dc, _ = collide.depth(P, closed)
    do, _ = collide.depth(P, opened)
    assert np.allclose(dc, do, atol=2e-4)
    inside = r < 0.049
    assert (dc[inside] > 0).all() and (dc[r > 0.051] == 0).all()
    assert np.allclose(dc[inside], 0.05 - r[inside], atol=3e-4)


def test_kill_fraction_with_and_without_exclusions():
    parts = _sphere_parts()
    depths = np.array([0.0, 0.0, 0.001, 0.004, 0.006, 0.008, 0.010, 0.0, 0.0, 0.0])
    P = np.c_[np.zeros(10), np.zeros(10), 0.05 - depths]        # on the z axis, at known depths inside
    P[depths == 0, 2] = 0.06                                    # outside
    F = np.zeros((0, 3), np.int64)
    sets = {'cm': (P, F, np.zeros(10, int))}
    r = collide.penetration(sets, parts, {}, {})['cm']
    assert r['deep'] == 4 and r['nogo_frac'] == pytest.approx(0.3) and r['max_depth'] == pytest.approx(10, abs=0.3)
    att = np.zeros(10, bool)
    att[6] = True                                               # the 10 mm vertex sits at an attachment
    base = np.zeros(10, bool)
    base[5] = True                                              # the 8 mm one was already inside in the squat
    r = collide.penetration(sets, parts, {'cm': att}, {'cm': base})['cm']
    assert r['excl_attach'] == 1 and r['excl_baseline'] == 1
    assert r['nogo_frac'] == pytest.approx(1 / 8) and r['raw_nogo_frac'] == pytest.approx(0.3)
    assert r['max_depth'] == pytest.approx(6, abs=0.3)


@pytest.mark.stl
def test_sign_method_matches_contains_on_real_bones(paths):
    """Cross-check on the squat's own watertight bone parts: the open-part method against contains()."""
    from row.spike.squatdata import load_shipped
    sh = load_shipped(paths)
    rng = np.random.default_rng(1)
    for g in ('femur_r', 'tibia_r', 'patella_r', 'L3'):
        V, pid, F, _ = sh.bone(g)
        parts = [p for p in collide.bone_parts({g: (V, F, pid)}) if p[2]]
        assert parts, g
        for name, m, wt in parts:
            lo, hi = m.bounds
            P = rng.uniform(lo, hi, size=(1500, 3))
            dc, _ = collide.depth(P, [(name, m, wt)])
            ds, _ = collide.depth(P, [(name, m, wt)], force_sign=True)
            agree = (dc > 0) == (ds > 0)
            assert agree.mean() > 0.99, (name, agree.mean())
            both = (dc > 0) & (ds > 0)
            assert np.allclose(dc[both], ds[both], atol=1e-9)
