"""Q1: the joint model recovers a known chain exactly and regenerates the squat's 41 frames (spec §3)."""
from dataclasses import replace

import numpy as np
import pytest
from scipy.spatial.transform import Rotation as Rot

from row.spike import fk
from row.spike.squatdata import load_shipped
from squat.context import Context


@pytest.fixture(scope='module')
def sh(paths):
    return load_shipped(paths)


@pytest.fixture(scope='module')
def fitted(sh, paths):
    foot = fk.foot_axis(sh, Context(paths).readouts.fax)
    return fk.fit(sh.frames3, sh.meta['readout'], sh.static, sh.fn, foot), foot


def _frames(regen, fn):
    out = np.zeros((len(regen), len(fn), 7))
    for i, r in enumerate(regen):
        for j, n in enumerate(fn):
            out[i, j, :3] = r[n][:3, 3]
            out[i, j, 3:] = Rot.from_matrix(r[n][:3, :3]).as_quat()
    return out


def test_synthetic_chain_is_recovered(sh, fitted):
    (model, coords, _), foot = fitted
    quad = np.array([[-0.06, 1e-5, -2e-7], [0.93, -2e-5, 1e-7], [0.085, 3e-6, -1e-8]])
    known = replace(model, hip_quad=quad, hip_range=(-1e9, 1e9))
    frames = _frames([fk.fk(known, coords.q(i)) for i in range(41)], sh.fn)
    readout = [dict(knee=float(k)) for k in coords.knee]
    got, gc, _ = fk.fit(frames, readout, sh.static, sh.fn, foot)
    assert np.abs(got.hip_quad - quad).max() < 1e-9
    assert np.abs(got.ank_axis - model.ank_axis).max() < 1e-9
    assert np.abs(got.knee_t.y - model.knee_t(coords.knee[fk.EVEN])).max() < 1e-9
    assert np.abs(got.knee_r.y - model.knee_r(coords.knee[fk.EVEN])).max() < 1e-9
    assert np.abs(got.lum_f - model.lum_f).max() < 1e-9
    assert np.abs(gc.ankle - coords.ankle).max() < 1e-9


def test_fit_is_deterministic(sh, fitted):
    _, foot = fitted
    a, _, _ = fk.fit(sh.frames3, sh.meta['readout'], sh.static, sh.fn, foot)
    b, _, _ = fk.fit(sh.frames3, sh.meta['readout'], sh.static, sh.fn, foot)
    for k, v in fk.to_npz(a).items():
        assert np.array_equal(v, fk.to_npz(b)[k]), k


def test_lumbar_split(fitted):
    (model, _, _), _ = fitted
    assert np.allclose(model.lum_f, [0.30, 0.25, 0.20, 0.15, 0.10], atol=1e-3)


def test_regenerated_frames_within_threshold(sh, fitted):
    (model, coords, T), _ = fitted
    bones = {}
    for g, bm in sh.meta['bones'].items():
        f = bm['frame'].lstrip('@')
        bones[f] = np.vstack([bones[f], sh.bone(g)[0]]) if f in bones else sh.bone(g)[0]
    rows, _ = fk.validate(model, coords, T, sh.static, bones)
    assert set(rows) == set(fk.OUT)
    for name, r in rows.items():
        assert max(r['pos_max_even'], r['pos_max_odd']) <= 1.0, name
        assert max(r['rot_max_even'], r['rot_max_odd']) <= 0.5, name


def test_heel_lift_raises_the_heel(sh, fitted):
    (model, coords, _), _ = fitted
    q = coords.q(0)
    flat = fk.fk(model, q)
    up = fk.fk(model, {**q, 'heel_lift': 10.0})
    # with the leg fixed, + ρ swings the toes down about the MTP axis: in the toes' own frame the heel rises
    heel = sh.bone('calcn_r')[0].mean(0)
    h_flat = np.linalg.inv(flat['toes_r']) @ np.r_[flat['calcn_r'][:3, :3] @ heel + flat['calcn_r'][:3, 3], 1]
    h_up = np.linalg.inv(up['toes_r']) @ np.r_[up['calcn_r'][:3, :3] @ heel + up['calcn_r'][:3, 3], 1]
    assert h_up[1] > h_flat[1]


def test_extrapolation_lists_out_of_range(fitted):
    (model, coords, _), _ = fitted
    q = coords.q(0)
    rows = fk.extrapolation(model, {**q, 'hip': np.array([140.0, 0, 0]), 'lumbar': -10.0})
    names = {r['coord'] for r in rows}
    assert {'hip', 'lumbar'} <= names
    hip = next(r for r in rows if r['coord'] == 'hip')
    assert hip['beyond'] > 0 and 'hip centre (linear vs quadratic)' in hip['unc']
