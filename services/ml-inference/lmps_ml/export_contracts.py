import json
from pathlib import Path

from .contracts import CONTRACTS, SCHEMA_VERSION

SCHEMA_DIRECTORY = Path(__file__).resolve().parents[3] / "packages/contracts/schemas"


def schemas() -> dict[str, dict]:
    return {
        name: {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": f"urn:lmps:contracts:{SCHEMA_VERSION}:{name}",
            **model.model_json_schema(mode="validation"),
        }
        for name, model in CONTRACTS.items()
    }


if __name__ == "__main__":
    SCHEMA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    for name, schema in schemas().items():
        (SCHEMA_DIRECTORY / f"{name}.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
    print(f"Exported {len(CONTRACTS)} draft JSON Schemas")
