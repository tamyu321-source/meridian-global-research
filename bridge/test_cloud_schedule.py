import os
from pathlib import Path
import subprocess
import sys
import unittest


class CloudScheduleTests(unittest.TestCase):
    def test_prepare_cli_imports_without_analytical_dependencies(self):
        repository = Path(__file__).resolve().parent.parent
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        result = subprocess.run(
            [sys.executable, "-S", "bridge/cloud_schedule.py", "--help"],
            cwd=repository,
            env=environment,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("prepare", result.stdout)


if __name__ == "__main__":
    unittest.main()
