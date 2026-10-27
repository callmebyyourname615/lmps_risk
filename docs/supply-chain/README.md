# Local SBOM and license inventory

`pnpm sbom:write` renders `local-sbom.cdx.json` from the current locked Node/Python dependencies, their installed package metadata and the workspace manifests. `pnpm sbom:check` regenerates it in memory and fails if it differs. Local verification runs the check after frozen installation.

The inventory is a CycloneDX 1.6 component list using installed Node package roots and locked Python packages. It excludes nested benchmark/test-fixture manifests; their files remain part of the parent distribution. Python metadata prefers License-Expression/License, ignores the placeholder UNKNOWN and then checks license classifiers. If no installed metadata is available, only the exact artifacts recorded in python-license-evidence.json supply reviewed license evidence. Their URLs and SHA-256 hashes must still occur under the exact package/version in uv.lock; other missing licenses remain UNKNOWN. UNLICENSED describes the private workspace packages.

## License evidence review — 2026-10-20

The corrected inventory contains **176 components and zero UNKNOWN licenses**. This closes missing metadata evidence, not organisational legal approval. The previous 179-component inventory also counted three nested fixture manifests as independent dependencies; no actual installed dependency was removed.

| Previous entry | Finding and correction |
| --- | --- |
| npm:benchmarks@1.0.0, UNKNOWN | Nested secure-json-parse/benchmarks/package.json; excluded as a separate dependency. Parent secure-json-parse remains inventoried. |
| npm:transport@0.0.1, UNKNOWN | Nested pino/test/fixtures/transport/package.json; excluded as a separate dependency. Parent pino remains inventoried. |
| npm:benchmark@1.0.0 | Additional nested @fastify/cors/benchmark/package.json with license metadata; also excluded as a separate dependency. Parent @fastify/cors remains inventoried. |
| pypi:detect-secrets@1.5.0, UNKNOWN | License: UNKNOWN previously hid the Apache license classifier. The corrected parser uses the classifier. The exact locked wheel also contains the Apache 2.0 license text. |
| pypi:colorama@0.4.6, uninstalled | Windows-only pytest dependency present in the cross-platform lock. The exact locked wheel contains the BSD-3-Clause license at colorama-0.4.6.dist-info/licenses/LICENSE.txt. |
| pypi:httpx2-jsfetch@1.0, uninstalled | Emscripten-only httpx2 dependency present in the lock. The exact locked wheel declares BSD-3-Clause and contains httpx2_jsfetch-1.0.dist-info/licenses/LICENSE.md. |

All three Python wheels were downloaded from the exact files.pythonhosted.org URLs in uv.lock and their full SHA-256 digests matched the locked hashes before reading their metadata/license files. They were inspected without installation or execution, then the temporary downloads were removed. Review sources: [colorama 0.4.6](https://pypi.org/project/colorama/0.4.6/), [detect-secrets 1.5.0](https://pypi.org/project/detect-secrets/1.5.0/), [httpx2-jsfetch 1.0](https://pypi.org/project/httpx2-jsfetch/1.0/). Exact artifact URLs are retained in the evidence file and generated SBOM.

Regenerate/review evidence when a locked artifact changes. Verification rejects reviewed entries whose exact version, wheel URL or SHA-256 hash is no longer locked. There is no blanket missing-license fallback, no changed dependency and no secret-scan exemption added for this review. Named legal/procurement approval, distribution notices, commercial terms and signed release/image inventories remain pending under [missing inputs](../../../plan/09-missing-inputs-and-foundation-readiness.md).

This records dependency evidence exercised locally on macOS arm64. Ubuntu x64 is the user-confirmed production target, but hosted/Linux verification remains pending. It does not approve licenses, create a release SBOM, scan OCI images, sign artifacts, establish Linux/production equivalence, or inventory Kafka/Debezium/registry products that are not installed or selected.

No.31 inventory update (2026-10-22):177 components/0 UNKNOWN, one additional workspace package `@lmps/risk`. The lock changes only workspace importers, with no new external artifact/version. A pinned Node runtime recovered from its existing native cache remains toolchain evidence rather than an npm-registry dependency; all cached files used in recovery were digest-checked. Frozen reinstall policy verification could not finish on the restricted network and is not claimed as passed. Legal/release approval remains pending.


Backend-first acceptance update (2026-10-22): an actual frozen pnpm installation passed supply-chain policy verification, and the inventory was regenerated/verified at199 components/0 UNKNOWN. The earlier205-component manually materialized cache tree contained six entries absent from the actual installed tree; no lockfile or external version was changed by this follow-up. Fresh-source offline verification reproduced the199-component inventory. The existing No.33 frontend dependencies remain in the workspace; further Portal work is deferred at the user's request. Legal/release and hosted/Linux evidence remain separate.
