"""python -m row: help, the one-line data errors (exit 5), and a report written only under --out."""
import os
import subprocess
import sys

import pytest

from row.cli import main


def _row(paths, *args, cwd=None):
    env = {**os.environ, 'PYTHONPATH': str(paths.project)}
    return subprocess.run([sys.executable, '-m', 'row', *args], cwd=cwd or paths.project, env=env, capture_output=True,
                          text=True)


@pytest.mark.parametrize('args', [['--help'], ['spike', '--help'], ['fetch', '--help']])
def test_help(paths, args):
    r = _row(paths, *args)
    assert r.returncode == 0 and 'usage' in r.stdout


def test_unknown_step_is_usage_error():
    with pytest.raises(SystemExit) as e:
        main(['spike', 'nope'])
    assert e.value.code == 2


def _one_line(r, code):
    assert r.returncode == code, (r.returncode, r.stderr)
    assert 'Traceback' not in r.stderr and len(r.stderr.strip().splitlines()) == 1


def test_missing_rowing_data_exits_5(paths, tmp_path):
    r = _row(paths, 'spike', 'poses', '--rowing-dir', str(tmp_path / 'none'), '--out', str(tmp_path / 'out'),
             cwd=tmp_path)
    _one_line(r, 5)
    assert 'rowing' in r.stderr


def test_missing_skin_exits_5(paths, tmp_path):
    r = _row(paths, 'spike', 'skin', '--skin-dir', str(tmp_path / 'none'), '--out', str(tmp_path / 'out'), cwd=tmp_path)
    _one_line(r, 5)


def test_fetch_from_empty_mirror_exits_5(paths, tmp_path):
    env_root = tmp_path / 'root'
    env = {**os.environ, 'PYTHONPATH': str(paths.project), 'SQUAT_ROOT': str(env_root)}
    r = subprocess.run([sys.executable, '-m', 'row', 'fetch', 'rowing', '--from-dir', str(tmp_path / 'empty')],
                       cwd=tmp_path, env=env, capture_output=True, text=True)
    _one_line(r, 5)


def test_report_writes_only_under_out(paths, tmp_path):
    out = tmp_path / 'out'
    out.mkdir()
    before = sorted(p for p in (paths.project / 'out').rglob('*') if p.is_file()) if (paths.project / 'out').is_dir() else []
    stamps = {p: p.stat().st_mtime_ns for p in before}
    r = _row(paths, 'spike', 'report', '--out', str(out), cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in out.iterdir()) == ['metrics.json', 'report-summary.md', 'report.md']
    assert '**VERDICT: INCOMPLETE**' in (out / 'report.md').read_text(encoding='utf-8')
    after = sorted(p for p in (paths.project / 'out').rglob('*') if p.is_file()) if (paths.project / 'out').is_dir() else []
    assert after == before and all(p.stat().st_mtime_ns == stamps[p] for p in after)


def test_tampered_shipped_bin_exits_3(paths, tmp_path, monkeypatch, capsys):
    import functools
    import gzip

    from row.spike import squatdata
    src = paths.repo / 'web' / 'src' / 'squat' / 'assets' / 'squat-anatomy.bin'
    raw = bytearray(gzip.decompress(src.read_bytes()))
    raw[500] ^= 1
    bad = tmp_path / 'squat-anatomy.bin'
    bad.write_bytes(gzip.compress(bytes(raw), mtime=0))
    monkeypatch.setattr(squatdata, 'load_shipped', functools.partial(squatdata.load_shipped, bin_path=bad))
    assert main(['spike', 'fk', '--out', str(tmp_path / 'out')]) == 3
    err = capsys.readouterr().err
    assert len(err.strip().splitlines()) == 1 and 'not the golden squat data' in err and 'Traceback' not in err
