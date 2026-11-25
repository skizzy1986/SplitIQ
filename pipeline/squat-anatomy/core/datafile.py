"""Data files: a compact JSON manifest plus one gzip .bin per bin, laid out by the packing core the HTML container
uses (core/repack.py).

One bin is the squat's form: entries {o, n, t, shape?} and no bin ids. Two or more bins: every array entry names its
bin in ``b``, ``o`` is the offset within that bin, and the manifest ends with ``bins``, a lock of each bin's raw
(decompressed) bytes and sha256. Gzip bytes depend on the zlib build, so they are reported, never locked. File names
are the caller's and are not recorded in the manifest.
"""
import copy
import gzip
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from core.paths import MissingInputError
from core.repack import TA, dumps, gz, is_array_entry, pack, pack_entries, unpack


class DataFileError(ValueError):
    """A refused write or read; the message names the key, bin id or file."""


class BinLockError(DataFileError):
    """A bin's raw bytes or sha256 differ from the manifest's lock."""


@dataclass(frozen=True)
class BinFile:
    id: str
    path: Path
    raw_bytes: int
    raw_sha256: str
    bytes: int
    sha256: str


@dataclass(frozen=True)
class WriteResult:
    manifest: Path
    manifest_bytes: int
    manifest_sha256: str
    bins: tuple


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def _check_args(manifest, manifest_name, bin_names):
    if not bin_names:
        raise DataFileError('bin_names is empty')
    for i in bin_names:
        if not isinstance(i, str) or not i:
            raise DataFileError(f'bin id {i!r} is not a non-empty str')
    names = [manifest_name, *bin_names.values()]
    for n in names:
        if not isinstance(n, str) or not n or n == '.' or '/' in n or '\\' in n or '..' in n:
            raise DataFileError(f'bad file name {n!r}')
    if len(set(names)) != len(names):
        raise DataFileError(f'file names repeat: {names}')
    if 'bins' in manifest:
        raise DataFileError("the manifest already has 'bins'; the writer writes it")


def _check_arrays(manifest, arrays):
    keys = [k for k, e in manifest.items() if is_array_entry(e)]
    if not keys:
        raise DataFileError('the manifest has no array entries')
    missing = [k for k in keys if k not in arrays]
    if missing:
        raise DataFileError(f'no array for manifest entries {missing}')
    extra = [k for k in arrays if k not in set(keys)]
    if extra:
        raise DataFileError(f'arrays without a manifest entry {extra}')
    for k in keys:
        t = np.ascontiguousarray(arrays[k]).dtype.str
        if t not in TA:
            raise DataFileError(f'{k}: dtype {t} is not one of {sorted(TA)}')
    return keys


def _assign_bins(manifest, keys, bin_names):
    if len(bin_names) == 1:
        with_b = [k for k in keys if 'b' in manifest[k]]
        if with_b:
            raise DataFileError(f'single-bin write, but entries carry b: {with_b}')
        return {next(iter(bin_names)): keys}
    for k in keys:
        b = manifest[k].get('b')
        if b is None:
            raise DataFileError(f'{k}: no b in a multi-bin write')
        if b not in bin_names:
            raise DataFileError(f'{k}: b {b!r} is not a declared bin {list(bin_names)}')
    by_bin = {i: [k for k in keys if manifest[k]['b'] == i] for i in bin_names}
    empty = [i for i, ks in by_bin.items() if not ks]
    if empty:
        raise DataFileError(f'declared bins with no entries: {empty}')
    return by_bin


def write(manifest, arrays, out_dir, manifest_name, bin_names):
    """Write each bin of ``manifest``'s arrays to ``out_dir/bin_names[id]`` (gzip level 9, mtime 0), then the
    manifest to ``out_dir/manifest_name``. Every check runs before any file is touched; the manifest goes last, so
    a manifest on disk means its bins were written."""
    _check_args(manifest, manifest_name, bin_names)
    keys = _check_arrays(manifest, arrays)
    by_bin = _assign_bins(manifest, keys, bin_names)
    if len(bin_names) == 1:
        man, raw = pack(manifest, arrays)
        raws = {next(iter(bin_names)): raw}
    else:
        man = copy.deepcopy(manifest); raws = {}
        for i, ks in by_bin.items():
            new, raws[i] = pack_entries([(k, man[k]) for k in ks], arrays)
            for k in ks:
                man[k] = {**new[k], 'b': i}
        man['bins'] = [{'id': i, 'rawBytes': len(raws[i]), 'rawSha256': _sha(raws[i])} for i in bin_names]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    bins = []
    for i, name in bin_names.items():
        g = gz(raws[i]); p = out / name
        p.write_bytes(g)
        bins.append(BinFile(id=i, path=p, raw_bytes=len(raws[i]), raw_sha256=_sha(raws[i]), bytes=len(g), sha256=_sha(g)))
    mb = dumps(man).encode('utf-8'); mp = out / manifest_name
    mp.write_bytes(mb)
    return WriteResult(manifest=mp, manifest_bytes=len(mb), manifest_sha256=_sha(mb), bins=tuple(bins))


def _gunzip(p):
    p = Path(p)
    if not p.is_file():
        raise MissingInputError(p, 'input')
    return gzip.decompress(p.read_bytes())


def read(manifest_path, bin_paths):
    """The parsed manifest (``b`` and ``bins`` kept) and its arrays, from the bins at ``bin_paths`` {bin id: path}.
    A locked manifest checks each bin's raw bytes and sha256; every entry gets the web viewer's checks
    (web/src/anatomy/utils/arrays.js: o, n and t present, known dtype, no negative o or n, aligned offset, inside its bin)."""
    mp = Path(manifest_path)
    if not mp.is_file():
        raise MissingInputError(mp, 'input')
    man = json.loads(mp.read_text(encoding='utf-8'))
    keys = [k for k, e in man.items() if is_array_entry(e)]
    raws = {}
    if 'bins' in man:
        lock = {b['id']: b for b in man['bins']}
        if set(bin_paths) != set(lock):
            raise DataFileError(f'bins given {sorted(bin_paths)}, manifest locks {sorted(lock)}: '
                                f'missing {sorted(set(lock) - set(bin_paths))}, extra {sorted(set(bin_paths) - set(lock))}')
        for i, p in bin_paths.items():
            raw = _gunzip(p)
            if len(raw) != lock[i]['rawBytes']:
                raise BinLockError(f'bin {i}: rawBytes {len(raw)} != {lock[i]["rawBytes"]}')
            if _sha(raw) != lock[i]['rawSha256']:
                raise BinLockError(f'bin {i}: rawSha256 {_sha(raw)} != {lock[i]["rawSha256"]}')
            raws[i] = raw
        unlocked = [k for k in keys if man[k].get('b') not in lock]
        if unlocked:
            raise DataFileError(f'entries without a locked bin: {unlocked}')
        src = {k: man[k]['b'] for k in keys}
    else:
        if len(bin_paths) != 1:
            raise DataFileError(f'a manifest without bins reads one bin, got {sorted(bin_paths)}')
        with_b = [k for k in keys if 'b' in man[k]]
        if with_b:
            raise DataFileError(f'entries carry b but the manifest has no bins lock: {with_b}')
        (i, p), = bin_paths.items()
        raws[i] = _gunzip(p)
        src = {k: i for k in keys}
    for k in keys:
        e = man[k]
        missing = [f for f in ('o', 'n', 't') if f not in e]
        if missing:
            raise DataFileError(f'{k}: entry has no {missing}')
        if e['t'] not in TA:
            raise DataFileError(f'{k}: unknown dtype {e["t"]}')
        # np.frombuffer reads everything for count=-1 and raises a bare ValueError for a negative offset; the web's
        # typed-array constructor throws on both, so refuse them here
        for f in ('o', 'n'):
            if e[f] < 0:
                raise DataFileError(f'{k}: negative {f} {e[f]}')
        size = np.dtype(TA[e['t']]).itemsize
        if e['o'] % size:
            raise DataFileError(f'{k}: offset {e["o"]} is misaligned for {e["t"]}')
        if e['o'] + e['n'] * size > len(raws[src[k]]):
            raise DataFileError(f'{k}: runs past the end of bin {src[k]}')
    per_bin = {i: unpack(man, raw, [k for k in keys if src[k] == i]) for i, raw in raws.items()}
    return man, {k: per_bin[src[k]][k] for k in keys}
