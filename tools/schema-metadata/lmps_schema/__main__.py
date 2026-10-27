import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from .analyze import MAX_INPUT_BYTES, analyze
from .report import enrich, render_markdown


def write_atomic(path, text):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(text)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read local DDL into redacted metadata reports; never execute SQL.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--overwrite", action="store_true", help="Replace existing generated reports.")
    args = parser.parse_args(argv)
    try:
        source = args.input.resolve()
        output = args.output_dir.resolve()
        targets = [output / "metadata.json", output / "report.md"]
        if any(target.resolve() == source or (target.exists() and target.samefile(source)) for target in targets):
            print("Refusing to overwrite the input file.", file=sys.stderr)
            return 1
        if not args.overwrite and any(target.exists() for target in targets):
            print("Reports already exist; use --overwrite to replace generated reports.", file=sys.stderr)
            return 1
        with source.open("rb") as handle:
            data = handle.read(MAX_INPUT_BYTES + 1)
        report = enrich(analyze(data))
        output.mkdir(parents=True, exist_ok=True)
        write_atomic(targets[0], json.dumps(report, indent=2, ensure_ascii=True) + "\n")
        write_atomic(targets[1], render_markdown(report))
    except (OSError, UnicodeError):
        print("Cannot read UTF-8 DDL or write reports; check local paths and permissions.", file=sys.stderr)
        return 1
    except ValueError:
        print("Cannot analyze this DDL input; check the 10 MiB limit and supported syntax.", file=sys.stderr)
        return 1
    except Exception:
        # Exception text from a parser may include source literals or SQL snippets.
        print("Analysis failed; parser details are withheld to avoid exposing source content.", file=sys.stderr)
        return 1
    counts = report["counts"]
    print(f"Tables={counts['tables']} columns={counts['columns']} indexes={counts['indexes']} foreign_keys={counts['foreign_keys']} coverage={report['coverage']} issues={len(report['issues'])}")
    return 2 if report["coverage"] == "partial" else 0


if __name__ == "__main__":
    raise SystemExit(main())
