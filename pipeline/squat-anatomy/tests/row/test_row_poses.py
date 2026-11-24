"""The five key poses end to end (slow: the arm IK takes minutes). Needs the STLs and the rowing data."""
import json

import pytest

from row.spike.run import run
from squat.inputs import STL_BUILD, STL_UPPER

pytestmark = [pytest.mark.slow, pytest.mark.stl, pytest.mark.rowing_data]


def test_five_poses_solve(paths, tmp_path, need_stl, need_rowing):
    need_stl(STL_BUILD + STL_UPPER)
    need_rowing()
    v3 = {p.name: p.stat().st_mtime_ns for p in paths.v3.iterdir()}
    out = tmp_path / 'spike'
    assert run(paths, 'poses', out, log=lambda *a: None) == 0
    m = json.loads((out / 'poses.json').read_text(encoding='utf-8'))
    for e, p in m['poses'].items():
        assert p['closure'] <= 1.0 and abs(p['seat']) <= 1.0 and abs(p['foot_z_drift']) <= 1.0, e
        assert isinstance(m['ik'][e]['converged'], bool) and m['ik'][e]['wall'] > 0, e
    # measured on the build machine (2026-11-24): the arm IK converges at legs flat, trunk open and mid-recovery,
    # not at the catch (shoulder-convention mismatch) or the finish (grip); pinned per pose so drift fails loudly
    assert {e: m['ik'][e]['converged'] for e in m['ik']} == dict(
        catch=False, legs_flat=True, trunk_open=True, finish=False, mid_recovery=True)
    assert {p.name: p.stat().st_mtime_ns for p in paths.v3.iterdir()} == v3
