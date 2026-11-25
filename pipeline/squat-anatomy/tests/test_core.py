"""core/ is movement-neutral: it never imports squat/ or row/, and every moved name has one home (#755)."""
import ast
import importlib.util
import os
import subprocess
import sys

CORE_MODULES = ('core.geom', 'core.dqs', 'core.paths')
SKIP = {'node_modules', '.pytest_cache', '__pycache__'}
# names whose only home is core/: importing them from their old module is refused even where it would still work
ONE_HOME = {'squat.paths': {'MissingInputError', 'display', 'PROJECT'}}
GONE = ('squat.geom', 'squat.model.dqs')


def _imported(path):
    for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
        if isinstance(node, ast.Import):
            yield from (a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            yield node.module


def test_core_never_imports_squat_or_row(paths):
    files = sorted((paths.project / 'core').glob('*.py'))
    assert files
    bad = [f'{p.name}: {m}' for p in files for m in _imported(p) if m.split('.')[0] in ('squat', 'row')]
    assert not bad, bad


def test_core_imports_alone(paths, tmp_path):
    code = (f'import sys, {", ".join(CORE_MODULES)}\n'
            "bad = [m for m in sys.modules if m.split('.')[0] in ('squat', 'row')]\n"
            'assert not bad, bad')
    env = {**os.environ, 'PYTHONPATH': str(paths.project)}
    r = subprocess.run([sys.executable, '-c', code], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_moved_modules_are_gone():
    assert [n for n in GONE if importlib.util.find_spec(n) is not None] == []


def test_moved_names_have_one_home(paths):
    bad = []
    for p in sorted(paths.project.rglob('*.py')):
        rel = p.relative_to(paths.project)
        if SKIP.intersection(rel.parts) or rel.parts[0] == 'core' or rel.as_posix().startswith('pipeline/ext/'):
            continue
        for node in ast.walk(ast.parse(p.read_text(encoding='utf-8'))):
            if isinstance(node, ast.ImportFrom) and node.module in ONE_HOME:
                bad += [f'{rel}:{node.lineno} {a.name}' for a in node.names if a.name in ONE_HOME[node.module]]
    assert not bad, bad
