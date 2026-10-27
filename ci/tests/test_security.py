from contextlib import redirect_stdout
from hashlib import sha1
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import security
import yaml


class SecurityTests(unittest.TestCase):
    def test_publication_paths(self):
        for name in (".env", "apps/.env.local", "data/sample.json", "export.sql", "rows.csv", "private/a.txt", "credentials.json", "packages/database/migrations/export.sql"):
            with self.subTest(name=name):
                self.assertTrue(security.forbidden_file(name))
        for name in (".env.example", security.SYNTHETIC_SQL, "packages/database/migrations/0000_foundation.sql", "packages/database/migrations/0001_local_source_intake.sql", "packages/database/migrations/0002_intake_column_grants.sql", "packages/database/migrations/0003_local_outbox.sql", "packages/database/migrations/0004_local_audit.sql", "packages/database/migrations/0005_local_sync_jobs.sql", "packages/database/migrations/0006_local_transaction_revisions.sql", "packages/database/migrations/0007_local_normalization_publications.sql", "packages/database/migrations/0008_local_rule_assessments.sql", "packages/database/migrations/0009_local_transaction_risks.sql", "packages/database/migrations/0010_local_alerts.sql", "packages/database/migrations/0011_local_risk_jobs.sql", "packages/database/migrations/0012_offline_datasets.sql", "packages/database/migrations/0013_local_risk_policy_lifecycle.sql", "packages/database/migrations/0014_local_cases.sql", "src/main.ts", "uv.lock"):
            self.assertFalse(security.forbidden_file(name))

    def test_git_selection_includes_untracked_and_force_added_ignored_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            subprocess.run(["git", "init", "--quiet", temp], check=True)
            (root / ".gitignore").write_text("*.private\n")
            for name in ("visible.py", "hidden.private", "tracked.private"):
                (root / name).write_text("synthetic")
            subprocess.run(["git", "add", "--force", "tracked.private"], cwd=root, check=True)
            self.assertEqual(security.project_files(root), [".gitignore", "tracked.private", "visible.py"])

    def test_symlink_rejected_without_following_target(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "link").symlink_to(root / "absent")
            with redirect_stdout(io.StringIO()):
                self.assertFalse(security.scan(root, ["link"]))

    def test_empty_scan_fails(self):
        with self.assertRaises(RuntimeError):
            security.scan(Path("."), [])

    def test_real_scanner_rejects_secret_even_with_inline_allowlist_without_echoing(self):
        value = "synthetic" + "Credential" + "93746152" + "zY"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "example.py").write_text('password = "' + value + '" # pragma: allowlist secret\n')
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertFalse(security.scan(root, ["example.py"]))
            self.assertNotIn(value, output.getvalue())

    def test_scanner_network_verification_disabled_and_errors_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "source.py").write_text("pass")
            result = subprocess.CompletedProcess([], 1, "private diagnostic", "private diagnostic")
            with patch.object(security.subprocess, "run", return_value=result) as run:
                with self.assertRaisesRegex(RuntimeError, "output withheld"):
                    security.scan(root, ["source.py"])
                self.assertIn("--no-verify", run.call_args.args[0])

    def test_checksum_exemptions_are_scoped_by_file_plugin_and_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "pnpm-lock.yaml").write_text("    resolution: {integrity: sha512-" + "A" * 86 + "==}\n")
            finding = {"type": "Base64 High Entropy String", "line_number": 1}
            self.assertTrue(security.is_public_metadata(root, "pnpm-lock.yaml", finding))
            self.assertFalse(security.is_public_metadata(root, "another.yaml", finding))
            self.assertFalse(security.is_public_metadata(root, "pnpm-lock.yaml", dict(finding, type="Secret Keyword")))
            (root / "pnpm-lock.yaml").write_text("            integrity: sha256-" + "A" * 43 + "=\n")
            self.assertTrue(security.is_public_metadata(root, "pnpm-lock.yaml", finding))
            (root / "pnpm-lock.yaml").write_text('pass' + 'word: "unexpected"\n')
            self.assertFalse(security.is_public_metadata(root, "pnpm-lock.yaml", finding))
            name = "docs/data-dictionary/lmps-schema/metadata.json"
            (root / name).parent.mkdir(parents=True)
            fingerprint = "a" * 64
            (root / name).write_text(json.dumps({"source": {"sha256": fingerprint}}))
            finding = {"type": "Hex High Entropy String", "hashed_secret": sha1(fingerprint.encode()).hexdigest()}
            self.assertTrue(security.is_public_metadata(root, name, finding))
            self.assertFalse(security.is_public_metadata(root, name, dict(finding, hashed_secret="")))

    def test_mariadb_checksum_exemptions_reject_other_fields_and_other_detectors(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fingerprint = 'b' * 64
            for name, key in [('infrastructure/mariadb/runtime.json', 'sha256'), ('infrastructure/mariadb/repository.json', 'helper_sha256')]:
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text(json.dumps({key: fingerprint}))
                finding = {'type': 'Hex High Entropy String', 'hashed_secret': sha1(fingerprint.encode()).hexdigest()}
                self.assertTrue(security.is_public_metadata(root, name, finding))
                self.assertFalse(security.is_public_metadata(root, name, dict(finding, hashed_secret='')))
                self.assertFalse(security.is_public_metadata(root, name, dict(finding, type='Secret Keyword')))

    def test_local_sbom_lock_hashes_require_the_expected_property_and_lock_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "pnpm-lock.yaml").write_text("pnpm lock")
            (root / "uv.lock").write_text("uv lock")
            pnpm_hash = security.sha256((root / "pnpm-lock.yaml").read_bytes()).hexdigest()
            name = "docs/supply-chain/local-sbom.cdx.json"
            (root / name).parent.mkdir(parents=True)
            (root / name).write_text(json.dumps({"metadata": {"properties": [{"name": "lmps:pnpm-lock-sha256", "value": pnpm_hash}]}}))
            finding = {"type": "Hex High Entropy String", "hashed_secret": sha1(pnpm_hash.encode()).hexdigest()}
            self.assertTrue(security.is_public_metadata(root, name, finding))
            self.assertFalse(security.is_public_metadata(root, name, dict(finding, hashed_secret="")))
            (root / name).write_text(json.dumps({"metadata": {"properties": [{"name": "different", "value": pnpm_hash}]}}))
            self.assertFalse(security.is_public_metadata(root, name, finding))
            (root / "pnpm-lock.yaml").write_text("changed")
            (root / name).write_text(json.dumps({"metadata": {"properties": [{"name": "lmps:pnpm-lock-sha256", "value": pnpm_hash}]}}))
            self.assertFalse(security.is_public_metadata(root, name, finding))


    def test_algorithm_name_exemption_does_not_allow_an_actual_credential_line(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            name = "infrastructure/postgres/postgresql.conf"
            (root / name).parent.mkdir(parents=True)
            (root / name).write_text("password_" + "encryption = 'scram-sha-256'\n")
            finding = {"type": "Secret Keyword", "line_number": 1}
            self.assertTrue(security.is_public_metadata(root, name, finding))
            (root / name).write_text("pass" + "word = 'synthetic'\n")
            self.assertFalse(security.is_public_metadata(root, name, finding))


class TemplateTests(unittest.TestCase):
    def test_github_template_has_pinned_actions_and_read_only_permissions(self):
        template = yaml.load((security.ROOT / ".github/workflows/verify.yml").read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(template["permissions"], {"contents": "read"})
        self.assertIn("pull_request", template["on"])
        steps = template["jobs"]["verify"]["steps"]
        for step in steps:
            if "uses" in step:
                self.assertRegex(step["uses"], r"^actions/(checkout|setup-node)@[0-9a-f]{40}$")
        self.assertEqual(steps[0]["with"]["persist-credentials"], "false")
        self.assertEqual(steps[-1]["run"], "pnpm verify")
        self.assertNotIn("artifacts", template["jobs"]["verify"])

if __name__ == "__main__":
    unittest.main()
