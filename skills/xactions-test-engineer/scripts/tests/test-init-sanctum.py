# /// script
# requires-python = ">=3.10"
# ///
"""Unit tests for init-sanctum.py."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path


def test_init_sanctum_scaffolds_sanctum():
    with tempfile.TemporaryDirectory() as tmp:
        project_root = Path(tmp)
        (project_root / "_bmad").mkdir()
        (project_root / "_bmad" / "config.yaml").write_text("user_name: test\n")
        skill_path = Path(__file__).resolve().parent.parent
        init = skill_path / "init-sanctum.py"

        env = os.environ.copy()
        env["PYTHONPATH"] = str(skill_path)

        result = subprocess.run(
            [sys.executable, str(init), str(project_root), str(project_root)],
            capture_output=True,
            text=True,
            env=env,
        )

        assert result.returncode == 0
        assert "First Breath scaffolding complete" in result.stdout

        sanctum = project_root / "_bmad" / "memory" / "xactions-test-engineer"
        assert (sanctum / "CREED.md").exists()
        assert (sanctum / "PERSONA.md").exists()
        assert (sanctum / "BOND.md").exists()
        assert (sanctum / "CAPABILITIES.md").exists()


def test_init_sanctum_is_idempotent():
    with tempfile.TemporaryDirectory() as tmp:
        project_root = Path(tmp)
        (project_root / "_bmad").mkdir()
        (project_root / "_bmad" / "config.yaml").write_text("user_name: test\n")
        skill_path = Path(__file__).resolve().parent.parent
        init = skill_path / "init-sanctum.py"

        env = os.environ.copy()
        env["PYTHONPATH"] = str(skill_path)

        # First run
        result1 = subprocess.run(
            [sys.executable, str(init), str(project_root), str(project_root)],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result1.returncode == 0

        # Second run
        result2 = subprocess.run(
            [sys.executable, str(init), str(project_root), str(project_root)],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result2.returncode == 0
        assert "Sanctum already exists" in result2.stdout
