"""Fetch the spike's external data: stdlib download -> .part -> sha256 check -> rename; zip members by name.

Downloaded files are untrusted data. They land in their own git-ignored directories (pipeline/ext/rowing,
pipeline/ext/skin), are parsed as text or OBJ only, and are never executed.
"""
import hashlib
import http.client
import shutil
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from row import inputs
from core.paths import display

UA = 'pipeline-fetch/1.0'


class RowDataError(FileNotFoundError):
    """Missing or bad rowing data or skin (CLI exit 5). kind is 'rowing' or 'skin'."""

    def __init__(self, msg, kind):
        self.kind = kind
        super().__init__(msg)


def rowing_dir(paths):
    return paths.data / 'ext' / 'rowing'


def skin_dir(paths):
    return paths.data / 'ext' / 'skin'


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def _check(part, dest, sha, kind):
    got = sha256_file(part)
    if got != sha:
        part.unlink()
        raise RowDataError(f'sha256 mismatch for {display(dest)}: got {got[:12]}…, pinned {sha[:12]}…', kind)
    part.replace(dest)
    return dest


def download(url, dest, sha, kind, opener=None, tries=3, timeout=60, sleep=time.sleep):
    """Stream url to dest.part, check its sha256, then rename to dest. A mismatch deletes the .part."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + '.part')
    opener = opener or urllib.request.urlopen
    ok = False
    try:
        for k in range(tries):
            try:
                with opener(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=timeout) as r, \
                        open(part, 'wb') as fh:
                    shutil.copyfileobj(r, fh, 1 << 20)
                break
            except (OSError, http.client.HTTPException) as e:
                if k == tries - 1:
                    raise RowDataError(f'download failed for {url}: {e}', kind) from None
                sleep(2 ** (k + 1))
        out = _check(part, dest, sha, kind)
        ok = True
        return out
    finally:
        if not ok:
            part.unlink(missing_ok=True)


def copy_checked(src, dest, sha, kind):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + '.part')
    shutil.copyfile(src, part)
    return _check(part, dest, sha, kind)


def _mirror_file(from_dir, rel):
    # the research mirror keeps Data/RFPxxx as all/RFPxxx
    for cand in (rel, rel.replace('Data/', 'all/', 1)):
        p = Path(from_dir) / cand
        if p.is_file():
            return p
    return None


def fetch_rowing(paths, from_dir=None, opener=None, log=print):
    root = rowing_dir(paths)
    for rel, sha in inputs.ENGSTROM_FILES.items():
        dest = root / rel
        if dest.is_file() and sha256_file(dest) == sha:
            continue
        src = _mirror_file(from_dir, rel) if from_dir else None
        if from_dir and src is None and rel != 'LICENSE':
            raise RowDataError(f'{rel} not found under {from_dir}', 'rowing')
        if src is not None:
            copy_checked(src, dest, sha, 'rowing')
        elif from_dir and rel == 'LICENSE':
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(inputs.ENGSTROM_LICENSE, encoding='utf-8')
            if sha256_file(dest) != sha:
                dest.unlink()
                raise RowDataError('the recorded MIT text does not match the LICENSE pin', 'rowing')
        else:
            download(inputs.ENGSTROM_URL + rel, dest, sha, 'rowing', opener=opener)
        log('ok', display(dest))
    return root


def safe_member(name):
    """A zip member name that is safe to read: relative, no '..', no drive or backslash tricks."""
    p = PurePosixPath(name.replace('\\', '/'))
    return not (p.is_absolute() or '..' in p.parts or ':' in name)


def extract_members(zip_path, out_dir, fj_ids, pins=None, kind='skin'):
    """Write each <FJ>.obj member to out_dir/<FJ>.obj (basename only; never the member path)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    want = {f'{fj}.obj' for fj in fj_ids}
    found = {}
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            base = PurePosixPath(info.filename.replace('\\', '/')).name
            if base not in want:
                continue
            is_link = (info.external_attr >> 16) & 0o170000 == 0o120000
            if not safe_member(info.filename) or is_link or info.is_dir():
                raise RowDataError(f'refusing unsafe zip member {info.filename!r}', kind)
            if base in found:
                raise RowDataError(f'zip member {base} appears twice', kind)
            dest = out_dir / base
            part = dest.with_name(base + '.part')
            try:
                with z.open(info) as src, open(part, 'wb') as fh:
                    # never write more than the member claims to hold (a lying header cannot fill the disk)
                    left = info.file_size
                    while left > 0:
                        b = src.read(min(left, 1 << 20))
                        if not b:
                            break
                        fh.write(b)
                        left -= len(b)
                    if src.read(1):
                        raise RowDataError(f'zip member {base} is longer than its header says', kind)
            except (zipfile.BadZipFile, RowDataError) as e:
                part.unlink(missing_ok=True)
                raise RowDataError(f'zip member {base}: {e}', kind) from None
            if pins and base in pins:
                _check(part, dest, pins[base], kind)
            else:
                part.replace(dest)
            found[base] = dest
    missing = sorted(want - set(found))
    if missing:
        raise RowDataError(f'zip has no member {", ".join(missing)}', kind)
    return found


def fetch_skin(paths, from_dir=None, opener=None, log=print):
    root = skin_dir(paths)
    zp = root / inputs.SKIN_ZIP
    pp = root / inputs.PARTS_FILE
    for dest, url, sha in ((zp, inputs.SKIN_URL, inputs.SKIN_SHA256), (pp, inputs.PARTS_URL, inputs.PARTS_SHA256)):
        if dest.is_file() and sha256_file(dest) == sha:
            continue
        src = Path(from_dir) / dest.name if from_dir else None
        if src is not None and src.is_file():
            copy_checked(src, dest, sha, 'skin')
        elif from_dir:
            raise RowDataError(f'{dest.name} not found under {from_dir}', 'skin')
        else:
            download(url, dest, sha, 'skin', opener=opener)
        log('ok', display(dest))
    if zp.stat().st_size != inputs.SKIN_BYTES:
        raise RowDataError(f'{display(zp)} is {zp.stat().st_size} bytes, expected {inputs.SKIN_BYTES}', 'skin')
    out = extract_members(zp, root / 'obj', [inputs.SKIN_FJ, *inputs.BONE_FJ.values()], inputs.SKIN_MEMBERS)
    for p in out.values():
        log('ok', display(p))
    return root


def require_rowing(paths, check_sha=True, root=None):
    root = Path(root) if root else rowing_dir(paths)
    for rel, sha in inputs.ENGSTROM_FILES.items():
        p = root / rel
        if not p.is_file():
            raise RowDataError(f'missing rowing data {display(p)} — run python -m row fetch rowing', 'rowing')
        if check_sha and sha256_file(p) != sha:
            raise RowDataError(f'rowing data {display(p)} does not match its pin — rerun python -m row fetch rowing',
                               'rowing')
    return root


def require_skin(paths, check_sha=True, root=None):
    obj = (Path(root) if root else skin_dir(paths)) / 'obj'
    for fj in [inputs.SKIN_FJ, *inputs.BONE_FJ.values()]:
        p = obj / f'{fj}.obj'
        if not p.is_file():
            raise RowDataError(f'missing skin data {display(p)} — run python -m row fetch skin', 'skin')
        pin = inputs.SKIN_MEMBERS.get(p.name)
        if check_sha and pin and sha256_file(p) != pin:
            raise RowDataError(f'skin data {display(p)} does not match its pin — rerun python -m row fetch skin',
                               'skin')
    return obj
