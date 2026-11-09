from contextlib import redirect_stdout, redirect_stderr
import io
import json
import time
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fresh
import verify


class VerificationTests(unittest.TestCase):
    def test_child_failure_stops_verification_without_echoing_tool_output(self):
        with redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, r"failed \(exit 2\)") as error:
                verify.run("audit", [sys.executable, "-c", "import sys; print('sensitive diagnostic'); sys.exit(2)"], capture=True)
        self.assertNotIn("sensitive diagnostic", str(error.exception))

    def test_timeout_stops_child_group_before_workspace_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            sentinel = str(Path(directory) / 'late-write')
            # An actual grandchild ignores TERM and would write after the direct
            # parent dies unless the timed-out command group is fully stopped.
            child = "import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(1.5); pathlib.Path(" + repr(sentinel) + ").write_text('orphan')"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); time.sleep(30)"
            with redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "timed out; command group stopped"):
                    verify.run("synthetic timeout", [sys.executable, "-c", parent], timeout=0.4)
            time.sleep(1.6)
            self.assertFalse(Path(sentinel).exists())

    def test_successful_capture_returns_stdout(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(verify.run("synthetic capture", [sys.executable, "-c", "print('ok')"], capture=True), "ok\n")

    def test_failed_scan_does_not_start_any_other_check(self):
        with patch.object(verify, "project_files", return_value=["source.py"]), patch.object(verify, "scan", return_value=False), patch.object(verify, "run") as run:
            self.assertEqual(verify.main([]), 1)
            run.assert_not_called()

    def test_unexpected_failure_is_redacted(self):
        output = io.StringIO()
        with patch.object(verify, "project_files", side_effect=ValueError("sensitive diagnostic")), redirect_stderr(output):
            self.assertEqual(verify.main([]), 1)
        self.assertNotIn("sensitive diagnostic", output.getvalue())

    def test_failed_fresh_install_cleans_temporary_workspace_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "source.py").write_text("synthetic source")
            (root / 'infrastructure/mariadb').mkdir(parents=True)
            (root / 'infrastructure/mariadb/runtime.json').write_text(json.dumps({'formula': 'mariadb@11.8', 'bottle_version': 'synthetic'}))
            targets = []

            def fail(command, **kwargs):
                targets.append(kwargs["cwd"])
                raise subprocess.CalledProcessError(1, command)

            with patch.object(fresh, "ROOT", root), patch.object(fresh, "project_files", return_value=["source.py"]), patch.object(fresh, "scan", return_value=True), patch.object(fresh.subprocess, "run", side_effect=fail):
                with self.assertRaises(subprocess.CalledProcessError):
                    fresh.main()
            self.assertEqual((root / "source.py").read_text(), "synthetic source")
            self.assertFalse(targets[0].exists())

    def test_fresh_checkout_needs_no_sibling_and_copies_no_private_state(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "backend"
            (root / "tools").mkdir(parents=True)
            (root / "tools/portal-intake-policy.mjs").write_text("// synthetic source")
            (root / ".env").write_text("private canary never copied")
            (root / "infrastructure/mariadb").mkdir(parents=True)
            (root / "infrastructure/mariadb/runtime.json").write_text(json.dumps({"formula": "mariadb@11.8", "bottle_version": "synthetic"}))
            targets = []

            def command(command, **kwargs):
                target = kwargs["cwd"]
                targets.append(target)
                self.assertEqual((target / "tools/portal-intake-policy.mjs").read_text(), "// synthetic source")
                self.assertFalse((target / ".env").exists())
                self.assertFalse((target.parent / "LMPS_Risk_Portal").exists())

            with patch.object(fresh, "ROOT", root), patch.object(fresh, "project_files", return_value=["tools/portal-intake-policy.mjs"]), patch.object(fresh, "scan", return_value=True), patch.object(fresh.subprocess, "run", side_effect=command):
                self.assertEqual(fresh.main(), 0)
            self.assertEqual(len(targets), 4)
            self.assertFalse(targets[0].parent.exists())

    def test_fresh_detects_original_source_changes_and_cleans_temporary_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "source.py").write_text("synthetic source")
            targets = []

            def command(command, **kwargs):
                targets.append(kwargs["cwd"])
                if command == ["pnpm", "verify:offline"]:
                    (root / "source.py").write_text("changed source")

            with patch.object(fresh, "ROOT", root), patch.object(fresh, "project_files", return_value=["source.py"]), patch.object(fresh, "scan", return_value=True), patch.object(fresh.subprocess, "run", side_effect=command), patch.dict(fresh.os.environ, {"LMPS_MARIADB_BASE": "/synthetic/runtime"}):
                with self.assertRaisesRegex(RuntimeError, "Original source changed"):
                    fresh.main()
            self.assertFalse(targets[0].parent.exists())

    def test_fresh_failed_publication_scan_starts_no_commands(self):
        with patch.object(fresh, "project_files", return_value=["source.py"]), patch.object(fresh, "scan", return_value=False), patch.object(fresh.subprocess, "run") as run:
            self.assertEqual(fresh.main(), 1)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
