"""Q2: the curve rig recovers a synthetic blend exactly and fits the shipped curves sanely (spec §4)."""
import numpy as np
import pytest
from scipy.spatial.transform import Rotation as Rot

from row.spike import rig
from row.spike.squatdata import load_shipped


def _frames(seed, n=41):
    rng = np.random.default_rng(seed)
    T = np.tile(np.eye(4), (n, 1, 1))
    axis = rng.normal(size=3)
    for i in range(n):
        T[i, :3, :3] = Rot.from_rotvec(axis / np.linalg.norm(axis) * (0.03 * i + 0.1 * seed)).as_matrix()
        T[i, :3, 3] = rng.normal(scale=0.1, size=3) + [0, 0.01 * i * seed, 0]
    return T


def _blend(Ts, W, X):
    return np.einsum('nf,fmab,nfb->mna', W, Ts[:, :, :3, :3], X) + np.einsum('nf,fma->mna', W, Ts[:, :, :3, 3])


def test_synthetic_two_frame_blend_is_recovered():
    Ts = np.stack([_frames(1), _frames(2)])
    W = np.array([[0.3, 0.7], [1.0, 0.0], [0.55, 0.45]])
    X = np.random.default_rng(3).normal(scale=0.05, size=(3, 2, 3))
    P = _blend(Ts, W, X)
    Q = np.tile([0, 0, 0, 1.0], (41, 3, 1))
    Wf, Xf, _, rms = rig.fit_points(P, Q, Ts, rig.EVEN, iters=500, tol=0)
    assert np.abs(Wf - W).max() < 1e-8
    for j in range(3):
        used = W[j] > 0
        assert np.abs(Xf[j][used] - X[j][used]).max() < 1e-8
    assert rms < 1e-9


def test_selection_finds_the_true_set():
    T = {'pelvis_rest': _frames(1), 'femur_r': _frames(2), 'tibia_r': _frames(3), 'patella_r': _frames(4)}
    order = ('femur_r', 'pelvis_rest', 'tibia_r')
    W = np.array([[0.5, 0.2, 0.3], [0.2, 0.3, 0.5]])
    X = np.random.default_rng(5).normal(scale=0.05, size=(2, 3, 3))
    P = _blend(np.stack([T[f] for f in order]), W, X)
    Q = np.tile([0, 0, 0, 1.0], (41, 2, 1))
    cand = rig.candidates('pelvis_rest', 'tibia_r', T)
    assert set(cand) == {'pelvis_rest', 'femur_r', 'tibia_r', 'patella_r'}
    sub, *_ = rig.select_frames(P, Q, T, 'pelvis_rest', 'tibia_r', cand)
    assert sub == order


def test_identical_frames_collapse_to_the_named_end():
    A = _frames(1)
    T = {'L1': A, 'thorax': A.copy(), 'L2': _frames(2), 'L3': _frames(3), 'L4': _frames(4), 'L5': _frames(5),
         'pelvis_rest': _frames(6), 'femur_r': _frames(7)}
    cand = rig.candidates('thorax', 'femur_r', T)
    assert 'thorax' in cand and 'L1' not in cand


def test_sig_rule_recovers_k():
    L = np.linspace(0.30, 0.42, 41)
    sig = 0.97 * (L / L[0]) ** -0.5
    sig0, k = rig.fit_sig(L, sig, rig.EVEN)
    assert sig0 == pytest.approx(0.97) and k == pytest.approx(0.5, abs=1e-12)
    assert np.allclose(rig.sig_rule(L, L[0], sig0, k), np.maximum(0.82, sig))


@pytest.fixture(scope='module')
def real(paths):
    sh = load_shipped(paths)
    T = rig.frame_stack(sh)
    return sh, T, {ci: rig.fit_curve(sh, ci, T)[0] for ci in (0, 11, 12, 16, 33)}


@pytest.mark.parametrize('ci', [0, 11, 12, 16, 33])
def test_real_curves_smoke(real, ci):
    sh, T, rigs = real
    r = rigs[ci]
    assert (r.W >= 0).all() and np.abs(r.W.sum(1) - 1).max() < 1e-9 and len(r.frames) <= 3
    P, Q = sh.curve(ci)
    Pr, Qr = rig.eval_points(r.W, r.X, r.R, np.stack([T[f] for f in r.frames]))
    # measured on this data: curve 16 (a quadriceps path over the knee) reaches 24.8 mm; pinned at +10 %
    assert np.linalg.norm(Pr - P, axis=-1).max() < 0.0275
    assert np.allclose(np.linalg.norm(Qr, axis=-1), 1)


def test_curve_12_spans_the_knee(real):
    assert {'pelvis_rest', 'femur_r', 'tibia_r'} <= set(real[2][12].frames)
