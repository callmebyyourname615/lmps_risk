"""Render and verify the local, lock-bound CycloneDX component inventory."""

import argparse
from email.parser import Parser
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/supply-chain/local-sbom.cdx.json"


def normalized_name(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def license_value(value):
    if isinstance(value, str) and value.strip() and value.strip().upper() != "UNKNOWN":
        return value.strip()
    if isinstance(value, dict) and isinstance(value.get("type"), str) and value["type"].strip():
        return value["type"].strip()
    return "UNKNOWN"


def metadata_license(path):
    message = Parser().parsestr(path.read_text(encoding="utf-8"))
    for key in ("License-Expression", "License"):
        if license_value(message.get(key)) != "UNKNOWN":
            return message[key].strip(), key.lower()
    classifiers = [value.removeprefix("License :: ") for value in message.get_all("Classifier", []) if value.startswith("License :: ")]
    return ("; ".join(classifiers), "classifier") if classifiers else ("UNKNOWN", "unknown")


def component(name, version, ecosystem, license_name, source):
    return {
        "type": "library",
        "bom-ref": f"{ecosystem}:{name}@{version}",
        "name": name,
        "version": version,
        "licenses": [{"license": {"name": license_name}}],
        "properties": [{"name": "lmps:license-source", "value": source}],
    }


def node_components(root):
    # shortcut: metadata-only license values require legal review before a release approval.
    components = {}
    store = root / "node_modules/.pnpm"
    paths = [*store.glob("*/node_modules/*/package.json"), *store.glob("*/node_modules/@*/*/package.json")]
    for path in paths:
        if path.parent.is_symlink():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data.get("name"), str) or not isinstance(data.get("version"), str):
            continue
        item = component(data["name"], data["version"], "npm", license_value(data.get("license")), "package.json")
        key = item["bom-ref"]
        if key in components and components[key] != item:
            raise RuntimeError(f"Conflicting installed Node metadata for {key}.")
        components[key] = item
    if not components:
        raise RuntimeError("No installed Node packages found; run frozen pnpm install first.")
    return components


def python_metadata(root):
    metadata = {}
    for path in root.glob(".venv/**/site-packages/*.dist-info/METADATA"):
        message = Parser().parsestr(path.read_text(encoding="utf-8"))
        name, version = message.get("Name"), message.get("Version")
        if name and version:
            metadata[(normalized_name(name), version)] = metadata_license(path)
    return metadata


def python_components(root):
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8"))
    installed = python_metadata(root)
    evidence_path = root / "docs/supply-chain/python-license-evidence.json"
    evidence = json.loads(evidence_path.read_text(encoding="utf-8")) if evidence_path.exists() else {}
    locked = {f"pypi:{package['name']}@{package['version']}": package for package in lock["package"]}
    for key, record in evidence.items():
        package = locked.get(key, {})
        if (not any(record.get("artifact_url") == wheel["url"] and record.get("artifact_hash") == wheel["hash"] for wheel in package.get("wheels", []))
                or license_value(record.get("license")) == "UNKNOWN" or not record.get("license_file")):
            raise RuntimeError(f"Reviewed license evidence no longer matches a locked artifact: {key}.")
    components = {}
    for package in lock["package"]:
        if "virtual" in package.get("source", {}):
            continue
        name, version = package["name"], package["version"]
        license_name, source = installed.get((normalized_name(name), version), ("UNKNOWN", "uninstalled-or-metadata-missing"))
        record = evidence.get(f"pypi:{name}@{version}")
        if license_name == "UNKNOWN" and record:
            license_name, source = record["license"], "reviewed-locked-wheel:" + record["license_file"]
        item = component(name, version, "pypi", license_name, source)
        if source.startswith("reviewed-locked-wheel:"):
            item["properties"].append({"name": "lmps:license-evidence-url", "value": record["artifact_url"]})
            item["properties"].append({"name": "lmps:license-evidence-hash", "value": record["artifact_hash"]})
        components[item["bom-ref"]] = item
    return components


def workspace_components(root):
    components = {}
    manifests = [root / "package.json", *sorted(root.glob("apps/**/package.json")), *sorted(root.glob("packages/**/package.json"))]
    for path in manifests:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            item = component(data["name"], data["version"], "workspace", license_value(data.get("license")), "package.json")
            components[item["bom-ref"]] = item
    return components


def render(root=ROOT):
    pnpm_hash = sha256((root / "pnpm-lock.yaml").read_bytes()).hexdigest()
    uv_hash = sha256((root / "uv.lock").read_bytes()).hexdigest()
    components = {**workspace_components(root), **node_components(root), **python_components(root)}
    return json.dumps(
        {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "version": 1,
            "metadata": {
                "component": {"type": "application", "name": "lmps-financial-crime-platform", "version": "0.0.0"},
                "properties": [
                    {"name": "lmps:pnpm-lock-sha256", "value": pnpm_hash},
                    {"name": "lmps:uv-lock-sha256", "value": uv_hash},
                    {"name": "lmps:scope", "value": "installed-node-and-locked-python-with-reviewed-artifact-licenses"},
                ],
            },
            "components": [components[key] for key in sorted(components)],
        },
        indent=2,
        sort_keys=True,
    ) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="Write the reviewed local inventory.")
    mode.add_argument("--check", action="store_true", help="Fail if the reviewed local inventory does not match installed locked dependencies.")
    args = parser.parse_args(argv)
    content = render()
    inventory = json.loads(content)
    if args.write:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(content, encoding="utf-8")
        print(f"WROTE local SBOM: {len(inventory['components'])} components")
        return 0
    if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != content:
        print("FAIL local SBOM differs from current locked installed dependencies; run pnpm sbom:write.", file=sys.stderr)
        return 1
    unknown = sum(item["licenses"][0]["license"]["name"] == "UNKNOWN" for item in inventory["components"])
    print(f"PASS local SBOM: {len(inventory['components'])} components; {unknown} UNKNOWN licenses; legal approval is separate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
