"""The fetched Engstrom data: pins and the researcher's anchors (F13). Skips unless fetched (ROW_STRICT_DATA=1
fails instead)."""
import numpy as np
import pytest

from row import inputs
from row.fetch import sha256_file
from row.spike import engstrom

pytestmark = pytest.mark.rowing_data


@pytest.fixture(scope='module')
def root(need_rowing):
    return need_rowing()


@pytest.fixture(scope='module')
def tg(root):
    return engstrom.load(root)


def test_pins(root):
    assert {rel: sha256_file(root / rel) for rel in inputs.ENGSTROM_FILES} == inputs.ENGSTROM_FILES
    assert (root / 'LICENSE').read_text(encoding='utf-8') == inputs.ENGSTROM_LICENSE


def test_anchors(tg, root):
    assert tg.knee_peak_subjects == pytest.approx(129.8, abs=0.05)
    assert tg.mean['knee'][0] == pytest.approx(4.6, abs=0.05)
    assert abs(tg.events['catch'] - 59) <= 1 and abs(tg.catch_subjects - 59.4) <= 1.5
    assert tg.mean['elbow'][0] == pytest.approx(124.7, abs=0.1)
    assert tg.drive_s == pytest.approx(1.08, abs=0.01) and tg.recovery_s == pytest.approx(1.67, abs=0.01)
    assert tg.theta[tg.rfp013_catch] == pytest.approx(-45.4, abs=0.2) and tg.theta[0] == pytest.approx(28.5, abs=0.2)
    assert tg.rfp013_catch == int(np.argmin(tg.theta))


def test_signs_follow_the_rules(tg):
    assert tg.signs['knee'] == -1 and tg.signs['lower_back'] == -1
    assert all(tg.signs[k] == 1 for k in ('hip', 'ankle', 'shoulder', 'upper_back', 'elbow'))
    c = tg.events['catch']
    spinal = tg.mean['lower_back'] + tg.mean['upper_back']
    assert spinal[c] == pytest.approx(48, abs=1.0)
