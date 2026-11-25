"""core/datafile.py: the deterministic manifest + .bin writer and its reader (#755)."""
import gzip
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
import pytest

from core import repack
from core.datafile import BinLockError, DataFileError, read, write
from core.paths import MissingInputError
from squat.cli import GOLDEN_RAW_BYTES, GOLDEN_RAW_SHA256

MAN = 'row-manifest.json'
MULTI = {'body': 'anatomy-body.bin', 'motion': 'row-motion.bin'}


def _fixture(bins=True):
    """One array per dtype code, bins interleaved body/motion/body; a 3-byte |u1 forces padding before the <f4."""
    arrays = {
        'a_u1': np.array([1, 2, 3], np.uint8),
        'b_i2': np.arange(-5, 4, dtype=np.int16).reshape(3, 3),
        'c_f4': np.linspace(-1, 1, 10, dtype=np.float32).reshape(2, 5),
        'd_i1': np.array([-1, 0, 1, 2, 3], np.int8),
        'e_u2': np.arange(7, dtype=np.uint16),
        'f_u4': np.arange(3, dtype=np.uint32) * 70000,
    }
    bin_of = dict(a_u1='body', b_i2='motion', c_f4='body', d_i1='motion', e_u2='body', f_u4='motion')
    manifest = {}
    for k, a in arrays.items():
        e = {'o': 0, 'n': 0, 't': '<i2'}
        if a.ndim > 1:
            e['shape'] = []
        if bins:
            e['b'] = bin_of[k]
        manifest[k] = e
        if k == 'c_f4':
            manifest['meta'] = {'S': [0.0, 0.5, 1.0], 'name': 'fixture'}
    return manifest, arrays


def _gunzip(p):
    return gzip.decompress(p.read_bytes())


def _shipped(paths):
    return paths.shipped_manifest, paths.shipped_manifest.parent / 'squat-anatomy.bin'


def test_write_deterministic(tmp_path):
    r1 = write(*_fixture(), tmp_path / 'a', MAN, MULTI)
    r2 = write(*_fixture(), tmp_path / 'b', MAN, MULTI)
    for name in (MAN, *MULTI.values()):
        assert (tmp_path / 'a' / name).read_bytes() == (tmp_path / 'b' / name).read_bytes(), name
    def strip(r):
        return (r.manifest_bytes, r.manifest_sha256, [(b.id, b.raw_bytes, b.raw_sha256, b.bytes, b.sha256) for b in r.bins])
    assert strip(r1) == strip(r2)


def test_write_deterministic_across_processes(paths, tmp_path):
    code = ('import sys\nfrom test_datafile import MAN, MULTI, _fixture\nfrom core.datafile import write\n'
            'write(*_fixture(), sys.argv[1], MAN, MULTI)')
    outs = []
    for seed in ('1', '2'):
        out = tmp_path / seed
        env = {**os.environ, 'PYTHONHASHSEED': seed,
               'PYTHONPATH': os.pathsep.join([str(paths.project), str(paths.project / 'tests')])}
        r = subprocess.run([sys.executable, '-c', code, str(out)], cwd=tmp_path, env=env, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        outs.append({n: (out / n).read_bytes() for n in (MAN, *MULTI.values())})
    assert outs[0] == outs[1]


def test_body_motion_round_trip(tmp_path):
    manifest, arrays = _fixture()
    res = write(manifest, arrays, tmp_path, MAN, MULTI)
    disk = res.manifest.read_bytes()
    assert disk.isascii() and not disk.endswith(b'\n')
    man, got = read(res.manifest, {i: tmp_path / n for i, n in MULTI.items()})
    assert list(man) == [*manifest, 'bins']
    assert man['meta'] == manifest['meta']
    assert man['bins'] == [{'id': b.id, 'rawBytes': b.raw_bytes, 'rawSha256': b.raw_sha256} for b in res.bins]
    assert [b.id for b in res.bins] == list(MULTI)
    for b in res.bins:
        raw = _gunzip(b.path)
        assert (len(raw), hashlib.sha256(raw).hexdigest()) == (b.raw_bytes, b.raw_sha256)
    assert list(got) == list(arrays)
    for k, a in arrays.items():
        assert got[k].dtype == a.dtype and got[k].shape == a.shape and np.array_equal(got[k], a), k
        e = man[k]
        assert e['b'] == manifest[k]['b'] and e['o'] % 8 == 0
        assert list(e) == ['o', 'n', 't', *(['shape'] if 'shape' in manifest[k] else []), 'b']
    for i in MULTI:
        assert min(man[k]['o'] for k in arrays if man[k]['b'] == i) == 0, i
    assert man['c_f4']['o'] == 8   # 3 bytes of |u1, padded to 8


def test_single_bin_has_no_b_or_bins(tmp_path):
    manifest, arrays = _fixture(bins=False)
    res = write(manifest, arrays, tmp_path, 'm.json', {'data': 'd.bin'})
    man = json.loads(res.manifest.read_text(encoding='utf-8'))
    assert 'bins' not in man and not any('b' in man[k] for k in arrays)
    assert list(man) == list(manifest)
    _, got = read(res.manifest, {'data': tmp_path / 'd.bin'})
    for k, a in arrays.items():
        assert got[k].dtype == a.dtype and np.array_equal(got[k], a), k


def test_shipped_squat_files_round_trip(paths, tmp_path):
    man_path, bin_path = _shipped(paths)
    man, arrs = read(man_path, {'data': bin_path})
    assert len(arrs) == 71
    res = write(man, arrs, tmp_path, 'squat-manifest.json', {'data': 'squat-anatomy.bin'})
    raw = _gunzip(tmp_path / 'squat-anatomy.bin')
    assert (len(raw), hashlib.sha256(raw).hexdigest()) == (GOLDEN_RAW_BYTES, GOLDEN_RAW_SHA256)
    assert (res.bins[0].raw_bytes, res.bins[0].raw_sha256) == (GOLDEN_RAW_BYTES, GOLDEN_RAW_SHA256)
    assert json.loads(res.manifest.read_text(encoding='utf-8')) == json.loads(man_path.read_text(encoding='utf-8'))


@pytest.mark.stl
def test_single_bin_write_of_build_equals_golden(built, paths, tmp_path):
    _, man, arrs = repack.load(built.out)
    res = write(man, arrs, tmp_path, 'squat-manifest.json', {'data': 'squat-anatomy.bin'})
    assert (res.bins[0].raw_bytes, res.bins[0].raw_sha256) == (GOLDEN_RAW_BYTES, GOLDEN_RAW_SHA256)
    assert json.loads(res.manifest.read_text(encoding='utf-8')) == json.loads(paths.shipped_manifest.read_text(encoding='utf-8'))


def _drop(d, k):
    del d[k]


REFUSALS = {
    'missing-array': lambda m, a, kw: _drop(a, 'a_u1'),
    'extra-array': lambda m, a, kw: a.update(zz=np.zeros(2, np.uint8)),
    'float64-array': lambda m, a, kw: a.update(c_f4=a['c_f4'].astype(np.float64)),
    'big-endian-f4': lambda m, a, kw: a.update(c_f4=a['c_f4'].astype('>f4')),
    'unknown-b': lambda m, a, kw: m['a_u1'].update(b='nope'),
    'multi-bin-entry-without-b': lambda m, a, kw: _drop(m['a_u1'], 'b'),
    'single-bin-entry-with-b': lambda m, a, kw: kw.update(bin_names={'data': 'd.bin'}),
    'empty-declared-bin': lambda m, a, kw: kw['bin_names'].update(extra='extra.bin'),
    'input-has-bins': lambda m, a, kw: m.update(bins=[]),
    'no-array-entries': lambda m, a, kw: (m.clear(), m.update(meta={}), a.clear()),
    'name-with-slash': lambda m, a, kw: kw['bin_names'].update(body='a/b.bin'),
    'name-with-backslash': lambda m, a, kw: kw['bin_names'].update(body='a\\b.bin'),
    'name-dotdot': lambda m, a, kw: kw['bin_names'].update(body='..'),
    'empty-name': lambda m, a, kw: kw['bin_names'].update(body=''),
    'duplicate-name': lambda m, a, kw: kw['bin_names'].update(motion=MULTI['body']),
    'manifest-name-is-a-bin-name': lambda m, a, kw: kw.update(manifest_name=MULTI['motion']),
    'empty-bin-names': lambda m, a, kw: kw.update(bin_names={}),
    'non-str-id': lambda m, a, kw: kw.update(bin_names={1: 'x.bin', 'motion': 'y.bin'}),
    'empty-id': lambda m, a, kw: kw.update(bin_names={'': 'x.bin', 'motion': 'y.bin'}),
}


@pytest.mark.parametrize('case', REFUSALS)
def test_write_refuses(case, tmp_path):
    manifest, arrays = _fixture()
    kw = {'manifest_name': MAN, 'bin_names': dict(MULTI)}
    REFUSALS[case](manifest, arrays, kw)
    out = tmp_path / 'out'
    with pytest.raises(DataFileError):
        write(manifest, arrays, out, **kw)
    assert not out.exists() or not any(out.iterdir())


def _written(tmp_path):
    write(*_fixture(), tmp_path, MAN, MULTI)
    return tmp_path / MAN, {i: tmp_path / n for i, n in MULTI.items()}


def test_read_rejects_tampered_bin(tmp_path):
    man_path, bins = _written(tmp_path)
    raw = bytearray(_gunzip(bins['motion'])); raw[5] ^= 0xFF
    bins['motion'].write_bytes(gzip.compress(bytes(raw), 9, mtime=0))
    with pytest.raises(BinLockError) as e:
        read(man_path, bins)
    assert 'motion' in str(e.value) and 'rawSha256' in str(e.value)


def test_read_rejects_truncated_bin(tmp_path):
    man_path, bins = _written(tmp_path)
    bins['body'].write_bytes(gzip.compress(_gunzip(bins['body'])[:-1], 9, mtime=0))
    with pytest.raises(BinLockError) as e:
        read(man_path, bins)
    assert 'body' in str(e.value) and 'rawBytes' in str(e.value)


def test_read_missing_bin(tmp_path):
    man_path, bins = _written(tmp_path)
    bins['motion'].unlink()
    with pytest.raises(MissingInputError) as e:
        read(man_path, bins)
    assert e.value.kind == 'input'


def test_read_bin_set_mismatch(tmp_path):
    man_path, bins = _written(tmp_path)
    with pytest.raises(DataFileError, match=r"missing \['body'\]"):
        read(man_path, {'motion': bins['motion']})
    with pytest.raises(DataFileError, match=r"extra \['extra'\]"):
        read(man_path, {**bins, 'extra': bins['body']})


@pytest.mark.parametrize('edit, msg', [({'o': 2}, 'misaligned'), ({'n': 10_000}, 'past the end')],
                         ids=['misaligned', 'out-of-bounds'])
def test_read_rejects_misaligned_or_out_of_bounds(tmp_path, edit, msg):
    man_path, bins = _written(tmp_path)
    man = json.loads(man_path.read_text(encoding='utf-8'))
    man['c_f4'].update(edit)
    man_path.write_text(json.dumps(man), encoding='utf-8')
    with pytest.raises(DataFileError, match=msg):
        read(man_path, bins)
