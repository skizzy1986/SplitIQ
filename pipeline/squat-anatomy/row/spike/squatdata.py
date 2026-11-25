"""The data /squat ships (web/src/squat/assets: bin + manifest), decoded once and checked against the golden sha.

Read-only. The spike judges every re-rig against these arrays, never against the v2 base page.
"""
import gzip
import hashlib
import json
from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np

from core.geom import qR
from core.paths import display
from core.repack import TA
from squat.cli import GOLDEN_RAW_BYTES, GOLDEN_RAW_SHA256
from squat.model.curves import fixed_alpha
from squat.stages._io import cache, load_pickle

TRUNK = ('pelvis_rest', 'L5', 'L4', 'L3', 'L2', 'L1', 'thorax')


class ShippedDataError(ValueError):
    """The shipped bin is not the golden squat data (CLI exit 3, one line)."""


def mat(p, q):
    M = np.eye(4)
    M[:3, :3] = qR(q)
    M[:3, 3] = p
    return M


@dataclass(frozen=True, eq=False)
class Shipped:
    man: dict
    meta: dict
    arr: dict
    fn: list
    ns: int
    frames: np.ndarray      # (41, 11, 7) float64 of the shipped float32
    T: dict                 # frame name -> (41, 4, 4) world transforms
    static: dict            # 'calcn_r' / 'toes_r' -> 4x4 (row-major as stored)
    cv: list                # meta.curves
    offs: list
    sig: np.ndarray         # (54, 41)
    ends: np.ndarray        # (54, 2) curve_ends
    alpha: list             # fixed_alpha per curve
    mlen: dict              # mlen3.pkl: muscle id -> % of standing over S
    frames3: np.ndarray     # pipeline/v3/frames3.npy (float64)

    def curve(self, ci):
        """Shipped curve ci: P (41, n, 3) metres and Q (41, n, 4) xyzw, normalised."""
        n = self.cv[ci]['n']
        o = self.offs[ci]
        P = self.arr['cv_pos'][o * 3:(o + self.ns * n) * 3].astype(float).reshape(self.ns, n, 3) * 5e-5
        P[:, :, 1] += 0.8
        Q = self.arr['cv_quat'][o * 4:(o + self.ns * n) * 4].astype(float).reshape(self.ns, n, 4)
        return P, Q / np.linalg.norm(Q, axis=2, keepdims=True)

    def bone(self, g):
        bm = self.meta['bones'][g]
        P = self.arr[f'bone_{g}_pos'].astype(float) * bm['s'] + np.array(bm['c'])
        return P, self.arr[f'bone_{g}_id'].astype(int), self.arr[f'bone_{g}_idx'].reshape(-1, 3).astype(np.int64), bm

    def deq(self, name, meta):
        return self.arr[f'{name}_pos'].astype(float) * meta['s'] + np.array(meta['c'])


def load_shipped(paths, bin_path=None, manifest_path=None):
    assets = paths.repo / 'web' / 'src' / 'squat' / 'assets'
    bp = bin_path or assets / 'squat-anatomy.bin'
    mp = manifest_path or assets / 'squat-manifest.json'
    for p in (bp, mp):
        paths.require(p, 'input', hint='the data /squat ships; restore with git checkout')
    raw = gzip.decompress(bp.read_bytes())
    if len(raw) != GOLDEN_RAW_BYTES or hashlib.sha256(raw).hexdigest() != GOLDEN_RAW_SHA256:
        raise ShippedDataError(f'{display(bp)} is not the golden squat data (raw {len(raw)} bytes, '
                               f'sha256 {hashlib.sha256(raw).hexdigest()[:12]}…)')
    man = json.loads(mp.read_text(encoding='utf-8'))
    arr = {}
    for k, e in man.items():
        if isinstance(e, dict) and 'o' in e and 't' in e:
            a = np.frombuffer(raw, dtype=TA[e['t']], count=e['n'], offset=e['o']).copy()
            arr[k] = a.reshape(e['shape']) if 'shape' in e else a
            arr[k].flags.writeable = False
    meta = man['meta']
    fn = meta['frames']
    ns = len(meta['S'])
    fr = arr['frames'].astype(float)
    T = {n: np.stack([mat(fr[i, j, :3], fr[i, j, 3:]) for i in range(ns)]) for j, n in enumerate(fn)}
    static = {k: np.array(v, float) for k, v in meta['static'].items()}
    offs, o = [], 0
    for c in meta['curves']:
        offs.append(o)
        o += ns * c['n']
    f3 = np.load(cache_path(paths, 'frames3.npy'))
    return Shipped(man=man, meta=meta, arr=arr, fn=fn, ns=ns, frames=fr, T=T, static=static, cv=meta['curves'],
                   offs=offs, sig=np.array([c['sig'] for c in meta['curves']], float),
                   ends=np.load(paths.require('v3/curve_ends.npy', 'fixed')), alpha=fixed_alpha(paths),
                   mlen=load_pickle(cache_path(paths, 'mlen3.pkl')), frames3=f3)


def cache_path(paths, name):
    return cache(SimpleNamespace(paths=paths), paths.v3, name)  # cache() only reads ctx.paths
