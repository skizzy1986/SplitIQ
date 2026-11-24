"""The spike's external pins, the checked download and the zip extraction (no network)."""
import hashlib
import re
import subprocess
import sys
import zipfile

import pytest

from row import inputs
from row.fetch import RowDataError, download, extract_members, fetch_rowing

HEX64 = re.compile(r'^[0-9a-f]{64}$')


def test_pins_are_sha256():
    pins = [*inputs.ENGSTROM_FILES.values(), *inputs.SKIN_MEMBERS.values(), inputs.SKIN_SHA256, inputs.PARTS_SHA256]
    assert all(HEX64.match(p) for p in pins)
    assert len(inputs.ENGSTROM_FILES) == len(inputs.ENGSTROM_SUBJECTS) * 8 + 2
    assert set(inputs.SKIN_MEMBERS) == {f'{fj}.obj' for fj in [inputs.SKIN_FJ, *inputs.BONE_FJ.values()]}
    assert hashlib.sha256(inputs.ENGSTROM_LICENSE.encode()).hexdigest() == inputs.ENGSTROM_FILES['LICENSE']
    assert re.fullmatch(r'[0-9a-f]{40}', inputs.ENGSTROM_COMMIT)


def test_download_checks_sha(tmp_path):
    src = tmp_path / 'src.txt'
    src.write_bytes(b'hello')
    good = hashlib.sha256(b'hello').hexdigest()
    dest = tmp_path / 'd' / 'f.txt'
    download(src.as_uri(), dest, good, 'rowing')
    assert dest.read_bytes() == b'hello' and not (tmp_path / 'd' / 'f.txt.part').exists()
    bad = tmp_path / 'd' / 'g.txt'
    with pytest.raises(RowDataError) as e:
        download(src.as_uri(), bad, '0' * 64, 'rowing')
    assert e.value.kind == 'rowing' and 'mismatch' in str(e.value)
    assert not bad.exists() and not (tmp_path / 'd' / 'g.txt.part').exists()


def test_download_retries_then_fails(tmp_path):
    calls = []

    def opener(req, timeout):
        calls.append(req.full_url)
        raise OSError('offline')
    with pytest.raises(RowDataError):
        download('https://example.invalid/x', tmp_path / 'x', '0' * 64, 'skin', opener=opener, sleep=lambda s: None)
    assert len(calls) == 3 and not (tmp_path / 'x.part').exists()


def _zip(path, members):
    with zipfile.ZipFile(path, 'w') as z:
        for name, data in members.items():
            z.writestr(name, data)


def test_extract_writes_basenames_only(tmp_path):
    zp = tmp_path / 'a.zip'
    _zip(zp, {'deep/dir/FJ1.obj': 'v 0 0 0\n', 'other/FJ9.obj': 'x'})
    out = extract_members(zp, tmp_path / 'obj', ['FJ1'], {'FJ1.obj': hashlib.sha256(b'v 0 0 0\n').hexdigest()})
    assert out == {'FJ1.obj': tmp_path / 'obj' / 'FJ1.obj'}
    assert sorted(p.name for p in (tmp_path / 'obj').iterdir()) == ['FJ1.obj']
    assert not (tmp_path / 'deep').exists()


@pytest.mark.parametrize('name', ['../FJ1.obj', '/abs/FJ1.obj', 'a/../../FJ1.obj', 'C:\\x\\FJ1.obj'])
def test_extract_rejects_traversal(tmp_path, name):
    zp = tmp_path / 'a.zip'
    _zip(zp, {name: 'v 0 0 0\n'})
    with pytest.raises(RowDataError):
        extract_members(zp, tmp_path / 'obj', ['FJ1'])
    assert not (tmp_path / 'FJ1.obj').exists()


def test_extract_rejects_bad_member_sha(tmp_path):
    zp = tmp_path / 'a.zip'
    _zip(zp, {'FJ1.obj': 'v 0 0 0\n'})
    with pytest.raises(RowDataError):
        extract_members(zp, tmp_path / 'obj', ['FJ1'], {'FJ1.obj': '0' * 64})
    assert not (tmp_path / 'obj' / 'FJ1.obj').exists() and not (tmp_path / 'obj' / 'FJ1.obj.part').exists()


def test_fetch_from_dir_missing_is_data_error(paths, tmp_path):
    from dataclasses import replace
    p = replace(paths, data=tmp_path / 'root')
    with pytest.raises(RowDataError) as e:
        fetch_rowing(p, from_dir=tmp_path / 'empty', log=lambda *a: None)
    assert e.value.kind == 'rowing'
    assert not list((tmp_path / 'root').rglob('*.part'))


def test_gitignore_keeps_the_data_out(paths):
    lines = (paths.project / '.gitignore').read_text(encoding='utf-8').splitlines()
    assert 'pipeline/ext/rowing/' in lines and 'pipeline/ext/skin/' in lines and 'out/' in lines


def test_no_network_at_import(paths):
    code = ('import socket\n'
            'def no(*a, **k): raise RuntimeError("network at import")\n'
            'socket.socket.connect = no; socket.create_connection = no\n'
            'import row.cli, row.fetch, row.inputs\n')
    r = subprocess.run([sys.executable, '-c', code], cwd=paths.project, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_download_http_error_leaves_no_part(tmp_path):
    import http.client

    class Body:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, *a):
            raise http.client.IncompleteRead(b'partial')

    def opener(req, timeout):
        return Body()
    with pytest.raises(RowDataError):
        download('https://example.invalid/x', tmp_path / 'x', '0' * 64, 'rowing', opener=opener, sleep=lambda s: None)
    assert not (tmp_path / 'x.part').exists() and not (tmp_path / 'x').exists()


def test_extract_caps_at_the_member_size(tmp_path, monkeypatch):
    import zipfile
    zp = tmp_path / 'a.zip'
    _zip(zp, {'FJ1.obj': 'v 0 0 0\n' * 100})
    real = zipfile.ZipFile.infolist

    def lying(self):
        out = real(self)
        for i in out:
            i.file_size = 10                        # the header claims less than the member holds
        return out
    monkeypatch.setattr(zipfile.ZipFile, 'infolist', lying)
    with pytest.raises(RowDataError):
        extract_members(zp, tmp_path / 'obj', ['FJ1'])
    assert not (tmp_path / 'obj' / 'FJ1.obj').exists() and not (tmp_path / 'obj' / 'FJ1.obj.part').exists()
