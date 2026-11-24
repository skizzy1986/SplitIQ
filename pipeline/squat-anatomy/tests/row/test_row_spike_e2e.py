"""The whole spike, spike all --no-renders, into a temporary directory (slow, every data set)."""
import json

import pytest

from row.spike import report
from row.spike.run import run
from squat.inputs import STL_BUILD, STL_UPPER

pytestmark = [pytest.mark.slow, pytest.mark.stl, pytest.mark.rowing_data, pytest.mark.skin]


def test_spike_all(paths, tmp_path, need_stl, need_rowing, need_skin):
    need_stl(STL_BUILD + STL_UPPER)
    need_rowing()
    need_skin()
    out = tmp_path / 'spike'
    assert run(paths, 'all', out, renders=False, log=lambda *a: None) == 0
    m = json.loads((out / 'metrics.json').read_text(encoding='utf-8'))
    assert set(m) >= {'fk', 'rig', 'upper', 'poses', 'skin', 'timing'}
    assert set(m['rig']) == {'main', 'proxy'} and len(m['rig']['main']['curves']) == 54
    assert set(m['poses']['poses']) == set(report.POSES)
    assert all(e in m['poses']['pen'] and 'all' in m['poses']['pen'][e] for e in report.POSES)
    assert m['skin']['verdict']['verdict'] in ('FITS (rigid)', 'FITS AFTER WARP', 'DOES NOT FIT')
    text = (out / 'report.md').read_text(encoding='utf-8')
    assert report.verdict(m)['verdict'] in text and text == report.render(m)
