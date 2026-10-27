# ADR0015 — Frozen model evidence beside rule Alerts

Status: ACCEPTED for local/synthetic experiments,2026-10-24. Production adoption remains unapproved.

Use versioned private point-in-time datasets and actual CPU baselines with MLflow SQLite tracking/registry. Keep model novelty, calibrated task probabilities and rule risk indices distinct. Safe pinned artifacts load once into authenticated FastAPI shadow serving; Ed25519 evidence binds features/target/revision/as-of/model to an independently configured trust key. Actual source fields whose semantics/identity/availability are unverified cannot become verified ML features or labels.

Model confirmation is an explicit task-matched gate on the existing rule Alert projection. A missing model skips unless a versioned policy explicitly allows rules-only fallback. No payment decision or model-only counterfeit rule finding is produced. Append-only `local_model_gate_policies` and `local_model_receipts` preserve policy, signed evidence/explicit transport unavailability, actor/time, decision and Alert reference. Alert and receipt share a transaction; retries return frozen evidence. Existing Case outcomes remain unverified reviewer feedback rather than automatic training labels.

This additive design retains the existing15-detector result contract and Alert proof validation. The new typed read route requires both risk and Alert read scopes and returns bounded evidence without raw feature vectors. Migration0015 is applied to disposable fixtures for acceptance; backup understands all historical inventories, including pre-model28 tables. The original persistent database remains unchanged. Model activation/rollback is local shadow CAS history plus process restart, not a hot-swapping production release.

Tradeoffs: bounded2000-row reference datasets, single-currency CPU models, one inference worker with bounded admission, no production identity resolver, no real supervised labels or operational model enforcement. Migration owners can alter local database evidence; external immutable retention and key governance are still target work. [Runbook, contracts and acceptance](../../operations/ml-shadow.md).
