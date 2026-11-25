"""Missing-input errors and project-relative display paths, shared by squat/ and row/ (was the top of squat/paths.py)."""
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]

_HINT = {
    'fixed': 'no generator — restore with git checkout; see squat/inputs.py',
    'cache': 'regenerate it with python -m squat stage <name>; see python -m squat list',
    'stl': 'run scripts/fetch_stl.sh',
    'input': 'check the path',
}


class MissingInputError(FileNotFoundError):
    def __init__(self, path, kind, hint=None):
        self.path = Path(path)
        self.kind = kind
        self.hint = hint or _HINT[kind]
        sep = f' ({self.hint})' if kind == 'fixed' else f' — {self.hint}'
        super().__init__(f'missing {self.label} {display(self.path)}{sep}')

    @property
    def label(self):
        return {'fixed': 'fixed input', 'cache': 'cache', 'stl': 'STL', 'input': 'file'}[self.kind]


def display(path):
    path = Path(path)
    try:
        return str(path.resolve().relative_to(PROJECT))
    except ValueError:
        return str(path)
