# /// script
# requires-python = ">=3.10"
# ///
"""Unit tests for wake.py."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path


def test_wake_routes_to_first_breath_when_no_sanctum():
    with tempfile.TemporaryDirectory() as tmp:
        project_root = Path(tmp)
        (project_root / "_bmad").mkdir()
        skill_path = Path(__file__).resolve().parent.parent
        wake = skill_path / "wake.py"

        env = os.environ.copy()
        env["PYTHONPATH"] = str(skill_path)

        result = subprocess.run(
            [sys.executable, str(wake), str(project_root)],
            capture_output=True,
            text=True,
            env=env,
        )

        assert result.returncode == 0
        assert "MODE: FIRST_BREATH" in result.stdout
        assert "NO SANCTUM" in result.stdout


def test_wake_loads_sanctum_when_present():
    with tempfile.TemporaryDirectory() as tmp:
        project_root = Path(tmp)
        sanctum = project_root / "_bmad" / "memory" / "xactions-test-engineer"
        sanctum.mkdir(parents=True)
        (sanctum / "CREED.md").write_text("# Creed")
        (sanctum / "MEMORY.md").write_text("# Memory")

        skill_path = Path(__file__).resolve().parent.parent
        wake = skill_path / "wake.py"

        env = os.environ.copy()
        env["PYTHONPATH"] = str(skill_path)

        result = subprocess.run(
            [sys.executable, str(wake), str(project_root)],
            capture_output=True,
            text=True,
            env=env,
        )

        assert result.returncode == 0
        assert "MODE: WAKING" in result.stdout
        assert "Sanctum:" in result.stdout


def test_wake_pulse_appends_pulse_md():
    with tempfile.TemporaryDirectory() as tmp:
        project_root = Path(tmp)
        sanctum = project_root / "_bmad" / "memory" / "xactions-test-engineer"
        sanctum.mkdir(parents=True)
        (sanctum / "CREED.md").write_text("# Creed")
        (sanctum / "MEMORY.md").write_text("# Memory")
        (sanctum / "PULSE.md").write_text("# Pulse")

        skill_path = Path(__file__).resolve().parent.parent
        wake = skill_path / "wake.py"

        env = os.environ.copy()
        env["PYTHONPATH"] = str(skill_path)

        result = subprocess.run(
            [sys.executable, str(wake), str(project_root), "--pulse"],
            capture_output=True,
            text=True,
            env=env,
        )

        assert result.returncode == 0
        assert "MODE: PULSE" in result.stdout
        assert "PULSE.md" in result.stdout


def test_wake_missing_args_returns_error():
    skill_path = Path(__file__).resolve().parent.parent
    wake = skill_path / "wake.py"

    env = os.environ.copy()
    env["PYTHONPATH"] = str(skill_path)

    result = subprocess.run(
        [sys.executable, str(wake)],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 2
