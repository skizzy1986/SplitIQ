"""render.py smoke test on a tiny synthetic scene (skips without matplotlib, which CI does not install)."""
import numpy as np
import pytest
import trimesh

from row.spike import render


def test_png_and_glb_of_a_tiny_scene(tmp_path):
    pytest.importorskip('matplotlib')
    b = trimesh.creation.box()
    V, F = np.asarray(b.vertices) * 0.1, np.asarray(b.faces)
    layers = [(V, F, render.COL['bone']), (*render.mirrored(V + [0, 0, 0.2], F), render.COL['muscle'])]
    layers += render.cylinder_z(0.0, 0.0, 0.016, -0.2, 0.2) + (render.COL['erg'],),
    png, glb = tmp_path / 'x.png', tmp_path / 'x.glb'
    render.draw(png, layers, 'three', 'smoke')
    render.glb(glb, layers)
    assert png.stat().st_size > 1000 and png.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
    assert glb.stat().st_size > 100 and glb.read_bytes()[:4] == b'glTF'
