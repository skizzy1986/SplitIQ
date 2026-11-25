"""python -m row spike {all|fk|rig|upper|poses|skin|render|report} | fetch {rowing|skin}

Exit codes: 0 ok (a NO-GO verdict included: the report is the product); 2 usage; 3 a missing fixed input or
cache, or a shipped squat bin that is not the golden data; 4 a missing STL; 5 missing or bad rowing data or skin.
"""
import argparse
import sys
from pathlib import Path

from row.fetch import RowDataError
from row.spike.engstrom import EngstromDataError
from row.spike.squatdata import ShippedDataError
from core.paths import MissingInputError
from squat.paths import Paths

EXIT_MISSING, EXIT_STL, EXIT_DATA = 3, 4, 5
STEPS = ('all', 'fk', 'rig', 'upper', 'poses', 'skin', 'render', 'report')


def _parser():
    p = argparse.ArgumentParser(prog='python -m row', description=__doc__.split('\n\n')[0])
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('spike', help='run one step of the #754 feasibility spike (or all of it)')
    s.add_argument('step', choices=STEPS)
    s.add_argument('--out', type=Path, help='default: out/spike')
    s.add_argument('--rowing-dir', type=Path, help='default: pipeline/ext/rowing')
    s.add_argument('--skin-dir', type=Path, help='default: pipeline/ext/skin')
    s.add_argument('--no-renders', action='store_true', help='skip the PNG and GLB renders')
    f = sub.add_parser('fetch', help='download and pin-check the external data')
    f.add_argument('what', choices=('rowing', 'skin'))
    f.add_argument('--from-dir', type=Path, help='copy from a local mirror instead of the network (same sha checks)')
    return p


def main(argv=None):
    args = _parser().parse_args(argv)
    paths = Paths.from_env()
    try:
        if args.cmd == 'fetch':
            from row.fetch import fetch_rowing, fetch_skin
            (fetch_rowing if args.what == 'rowing' else fetch_skin)(paths, from_dir=args.from_dir)
            return 0
        from row.spike.run import run
        run(paths, args.step, out=args.out or paths.project / 'out' / 'spike', rowing_dir=args.rowing_dir,
            skin_dir=args.skin_dir, renders=not args.no_renders)
        return 0
    except (RowDataError, EngstromDataError) as e:
        print(f'row: {e}', file=sys.stderr)
        return EXIT_DATA
    except MissingInputError as e:
        print(f'row: {e}', file=sys.stderr)
        return EXIT_STL if e.kind == 'stl' else EXIT_MISSING
    except ShippedDataError as e:
        print(f'row: {e}', file=sys.stderr)
        return EXIT_MISSING
