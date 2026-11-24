"""The skin helpers on tiny synthetic meshes: OBJ reading, fan fill, the half cut (no data needed)."""
import numpy as np
import trimesh

from row.spike import skin


def test_read_obj_quads_and_slashes(tmp_path):
    p = tmp_path / 'a.obj'
    p.write_text('# File ID : FJ1\n# Concept ID : FMA1\nmtllib x.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n'
                 'vn 0 0 1\nvt 0 0\ng part\nf 1/1/1 2/2/1 3/3/1 4/4/1\nf -4 -3 -2\n', encoding='utf-8')
    V, F = skin.read_obj_vf(p)
    assert V.shape == (4, 3) and F.tolist() == [[0, 1, 2], [0, 2, 3], [0, 1, 2]]
    assert skin.obj_header(p) == {'File ID': 'FJ1', 'Concept ID': 'FMA1'}


def test_fan_fill_closes_a_holed_cube():
    box = trimesh.creation.box()
    V, F = np.asarray(box.vertices), np.asarray(box.faces)
    top = np.where(np.all(V[F][:, :, 2] > 0, axis=1))[0]
    Fh = np.delete(F, top, axis=0)
    assert skin.open_edges(Fh) == 4
    V2, F2 = skin.fan_fill(V, Fh)
    m = trimesh.Trimesh(V2, F2, process=False)
    assert skin.open_edges(F2) == 0 and m.is_watertight and m.is_winding_consistent
    assert np.isclose(abs(m.volume), 1.0)


def test_half_cut_keeps_positive_z():
    s = trimesh.creation.icosphere(subdivisions=2)
    V, F = skin.half_cut(np.asarray(s.vertices), np.asarray(s.faces))
    assert V[:, 2].min() >= 0
    m = trimesh.Trimesh(V, F, process=False)
    assert m.is_winding_consistent
    # the only open boundary is the seam on z = 0
    e = np.sort(np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    u, c = np.unique(e, axis=0, return_counts=True)
    assert np.allclose(V[u[c == 1]][:, :, 2], 0)
    assert np.isclose(m.area, s.area / 2, rtol=0.02)


def test_icp_recovers_a_shift():
    s = trimesh.creation.icosphere(subdivisions=3)
    V = np.asarray(s.vertices) * [1, 1.3, 0.8] * 50
    shifted = V + [3.0, -2.0, 1.0]
    T, rms, sc = skin.icp(V, skin.target_of(shifted, np.asarray(s.faces)), np.eye(4))
    assert np.allclose(T[:3, 3], [3, -2, 1], atol=0.2) and rms < 0.5
