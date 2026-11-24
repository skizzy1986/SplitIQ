"""Fixtures for the rowing spike tests. A missing data set skips unless its own strict variable is set
(not CI=true: CI does not fetch the rowing data or the skin, so keying on it would fail the job)."""
import os

import pytest

from row.fetch import RowDataError, require_rowing, require_skin


def _need(env, fn, paths):
    def check():
        try:
            return fn(paths)
        except RowDataError as e:
            if os.environ.get(env) == '1':
                pytest.fail(str(e))
            pytest.skip(str(e))
    return check


@pytest.fixture(scope='session')
def need_rowing(paths):
    return _need('ROW_STRICT_DATA', require_rowing, paths)


@pytest.fixture(scope='session')
def need_skin(paths):
    return _need('ROW_STRICT_SKIN', require_skin, paths)
