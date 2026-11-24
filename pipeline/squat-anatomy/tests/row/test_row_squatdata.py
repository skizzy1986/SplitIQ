"""The shipped-data loader checks the golden sha and decodes the arrays the spike judges against."""
import gzip

import numpy as np
import pytest

from row.spike.squatdata import ShippedDataError, load_shipped


@pytest.fixture(scope='module')
def sh(paths):
    return load_shipped(paths)


def test_shapes_and_dtypes(sh):
    assert sh.frames.shape == (41, 11, 7) and sh.arr['frames'].dtype == np.float32
    assert sh.arr['cv_pos'].dtype == np.int16 and sh.arr['cv_quat'].dtype == np.int16
    assert sum(c['n'] for c in sh.cv) * sh.ns * 3 == sh.arr['cv_pos'].size
    assert sum(c['n'] for c in sh.cv) * sh.ns * 4 == sh.arr['cv_quat'].size
    assert len(sh.cv) == 54 and sh.sig.shape == (54, 41) and sh.ends.shape == (54, 2)
    assert len(sh.mlen) == 43
    P, Q = sh.curve(12)
    assert P.shape == (41, sh.cv[12]['n'], 3) and np.allclose(np.linalg.norm(Q, axis=2), 1)
    assert all(T.shape == (41, 4, 4) for T in sh.T.values())


def test_frames3_is_what_ships(sh):
    assert np.array_equal(sh.frames3.astype(np.float32), sh.arr['frames'])


def test_arrays_are_read_only(sh):
    with pytest.raises(ValueError):
        sh.arr['cm_w'][0] = 1


def test_tampered_bin_raises_one_line(paths, tmp_path):
    src = paths.repo / 'web' / 'src' / 'squat' / 'assets' / 'squat-anatomy.bin'
    raw = bytearray(gzip.decompress(src.read_bytes()))
    raw[1000] ^= 1
    bad = tmp_path / 'squat-anatomy.bin'
    bad.write_bytes(gzip.compress(bytes(raw), mtime=0))
    with pytest.raises(ShippedDataError) as e:
        load_shipped(paths, bin_path=bad)
    assert '\n' not in str(e.value) and 'not the golden squat data' in str(e.value)
