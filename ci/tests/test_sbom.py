import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sbom


class SbomTests(unittest.TestCase):
    def make_root(self, root):
        package = root / "node_modules/.pnpm/example@1.2.3/node_modules/example"
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"name": "example", "version": "1.2.3", "license": "MIT"}))
        (root / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\npackages: {}\n")
        (root / "uv.lock").write_text("version = 1\n[[package]]\nname = 'sample-lib'\nversion = '4.5.6'\n")
        meta = root / ".venv/lib/python3.13/site-packages/sample_lib-4.5.6.dist-info"
        meta.mkdir(parents=True)
        (meta / "METADATA").write_text("Name: sample-lib\nVersion: 4.5.6\nClassifier: License :: OSI Approved :: BSD License\n")
        (root / "package.json").write_text(json.dumps({"name": "workspace", "version": "0.0.0", "license": "UNLICENSED"}))

    def test_render_includes_locked_components_and_license_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_root(root)
            output = json.loads(sbom.render(root))
            components = {item["bom-ref"]: item for item in output["components"]}
            self.assertEqual(components["npm:example@1.2.3"]["licenses"][0]["license"]["name"], "MIT")
            self.assertEqual(components["pypi:sample-lib@4.5.6"]["licenses"][0]["license"]["name"], "OSI Approved :: BSD License")
            self.assertEqual(components["workspace:workspace@0.0.0"]["licenses"][0]["license"]["name"], "UNLICENSED")
            self.assertEqual(output["bomFormat"], "CycloneDX")

    def test_license_value_does_not_invent_a_license(self):
        self.assertEqual(sbom.license_value(None), "UNKNOWN")
        self.assertEqual(sbom.license_value({}), "UNKNOWN")
        self.assertEqual(sbom.license_value({"type": "Apache-2.0"}), "Apache-2.0")

    def test_nested_fixtures_are_not_dependency_components(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_root(root)
            package = root / "node_modules/.pnpm/example@1.2.3/node_modules/example"
            for directory in ("benchmarks", "test/fixtures/transport"):
                nested = package / directory
                nested.mkdir(parents=True)
                (nested / "package.json").write_text(json.dumps({"name": directory, "version": "0.0.1"}))
            scoped = root / "node_modules/.pnpm/scoped@2.0/node_modules/@scope/scoped"
            scoped.mkdir(parents=True)
            (scoped / "package.json").write_text(json.dumps({"name": "@scope/scoped", "version": "2.0", "license": "MIT"}))
            self.assertEqual(set(sbom.node_components(root)), {"npm:example@1.2.3", "npm:@scope/scoped@2.0"})

    def test_unknown_license_uses_available_classifier(self):
        with tempfile.TemporaryDirectory() as temp:
            metadata = Path(temp) / "METADATA"
            metadata.write_text("License: UNKNOWN\nClassifier: License :: OSI Approved :: Apache Software License\n")
            self.assertEqual(sbom.metadata_license(metadata), ("OSI Approved :: Apache Software License", "classifier"))
            metadata.write_text("License: UNKNOWN\n")
            self.assertEqual(sbom.metadata_license(metadata), ("UNKNOWN", "unknown"))

    def test_missing_metadata_requires_reviewed_exact_locked_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_root(root)
            url = "https://example.invalid/sample.whl"
            with (root / "uv.lock").open("a") as lock:
                lock.write(f"wheels = [{{url = '{url}', hash = 'sha256:synthetic'}}]\n")
            metadata = next(root.glob(".venv/**/METADATA"))
            metadata.unlink()
            key = "pypi:sample-lib@4.5.6"
            self.assertEqual(sbom.python_components(root)[key]["licenses"][0]["license"]["name"], "UNKNOWN")
            evidence = root / "docs/supply-chain/python-license-evidence.json"
            evidence.parent.mkdir(parents=True)
            record = {key: {"license": "BSD-3-Clause", "artifact_url": url, "artifact_hash": "sha256:synthetic", "license_file": "sample.dist-info/LICENSE"}}
            evidence.write_text(json.dumps(record))
            item = sbom.python_components(root)[key]
            self.assertEqual(item["licenses"][0]["license"]["name"], "BSD-3-Clause")
            self.assertIn({"name": "lmps:license-evidence-url", "value": url}, item["properties"])
            for field, value in (("artifact_url", "https://example.invalid/changed.whl"), ("artifact_hash", "sha256:changed"), ("license", "UNKNOWN")):
                changed = {key: {**record[key], field: value}}
                evidence.write_text(json.dumps(changed))
                with self.assertRaisesRegex(RuntimeError, "no longer matches"):
                    sbom.python_components(root)
            evidence.write_text(json.dumps({"pypi:sample-lib@9.9.9": record[key]}))
            with self.assertRaisesRegex(RuntimeError, "no longer matches"):
                sbom.python_components(root)


if __name__ == "__main__":
    unittest.main()
