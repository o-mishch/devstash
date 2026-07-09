"""Scaffold smoke tests — the package imports and the CLI resolves.

These are placeholders proving the skeleton is wired; real parity suites replace
and extend them as each shell module is ported (see the port order in the spec).
"""

import sys

from typer.testing import CliRunner

from devstash_infra import __version__
from devstash_infra.cli import app


def test_package_version() -> None:
    assert __version__ == "0.1.0"


def test_cli_help_resolves() -> None:
    # The `ci` sub-app is mounted, so the root command resolves and lists it.
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "Usage:" in result.output
    assert "ci" in result.output


def test_runtime_floor_is_supported() -> None:
    # Dev/CI run 3.14; the CLI floor is 3.11. Guard against an unsupported env.
    assert sys.version_info >= (3, 11)
