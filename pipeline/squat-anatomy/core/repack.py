"""Read/write the manifest + gzip/base64 data blob inside the HTML (was pipeline/repack.py).

The packing core (pack_entries, pack, unpack, gz, dumps) is shared with core/datafile.py, so the page and the
data files are laid out by the same code."""
import base64
import copy
import gzip
import json
import re

import numpy as np

TA = {'<i2': np.int16, '|u1': np.uint8, '<u2': np.uint16, '<u4': np.uint32, '<f4': np.float32, '|i1': np.int8}
RTA = {np.dtype(v).str if np.dtype(v).str not in ('|u1','|i1') else np.dtype(v).str: k for k, v in TA.items()}
GZIP_LEVEL = 9


def is_array_entry(e):
    return isinstance(e, dict) and 'o' in e and 't' in e


def unpack(man, raw, keys=None):
    """The arrays of ``keys`` (default: every array entry, in manifest order), read from ``raw``."""
    arrs = {}
    for k in ([k for k, e in man.items() if is_array_entry(e)] if keys is None else keys):
        e = man[k]
        a = np.frombuffer(raw, dtype=TA[e['t']], count=e['n'], offset=e['o']).copy()
        if 'shape' in e: a = a.reshape(e['shape'])
        arrs[k] = a
    return arrs


def load(src):
    with open(src, encoding='utf-8') as fh:
        html = fh.read()
    man = json.loads(re.search(r'<script id="squat-manifest" type="application/json">(.*?)</script>', html, re.S).group(1))
    b64 = re.search(r'<script id="squat-data" type="application/octet-stream">(.*?)</script>', html, re.S).group(1).strip()
    buf = gzip.decompress(base64.b64decode(b64))
    arrs = unpack(man, buf)
    return html, man, arrs


def tcode(a):
    s = a.dtype.str
    return {'<i2':'<i2','|u1':'|u1','<u2':'<u2','<u4':'<u4','<f4':'<f4','|i1':'|i1'}[s]


def pack_entries(entries, arrs):
    """Lay out ``entries`` ((key, manifest entry) pairs) in order from offset 0, each array 8-byte aligned.
    Returns the new entries {key: {o, n, t, shape?}} and the bytes."""
    new = {}; parts = []; off = 0
    for k, e in entries:
        a = np.ascontiguousarray(arrs[k]); pad = (-off) % 8
        if pad: parts.append(b'\0'*pad); off += pad
        ne = {'o': off, 'n': int(a.size), 't': tcode(a)}
        if 'shape' in e: ne['shape'] = list(a.shape)
        new[k] = ne; b = a.tobytes(); parts.append(b); off += len(b)
    return new, b''.join(parts)


def pack(man, arrs):
    """A copy of ``man`` with every array entry rewritten for ``arrs``, and the packed bytes."""
    man = copy.deepcopy(man)
    new, raw = pack_entries([(k, e) for k, e in man.items() if is_array_entry(e)], arrs)
    man.update(new)
    return man, raw


def gz(raw):
    return gzip.compress(raw, GZIP_LEVEL, mtime=0)


def dumps(man):
    return json.dumps(man, separators=(',', ':'))


def save(html, man, arrs, out):
    man, raw = pack(man, arrs)
    b64 = base64.b64encode(gz(raw)).decode()
    mj = dumps(man)
    html = re.sub(r'(<script id="squat-manifest" type="application/json">)(.*?)(</script>)', lambda m: m.group(1)+mj+m.group(3), html, count=1, flags=re.S)
    html = re.sub(r'(<script id="squat-data" type="application/octet-stream">)(.*?)(</script>)', lambda m: m.group(1)+b64+m.group(3), html, count=1, flags=re.S)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html)
    return len(b64)


def quant(P):
    c = (P.max(0)+P.min(0))/2; s = (np.abs(P-c).max()/32760) or 1e-6
    return np.round((P-c)/s).astype(np.int16), c.tolist(), float(s)
