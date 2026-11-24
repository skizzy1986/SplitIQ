"""The fetched BodyParts3D 4.0 skin: pins, counts, the outer shell and the decimation budget. Skips unless fetched
(ROW_STRICT_SKIN=1 fails instead)."""
import numpy as np
import pytest

from row import inputs
from row.fetch import sha256_file, skin_dir
from row.spike import skin

pytestmark = pytest.mark.skin


@pytest.fixture(scope='module')
def obj(need_skin):
    return need_skin()


def test_zip_and_member_pins(obj, paths):
    zp = skin_dir(paths) / inputs.SKIN_ZIP
    if zp.is_file():
        assert zp.stat().st_size == inputs.SKIN_BYTES and sha256_file(zp) == inputs.SKIN_SHA256
    assert {p.name: sha256_file(p) for p in sorted(obj.glob('*.obj'))} == inputs.SKIN_MEMBERS


@pytest.fixture(scope='module')
def shell(obj):
    V, F = skin.read_obj_vf(obj / f'{inputs.SKIN_FJ}.obj')
    comps = skin.components(V, F)
    return V, F, comps


def test_counts_and_outer_shell(shell):
    V, F, comps = shell
    assert (len(V), len(F)) == (102467, 203382)
    outer = max((c for c in comps if c['outward'] > 0), key=lambda c: c['area'])
    assert outer['faces'] == 109183
    assert skin.open_edges(np.asarray(outer['mesh'].faces)) == 827
    Vf, Ff = skin.fan_fill(np.asarray(outer['mesh'].vertices), np.asarray(outer['mesh'].faces))
    assert skin.open_edges(Ff) == 0


def test_decimation_hits_the_budget(shell, ctx):
    V, F, comps = shell
    outer = max((c for c in comps if c['outward'] > 0), key=lambda c: c['area'])
    Vf, Ff = skin.fan_fill(np.asarray(outer['mesh'].vertices), np.asarray(outer['mesh'].faces))
    Vm = Vf @ ctx.base.tg[:3, :3].T + ctx.base.tg[:3, 3]
    half, dec, info = skin.half_and_decimate(Vm, Ff)
    assert abs(info['tris'] - skin.BUDGET) <= skin.BUDGET_TOL * skin.BUDGET
    assert info['min_z'] >= 0
