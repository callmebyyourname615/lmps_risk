# LMPS Risk — ตาราง, Columns และ Data Lineage ทั้งหมด

ตรวจจาก repository ณ 2026-10-22. เป็นการจัดทำเอกสารจากแผน, migrations `0000`–`0012` และ contracts/intake implementation; ไม่ได้เชื่อม LMPS หรือ migrate ฐานข้อมูลในงานนี้.

## สถานะและขอบเขต

- แผนหลักมี **37 logical table/collection names**. เมื่อรวม plan/08 และ logical model ได้ **46 ชื่อ**; บาง entity อาจรวมใน physical table เดียวและบางชื่อเป็น conditional.
- Migration ที่เขียนแล้วมี **19 ตารางใน schema platform / 219 SQL columns**:17 local/synthetic +2 offline unverified staging. ไม่ยืนยันว่าฐานข้อมูล persistent ทุกตัว apply ครบแล้ว.
- Drizzle migration ledger แยกอีก 1 ตาราง/3 columns; ไม่รวมใน 19 ตาราง runtime.
- **ยังไม่มี real LMPS import**. ทั้ง 4 source candidates มี capture_enabled=false. intake เดิมรับเฉพาะ synthetic; No.35.2 มี offline CSV staging adapter แยกแล้ว แต่ยังไม่เคยใช้ไฟล์ LMPS จริง.
- แผนระยะยาวยังไม่กำหนดชื่อ/type ของทุก physical column. ส่วน 1 จึงแสดง logical attributes ตามแผน; ส่วน 2 แสดง SQL columns ที่กำหนดจริงครบทุกตัว.

## สัญลักษณ์แหล่งข้อมูล

| สัญลักษณ์ | ความหมาย |
| --- | --- |
| LMPS | ค่าจาก source/export; รองรับ synthetic slice และ offline staging code แต่ยังไม่ใช้ LMPS จริง |
| DERIVED | คัด/แปลง/คำนวณจาก source evidence หรือ assessment |
| SYS | ID, version, config/policy, workflow, trace, hash, lease/retry และ metadata ของระบบเรา |
| USER | ข้อมูลที่ผู้ตรวจ/ผู้ดูแลใส่หรืออนุมัติ |
| MIX | JSON รวมหลายแหล่ง ต้องดู field paths |

## 1. ทุกชื่อ logical table/entity ในแผน

37 รายการแรกมาจาก plan/02; 9 รายการท้ายมาจาก plan/08 และ PostgreSQL Logical Model. Attributes เป็นแนวคิด ไม่ใช่ชื่อ physical SQL columns ที่อนุมัติแล้ว. คำอธิบายของแผนบางส่วนกำหนดระดับกลุ่มตาราง จึงแสดงบริบทกลุ่มตามต้นฉบับ.

| # | Logical table/entity | Attributes ที่ระบุในแผน |
| --- | --- | --- |
| 1 | `institutions` | Canonical Institution, Routing Role, Effective Dates, Mapping Evidence |
| 2 | `institution_aliases` | Canonical Institution, Routing Role, Effective Dates, Mapping Evidence |
| 3 | `entities` | Account/Proxy/Merchant Tokens, Type, Mapping/Key Versions; Restricted Linkage |
| 4 | `entity_aliases` | Account/Proxy/Merchant Tokens, Type, Mapping/Key Versions; Restricted Linkage |
| 5 | `transaction_events` | Append-only Canonical Events, Unique Source Event Identity |
| 6 | `transactions` | Current Projection, Source Reference, Business ID, Status/Revision, Money/Parties |
| 7 | `feature_definitions` | Versions, Storage Reference, Hash, Availability/Freshness |
| 8 | `feature_snapshot_refs` | Versions, Storage Reference, Hash, Availability/Freshness |
| 9 | `rule_definitions` | Immutable Published Versions, Ownership, Maker/Checker, Effective Scope |
| 10 | `rule_versions` | Immutable Published Versions, Ownership, Maker/Checker, Effective Scope |
| 11 | `rule_approvals` | Immutable Published Versions, Ownership, Maker/Checker, Effective Scope |
| 12 | `policy_versions` | Decision/Alert/Degraded Policies และการอนุมัติ |
| 13 | `policy_approvals` | Decision/Alert/Degraded Policies และการอนุมัติ |
| 14 | `risk_assessments` | Immutable Per-run Result, Transaction/Entity Scope, Mode, Time, Correlation |
| 15 | `risk_score_components` | Dimension, Engine, Score Semantics, Calibration/Model Version, Status/Reasons |
| 16 | `risk_decisions` | Recommendation vs Actual Enforcement/Acknowledgement แยกกัน |
| 17 | `enforcement_events` | Recommendation vs Actual Enforcement/Acknowledgement แยกกัน |
| 18 | `risk_alerts` | Severity, Dedup Group, Assessment Links, Ownership, State/Revision |
| 19 | `alert_evidence_links` | Severity, Dedup Group, Assessment Links, Ownership, State/Revision |
| 20 | `investigation_cases` | Many-to-many Evidence, Workflow, Concurrency และ Audit |
| 21 | `case_links` | Many-to-many Evidence, Workflow, Concurrency และ Audit |
| 22 | `case_notes` | Many-to-many Evidence, Workflow, Concurrency และ Audit |
| 23 | `case_events` | Many-to-many Evidence, Workflow, Concurrency และ Audit |
| 24 | `investigation_outcomes` | Dimension, Outcome, Confidence/Evidence, Reviewer, Maturity, Version |
| 25 | `label_reviews` | Dimension, Outcome, Confidence/Evidence, Reviewer, Maturity, Version |
| 26 | `notification_outbox` | Alert/Recipient Intent, Unique Semantic Key, Mode, Lease/Retry State |
| 27 | `mobile_device_registrations` | Authenticated User/Institution, Platform, Encrypted Token, Lifecycle |
| 28 | `notification_deliveries` | Provider Acceptance/Errors, Attempt IDs, Expiry และ Optional Device Receipt |
| 29 | `notification_attempts` | Provider Acceptance/Errors, Attempt IDs, Expiry และ Optional Device Receipt |
| 30 | `alert_acknowledgements` | Actor, Acknowledged Time, Escalation/Assignment History |
| 31 | `escalation_events` | Actor, Acknowledged Time, Escalation/Assignment History |
| 32 | `vendor_response_refs` | Vendor/Capability Version, Status, Permitted Payload Reference, TTL/Provenance |
| 33 | `audit_events` | Append-only Operational Audit + Export to Storage ที่มีการป้องกันแก้ไขตาม Policy |
| 34 | `audit_archive_refs` | Append-only Operational Audit + Export to Storage ที่มีการป้องกันแก้ไขตาม Policy |
| 35 | `evaluation_runs` | Dataset/Split/Code/Model/Policy และ Actual Deployment Versions |
| 36 | `dataset_manifests` | Dataset/Split/Code/Model/Policy และ Actual Deployment Versions |
| 37 | `model_deployments` | Dataset/Split/Code/Model/Policy และ Actual Deployment Versions |
| 38 | `source_records` | Internal key; workspace/namespace/generation/table; opaque record_ref; complete typed source PK; key encoding/normalization version; classification |
| 39 | `source_events` | Event key; source record; capture kind/epoch/position/row ordinal/operation; input schema ref; observed/recorded times; optional proven source commit time; evidence/integrity refs |
| 40 | `ingestion_dedup` | Sink semantic scope + stable source event identity; applied effect/version reference |
| 41 | `ingestion_quarantine` | Source event/evidence ref; disposition/reason; mapping version; first/last seen; retry state; resolution audit |
| 42 | `source_business_links` | Source record/approved relationship; canonical transaction identity; mapping/approval version; effective interval; supersession evidence |
| 43 | `transaction_identities` | Workspace/internal key; opaque transaction_id; approved business namespace/key reference; mapping version; resolution evidence |
| 44 | `revision_sources` | Complete revision ref + source event ref + contribution/mapping version |
| 45 | `transaction_registry` | CONDITIONAL global transaction key; verified source business key; physical partition locator |
| 46 | `latest_risk` | Workspace + subject/approved-use scope + policy eligibility; complete assessment ref + transaction revision |

`transaction_identities` อาจรวมกับ `transactions`; `transaction_registry` เป็น conditional partition locator. แผนกล่าวถึง alert state events และ artifact/evidence references แต่ยังไม่ตั้งชื่อ physical tables สุดท้าย จึงไม่ตั้งชื่อเพิ่มเอง.

`mobile_device_registrations` เป็นชื่อเดิมในแผน. ผู้ใช้เลือก Web App + Add to Home Screen แล้ว; ต้องออกแบบ web subscription/device model ภายหลัง ไม่ถือว่าสร้าง mobile-token schema แล้ว.

## 2. ทุก SQL column ของ 19 ตารางใน migrations

รวม ADD/DROP COLUMN ตามลำดับแล้ว. NULL คิดจาก column declaration และ primary key. ไม่ได้คัดลอก CHECK/UNIQUE/FK/grants ทุกข้อ; ตรวจ migration ต้นฉบับก่อน implement. เงินใน source JSON เป็น exact decimal string ไม่ใช่ float.

### 2.1 `platform.source_records`

ทะเบียนแถวต้นทางและ complete source key; ยังไม่ใช่ business payment identity.

Migration เริ่มต้น: [0001_local_source_intake.sql](../../packages/database/migrations/0001_local_source_intake.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `record_id` | `BIGINT` | ไม่ | SYS | Internal source-record key / FK [PK] |
| `record_ref` | `UUID` | ไม่ | SYS | Opaque source-record UUID |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `source_namespace` | `TEXT` | ไม่ | SYS | namespace แหล่งข้อมูลจาก capture configuration |
| `source_generation` | `TEXT` | ไม่ | SYS | รุ่นแหล่งข้อมูลสำหรับแยก restore/rebootstrap |
| `source_table` | `TEXT` | ไม่ | SYS | ชื่อตารางต้นทาง (lineage metadata) |
| `source_key` | `JSONB` | ไม่ | LMPS + SYS structure | Complete source PK ใน JSON; ดู mapping ด้านล่าง |
| `provenance` | `TEXT` | ไม่ | SYS | local_synthetic |
| `execution_mode` | `TEXT` | ไม่ | SYS | test |
| `created_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบสร้าง row |
### 2.2 `platform.source_events`

ประวัติ observation ต้นทาง โดย fields ถูกจำกัดด้วย allowlist.

Migration เริ่มต้น: [0001_local_source_intake.sql](../../packages/database/migrations/0001_local_source_intake.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `event_id` | `BIGINT` | ไม่ | SYS | Internal observation key [PK] |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `source_namespace` | `TEXT` | ไม่ | SYS | namespace แหล่งข้อมูลจาก capture configuration |
| `source_generation` | `TEXT` | ไม่ | SYS | รุ่นแหล่งข้อมูลสำหรับแยก restore/rebootstrap |
| `capture_epoch` | `TEXT` | ไม่ | SYS | Capture epoch/session identity |
| `event_key` | `TEXT` | ไม่ | SYS | Stable capture-event identity สำหรับ dedup |
| `record_id` | `BIGINT` | ไม่ | SYS | Internal source-record key / FK |
| `operation` | `TEXT` | ไม่ | SYS | snapshot/insert/update/delete ของ observation |
| `observed_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาจริงที่ capture สังเกต; ไม่ใช่ txtime |
| `fields` | `JSONB` | ได้ | LMPS (allowlist JSON) | Source fields ตาม allowlist; ดู JSON paths ด้านล่าง |
| `schema_version` | `SMALLINT` | ไม่ | SYS | รุ่น event/audit schema |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
### 2.3 `platform.local_outbox_intents`

คิว intent แจ้งเตือนใน local simulation; แยกจาก risk job และยังไม่เชื่อม live push.

Migration เริ่มต้น: [0003_local_outbox.sql](../../packages/database/migrations/0003_local_outbox.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `intent_ref` | `UUID` | ไม่ | SYS | Opaque outbox intent ID / FK [PK] |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `semantic_key` | `TEXT` | ไม่ | SYS | Semantic intent dedup key |
| `notification_ref` | `UUID` | ไม่ | SYS | Notification reference ID |
| `provider` | `TEXT` | ไม่ | SYS | Local provider/simulator |
| `execution_mode` | `TEXT` | ไม่ | SYS | test |
| `state` | `TEXT` | ไม่ | SYS | สถานะ workflow |
| `attempt_count` | `INT` | ไม่ | SYS | จำนวน attempts |
| `available_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาพร้อมให้ claim |
| `expires_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาหมดอายุ intent |
| `lease_token` | `UUID` | ได้ | SYS | Worker ownership/fencing token |
| `lease_until` | `TIMESTAMPTZ` | ได้ | SYS | เวลาหมดอายุ lease |
| `created_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบสร้าง row |
### 2.4 `platform.local_outbox_attempts`

ประวัติ outbox attempts.

Migration เริ่มต้น: [0003_local_outbox.sql](../../packages/database/migrations/0003_local_outbox.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `attempt_id` | `BIGINT` | ไม่ | SYS | Internal attempt key [PK] |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `intent_ref` | `UUID` | ไม่ | SYS | Opaque outbox intent ID / FK |
| `attempt_number` | `INT` | ไม่ | SYS | ลำดับ attempt/retry |
| `lease_token` | `UUID` | ไม่ | SYS | Worker ownership/fencing token |
| `outcome` | `TEXT` | ไม่ | SYS | ผลการทำงาน; ตาราง review เป็นความเห็นผู้ตรวจ |
| `claimed_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลา claim attempt |
| `finished_at` | `TIMESTAMPTZ` | ได้ | SYS | เวลาสิ้นสุด attempt |
### 2.5 `platform.audit_events`

Audit การกระทำและ state changes ของระบบ.

Migration เริ่มต้น: [0004_local_audit.sql](../../packages/database/migrations/0004_local_audit.sql). Columns ถูกปรับใน 0005 ด้วย.

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `audit_id` | `BIGINT` | ไม่ | SYS | Internal audit key [PK] |
| `event_ref` | `UUID` | ไม่ | SYS | Opaque audit-event UUID |
| `schema_version` | `INT` | ไม่ | SYS | รุ่น event/audit schema |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `execution_mode` | `TEXT` | ไม่ | SYS | test |
| `actor_role` | `TEXT` | ไม่ | SYS | Trusted actor role |
| `action` | `TEXT` | ไม่ | SYS | การกระทำของระบบ/ผู้ตรวจ |
| `target_ref` | `UUID` | ไม่ | SYS | Opaque audit target reference |
| `correlation_id` | `UUID` | ได้ | SYS | Trace/correlation ID ของระบบ [GENERATED] |
| `previous_state` | `TEXT` | ได้ | SYS | สถานะก่อนเปลี่ยน |
| `state` | `TEXT` | ได้ | SYS | สถานะ workflow |
| `attempt_number` | `INT` | ไม่ | SYS | ลำดับ attempt/retry |
| `outcome` | `TEXT` | ได้ | SYS | ผลการทำงาน; ตาราง review เป็นความเห็นผู้ตรวจ |
| `occurred_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลา audit/review event; ไม่ใช่ transaction txtime |
| `target_type` | `TEXT` | ไม่ | SYS | ชนิด audit target |
| `capture_id` | `UUID` | ได้ | SYS | Capture/snapshot ID |
| `job_status` | `TEXT` | ได้ | SYS | สถานะ job ณ audit event |
| `previous_job_status` | `TEXT` | ได้ | SYS | สถานะ job ก่อนเปลี่ยน |
| `actor_type` | `TEXT` | ได้ | SYS | ประเภท actor คำนวณจาก role [GENERATED] |
### 2.6 `platform.local_sync_jobs`

คิวงานนำเข้า synthetic snapshot.

Migration เริ่มต้น: [0005_local_sync_jobs.sql](../../packages/database/migrations/0005_local_sync_jobs.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `job_id` | `BIGINT` | ไม่ | SYS | Internal sync-job key [PK] |
| `job_ref` | `UUID` | ไม่ | SYS | Opaque job ID / FK |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `capture_id` | `UUID` | ไม่ | SYS | Capture/snapshot ID |
| `snapshot_sha256` | `TEXT` | ไม่ | SYS | Hash ตรวจ integrity ของ snapshot |
| `total` | `INT` | ไม่ | SYS | จำนวน source events ใน snapshot |
| `execution_mode` | `TEXT` | ไม่ | SYS | test |
| `status` | `TEXT` | ไม่ | SYS | สถานะ job/attempt ของระบบ |
| `attempt_number` | `INT` | ไม่ | SYS | ลำดับ attempt/retry |
| `lease_token` | `UUID` | ได้ | SYS | Worker ownership/fencing token |
| `lease_until` | `TIMESTAMPTZ` | ได้ | SYS | เวลาหมดอายุ lease |
| `created_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบสร้าง row |
| `updated_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาปรับสถานะล่าสุด |
### 2.7 `platform.local_sync_attempts`

ความคืบหน้า import/reconciliation แต่ละ attempt.

Migration เริ่มต้น: [0005_local_sync_jobs.sql](../../packages/database/migrations/0005_local_sync_jobs.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `job_ref` | `UUID` | ไม่ | SYS | Opaque job ID / FK [PK] |
| `attempt_number` | `INT` | ไม่ | SYS | ลำดับ attempt/retry [PK] |
| `lease_token` | `UUID` | ไม่ | SYS | Worker ownership/fencing token |
| `status` | `TEXT` | ไม่ | SYS | สถานะ job/attempt ของระบบ |
| `processed` | `INT` | ไม่ | SYS | จำนวน events ที่ประมวลผล |
| `inserted` | `INT` | ไม่ | SYS | จำนวน events ที่เพิ่ม |
| `duplicate` | `INT` | ไม่ | SYS | จำนวน duplicate events |
| `import_completed` | `BOOLEAN` | ไม่ | SYS | Import ครบชุดหรือยัง |
| `reconciliation_status` | `TEXT` | ได้ | SYS | สถานะเทียบ snapshot กับข้อมูลที่เก็บ |
| `error_code` | `TEXT` | ได้ | SYS | รหัสปัญหาของระบบ ไม่มี raw payload |
| `started_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาเริ่ม attempt |
| `finished_at` | `TIMESTAMPTZ` | ได้ | SYS | เวลาสิ้นสุด attempt |
### 2.8 `platform.local_transaction_revisions`

Immutable local transaction revisions; wire transaction อยู่ใน payload JSONB.

Migration เริ่มต้น: [0006_local_transaction_revisions.sql](../../packages/database/migrations/0006_local_transaction_revisions.sql). เพิ่ม publication ใน 0007 ด้วย.

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `namespace` | `TEXT` | ไม่ | SYS | Internal transaction namespace [PK] |
| `transaction_id` | `TEXT` | ไม่ | SYS | Opaque internal payment handle; ไม่ copy LMPS id/reference [PK] |
| `revision_number` | `INT` | ไม่ | SYS | ลำดับ revision ของระบบ [PK] |
| `previous_revision` | `INT` | ได้ | SYS | Previous revision สำหรับ chain/FK [GENERATED] |
| `transaction_revision` | `TEXT` | ไม่ | SYS | Opaque revision ดึงจาก payload [GENERATED] |
| `provenance` | `TEXT` | ไม่ | SYS | local_synthetic |
| `execution_mode` | `TEXT` | ไม่ | SYS | test |
| `payload` | `JSONB` | ไม่ | MIX | Transaction wire object ครบ 18 fields; ดู mapping |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
| `publication` | `JSONB` | ได้ | MIX | Synthetic normalization/publication evidence, source lineage และ binding |
### 2.9 `platform.local_rule_versions`

Rules สำหรับ synthetic stateless backtest รุ่นก่อน transaction risk engine.

Migration เริ่มต้น: [0008_local_rule_assessments.sql](../../packages/database/migrations/0008_local_rule_assessments.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `rule_id` | `TEXT` | ไม่ | SYS | Rule ID ของเรา [PK] |
| `rule_version` | `TEXT` | ไม่ | SYS | Rule version [PK] |
| `definition` | `JSONB` | ไม่ | SYS | Rule definition/config |
| `rule_sha256` | `TEXT` | ไม่ | SYS | Rule integrity hash |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
### 2.10 `platform.local_assessment_runs`

ผล synthetic stateless backtest; คนละตารางกับ local_transaction_risks.

Migration เริ่มต้น: [0008_local_rule_assessments.sql](../../packages/database/migrations/0008_local_rule_assessments.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `run_id` | `UUID` | ไม่ | SYS | Internal assessment/backtest run ID [PK] |
| `report` | `JSONB` | ไม่ | MIX | Frozen backtest report พร้อม rules, rows และ evidence |
| `report_sha256` | `TEXT` | ไม่ | SYS | Backtest report integrity hash |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
### 2.11 `platform.local_risk_policies`

Risk policy/version ของ Fraud/Mule/AML engine.

Migration เริ่มต้น: [0009_local_transaction_risks.sql](../../packages/database/migrations/0009_local_transaction_risks.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `policy_id` | `TEXT` | ไม่ | SYS | Risk/alert policy ID ของเรา [PK] |
| `policy_version` | `TEXT` | ไม่ | SYS | Policy version [PK] |
| `policy` | `JSONB` | ไม่ | SYS | Policy configuration |
| `policy_sha256` | `TEXT` | ไม่ | SYS | Policy hash; บางตาราง generated จาก JSON |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
### 2.12 `platform.local_transaction_risks`

Frozen request, observation และผล Risk assessment.

Migration เริ่มต้น: [0009_local_transaction_risks.sql](../../packages/database/migrations/0009_local_transaction_risks.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `run_id` | `UUID` | ไม่ | SYS | Internal assessment/backtest run ID [PK] |
| `namespace` | `TEXT` | ไม่ | SYS | Internal transaction namespace |
| `transaction_id` | `TEXT` | ไม่ | SYS | Opaque internal payment handle; ไม่ copy LMPS id/reference |
| `revision_number` | `INT` | ไม่ | SYS | ลำดับ revision ของระบบ |
| `policy_id` | `TEXT` | ได้ | SYS | Risk/alert policy ID ของเรา |
| `policy_version` | `TEXT` | ได้ | SYS | Policy version |
| `snapshot` | `JSONB` | ไม่ | MIX | Frozen result/evidence; ดู JSON catalog ด้านล่าง |
| `policy_sha256` | `TEXT` | ได้ | SYS | Policy hash; บางตาราง generated จาก JSON [GENERATED] |
| `snapshot_sha256` | `TEXT` | ไม่ | SYS | Hash ตรวจ integrity ของ snapshot |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
### 2.13 `platform.local_alert_policies`

Policy/version สำหรับเลือก findings สร้าง Alert.

Migration เริ่มต้น: [0010_local_alerts.sql](../../packages/database/migrations/0010_local_alerts.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `policy_id` | `TEXT` | ไม่ | SYS | Risk/alert policy ID ของเรา [PK] |
| `policy_version` | `TEXT` | ไม่ | SYS | Policy version [PK] |
| `policy` | `JSONB` | ไม่ | SYS | Policy configuration |
| `policy_sha256` | `TEXT` | ไม่ | SYS | Policy hash; บางตาราง generated จาก JSON |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบบันทึกหลักฐาน |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
### 2.14 `platform.local_alerts`

Immutable Alert snapshot ที่อ้าง assessment; severity เป็น generated column.

Migration เริ่มต้น: [0010_local_alerts.sql](../../packages/database/migrations/0010_local_alerts.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `alert_id` | `UUID` | ไม่ | SYS | Opaque Alert ID / FK [PK] |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `assessment_run_id` | `UUID` | ไม่ | SYS | Reference ไป local_transaction_risks.run_id |
| `policy_id` | `TEXT` | ไม่ | SYS | Risk/alert policy ID ของเรา |
| `policy_version` | `TEXT` | ไม่ | SYS | Policy version |
| `policy_sha256` | `TEXT` | ไม่ | SYS | Policy hash; บางตาราง generated จาก JSON |
| `snapshot` | `JSONB` | ไม่ | MIX | Frozen result/evidence; ดู JSON catalog ด้านล่าง |
| `snapshot_sha256` | `TEXT` | ไม่ | SYS | Hash ตรวจ integrity ของ snapshot |
| `severity` | `TEXT` | ได้ | DERIVED | ระดับคำนวณจาก snapshot [GENERATED] |
| `created_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบสร้าง row |
| `recorded_by` | `TEXT` | ไม่ | SYS | DB session actor |
### 2.15 `platform.local_alert_reviews`

Acknowledgement/review ของผู้ตรวจ; ยังไม่ใช่ verified training label.

Migration เริ่มต้น: [0010_local_alerts.sql](../../packages/database/migrations/0010_local_alerts.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `alert_id` | `UUID` | ไม่ | SYS | Opaque Alert ID / FK [PK] |
| `version` | `INT` | ไม่ | SYS | Review event version [PK] |
| `expected_version` | `INT` | ไม่ | SYS | Version ที่ผู้ตรวจคาดไว้เพื่อกัน concurrent change |
| `request_id` | `UUID` | ไม่ | SYS | Review idempotency key |
| `action` | `TEXT` | ไม่ | USER | การกระทำของระบบ/ผู้ตรวจ |
| `outcome` | `TEXT` | ได้ | USER | ผลการทำงาน; ตาราง review เป็นความเห็นผู้ตรวจ |
| `note` | `TEXT` | ได้ | USER | หมายเหตุผู้ตรวจ |
| `actor_subject` | `TEXT` | ไม่ | SYS | ตัวตนผู้ตรวจจาก trusted authentication |
| `actor_role` | `TEXT` | ไม่ | SYS | Trusted actor role |
| `occurred_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลา audit/review event; ไม่ใช่ transaction txtime |
### 2.16 `platform.local_risk_jobs`

No.34 revision → assessment → alert พร้อม frozen input, dedup, checkpoint, lease/retry.

Migration เริ่มต้น: [0011_local_risk_jobs.sql](../../packages/database/migrations/0011_local_risk_jobs.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `job_ref` | `UUID` | ไม่ | SYS | Opaque job ID / FK [PK] |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic |
| `input_sha256` | `TEXT` | ไม่ | SYS | Semantic input hash สำหรับ job dedup |
| `manifest` | `JSONB` | ไม่ | MIX | Frozen job input รวม request/context/policies |
| `manifest_sha256` | `TEXT` | ไม่ | SYS | Manifest integrity hash |
| `namespace` | `TEXT` | ไม่ | SYS | Internal transaction namespace [GENERATED] |
| `transaction_id` | `TEXT` | ไม่ | SYS | Opaque internal payment handle; ไม่ copy LMPS id/reference [GENERATED] |
| `revision_number` | `INT` | ไม่ | SYS | ลำดับ revision ของระบบ [GENERATED] |
| `observation` | `JSONB` | ไม่ | DERIVED + SYS | Revision observation ที่ freeze ตอน enqueue |
| `observation_sha256` | `TEXT` | ไม่ | SYS | Observation integrity hash |
| `status` | `TEXT` | ไม่ | SYS | สถานะ job/attempt ของระบบ |
| `stage` | `TEXT` | ไม่ | SYS | assessment/alert/done checkpoint |
| `attempt_number` | `INT` | ไม่ | SYS | ลำดับ attempt/retry |
| `lease_token` | `UUID` | ได้ | SYS | Worker ownership/fencing token |
| `lease_until` | `TIMESTAMPTZ` | ได้ | SYS | เวลาหมดอายุ lease |
| `next_attempt_at` | `TIMESTAMPTZ` | ได้ | SYS | เวลาลองใหม่ |
| `assessment_run_id` | `UUID` | ได้ | SYS | Reference ไป local_transaction_risks.run_id |
| `alert_id` | `UUID` | ได้ | SYS | Opaque Alert ID / FK |
| `result_code` | `TEXT` | ได้ | SYS | ผล job: created/no match/ineligible ฯลฯ |
| `error_code` | `TEXT` | ได้ | SYS | รหัสปัญหาของระบบ ไม่มี raw payload |
| `created_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาระบบสร้าง row |
| `updated_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาปรับสถานะล่าสุด |
### 2.17 `platform.local_risk_job_attempts`

ประวัติ attempt ของ risk job รวม stage และ failure.

Migration เริ่มต้น: [0011_local_risk_jobs.sql](../../packages/database/migrations/0011_local_risk_jobs.sql).

| Column | SQL type | NULL | แหล่ง | ความหมาย |
| --- | --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS | ขอบเขตแยกข้อมูล/งาน synthetic [PK] |
| `job_ref` | `UUID` | ไม่ | SYS | Opaque job ID / FK [PK] |
| `attempt_number` | `INT` | ไม่ | SYS | ลำดับ attempt/retry [PK] |
| `lease_token` | `UUID` | ไม่ | SYS | Worker ownership/fencing token |
| `status` | `TEXT` | ไม่ | SYS | สถานะ job/attempt ของระบบ |
| `started_stage` | `TEXT` | ไม่ | SYS | Stage ตอนเริ่ม attempt |
| `finished_stage` | `TEXT` | ได้ | SYS | Stage ตอนจบ attempt |
| `error_code` | `TEXT` | ได้ | SYS | รหัสปัญหาของระบบ ไม่มี raw payload |
| `started_at` | `TIMESTAMPTZ` | ไม่ | SYS | เวลาเริ่ม attempt |
| `finished_at` | `TIMESTAMPTZ` | ได้ | SYS | เวลาสิ้นสุด attempt |

### 2.18 `platform.offline_dataset_batches`

[No.35.2 offline staging contract](offline-dataset-import.md). Migration: [0012_offline_datasets.sql](../../packages/database/migrations/0012_offline_datasets.sql).

| Column | SQL type | NULL | แหล่ง/ความหมาย |
| --- | --- | --- | --- |
| `batch_ref` | `UUID` | ไม่ | SYS: canonical batch UUID [PK] |
| `workspace_key` | `TEXT` | ไม่ | SYS: offline workspace scope |
| `source_namespace` | `TEXT` | ไม่ | SYS: operator export scope label; ไม่ใช่ verified source identity |
| `source_table` | `TEXT` | ไม่ | SYS: source table label |
| `identity_sha256` | `TEXT` | ไม่ | SYS: semantic manifest dedup hash, excluding UUID alias |
| `manifest` | `JSONB` | ไม่ | MIX: frozen import context/fingerprints; ไม่มี raw row values |
| `manifest_sha256` | `TEXT` | ไม่ | SYS: frozen manifest integrity |
| `expected_rows` | `INT` | ไม่ | SYS: declared count checked against full file |
| `loaded_rows` | `INT` | ไม่ | SYS: transactional committed-prefix checkpoint |
| `status` | `TEXT` | ไม่ | SYS: importing/complete/blocked |
| `reconciliation_status` | `TEXT` | ไม่ | SYS: not_checked/incomplete/matched/mismatch |
| `source_kind` | `TEXT` | ไม่ | SYS: user_supplied_file |
| `execution_mode` | `TEXT` | ไม่ | SYS: offline_analysis |
| `source_semantics` | `TEXT` | ไม่ | SYS: unverified |
| `created_at` | `TIMESTAMPTZ` | ไม่ | SYS: DB registration time |
| `updated_at` | `TIMESTAMPTZ` | ไม่ | SYS: progress/state update time |
| `reconciled_at` | `TIMESTAMPTZ` | ได้ | SYS: latest verification time |
| `recorded_by` | `TEXT` | ไม่ | SYS: DB service session actor |

### 2.19 `platform.offline_dataset_rows`

[No.35.2 offline staging contract](offline-dataset-import.md). Migration: [0012_offline_datasets.sql](../../packages/database/migrations/0012_offline_datasets.sql).

| Column | SQL type | NULL | แหล่ง/ความหมาย |
| --- | --- | --- | --- |
| `workspace_key` | `TEXT` | ไม่ | SYS: offline workspace scope |
| `batch_ref` | `UUID` | ไม่ | SYS: canonical batch UUID |
| `source_table` | `TEXT` | ไม่ | SYS: source table label |
| `row_number` | `INT` | ไม่ | SYS: 1-based data record ordinal |
| `source_key` | `JSONB` | ไม่ | LMPS/export: complete selected source key; unverified business identity |
| `fields` | `JSONB` | ไม่ | LMPS/export: allowlisted raw values; no account/payload columns |
| `row_sha256` | `TEXT` | ไม่ | SYS: exact source-value-array integrity hash |
| `recorded_at` | `TIMESTAMPTZ` | ไม่ | SYS: DB insert time |

### 2.20 Migration ledger

Drizzle default: `drizzle.__drizzle_migrations` มี `id SERIAL PRIMARY KEY`, `hash TEXT NOT NULL`, `created_at BIGINT` (nullable). SYS ทั้งหมด. ชื่อ schema/table ปรับได้ด้วย migration configuration.

## 3. Source fields เข้า SQL column/JSON path ไหน

นี่คือ allowlist ที่ local intake รองรับจริง **โดยรับเฉพาะ synthetic inputs** ไม่ใช่สถานะว่า import จาก LMPS จริงแล้ว. ทุก source field ที่ไม่อยู่รายการนี้ถูกตัดออกจาก intake profile ปัจจุบัน.

| Source | Source column | ปลายทาง | หมายเหตุ |
| --- | --- | --- | --- |
| transfer, transfer_hist | id | `source_records.source_key.id` | Source PK เป็น string; ไม่ใช่ transaction_id |
| transfer, transfer_hist | requesttime | `source_records.source_key.requesttime` | ส่วนของ composite PK; preserve naive DATETIME |
| transfer_old | id | `source_records.source_key.id` | Source นี้ PK มี id อย่างเดียว |
| ทั้ง 3 transfer tables | amount | `source_events.fields.amount` | Exact decimal string, source scale 2; ไม่ round/abs |
| ทั้ง 3 transfer tables | ccy | `source_events.fields.ccy` | Raw code; ยังไม่สรุปว่า ISO currency |
| ทั้ง 3 transfer tables | result | `source_events.fields.result` | Raw nullable status code; ยังไม่สรุป success |
| ทั้ง 3 transfer tables | txtime | `source_events.fields.txtime` | Intake ยอม nullable; ไม่เดา timezone |
| member | code | `source_records.source_key.code` | Dictionary source PK |
| member | status | `source_events.fields.status` | Raw nullable dictionary value |
| member | member_type | `source_events.fields.member_type` | Raw nullable dictionary value |

`source_events.record_id` เชื่อมกลับไป source record. `observed_at`, `recorded_at`, capture_epoch/event_key, namespace/generation และ IDs เป็น capture/system metadata ไม่ใช่ copy txtime. DELETE เก็บ fields=null และยังคง source identity ผ่าน record reference.

### No.35.2 — Offline staging เพิ่มเติม

[Offline CSV import](offline-dataset-import.md) ใช้ `offline_dataset_rows.source_key.id/requesttime/code` และ `offline_dataset_rows.fields.amount/ccy/result/txtime/status/member_type` ตาม source projection เดียวกัน แยกจาก source_records/source_events เดิม. `txtime` ใน offline CSV profile ต้องไม่เป็น NULL ตาม offline DDL declaration. Batch manifest/checkpoint/reconciliation/UUIDs/hashes เป็นข้อมูลระบบเรา และยังไม่มี canonical publication หรือ Risk replay จาก staging.

## 4. Transaction wire ทั้ง 18 fields และ mapping ที่เสนอ

ทุก path ต่อไปนี้อยู่ใน SQL column เดียวคือ `local_transaction_revisions.payload` (JSONB). Candidate mapping ยังเป็น DRAFT และต้องยืนยัน source semantics ก่อนใช้กับข้อมูลจริง.

| JSON path ใน payload | แหล่ง | LMPS candidate / การสร้างค่า | สถานะของ local slice |
| --- | --- | --- | --- |
| `schema_version` | SYS | Producer contract version | 0.1.0-draft.1 |
| `execution_mode` | SYS | Trusted execution context | test |
| `run_id` | SYS | Producer trace | Synthetic run ID |
| `correlation_id` | SYS | Producer trace | Synthetic correlation ID |
| `transaction_id` | SYS + linkage | Opaque handle หลัง approved business linkage; id/reference เป็นเพียง candidates | Synthetic handle; ยังไม่ใช่ verified LMPS payment ID |
| `transaction_revision` | SYS | Opaque approved input/version handle | Synthetic handle; ไม่เรียงจาก requesttime |
| `source_reference` | SYS lineage | namespace + opaque record_ref + mapping_version; registry resolve complete source PK | Synthetic reference; mapping_version=null |
| `occurred_at` | LMPS→แปลง | txtime/requesttime หลังยืนยัน meaning/timezone | null; ห้ามเติม Z ให้ naive DATETIME |
| `observed_at` | SYS/capture | เวลาจริงที่ capture สังเกต | Capture instant; ไม่ backdate จาก txtime |
| `sender` | LMPS→แปลง + SYS | fromaccount หลังยืนยัน representation/stable identity | unresolved; ไม่ใส่ raw/masked account ใน wire |
| `receiver` | LMPS→แปลง + SYS | toaccount หลังยืนยัน representation/stable identity | unresolved; ไม่ใส่ raw/masked account ใน wire |
| `source_bank_id` | LMPS→แปลง | frommember + member.code/iin/member_type หลังอนุมัติ mapping/role | null; routing member ไม่เท่ากับ owning bank |
| `destination_bank_id` | LMPS→แปลง | tomember + member.code/iin/member_type หลังอนุมัติ mapping/role | null |
| `amount` | LMPS→แปลง | amount หลังยืนยัน units/sign/fee semantics | Synthetic exact magnitude; real mapping ยังไม่อนุมัติ |
| `currency` | LMPS→แปลง | ccy หลังยืนยัน codebook | Synthetic explicit binding; ไม่ default LAK/XXX |
| `transaction_type` | LMPS→แปลง | txtype/totype/qrtype candidates | null |
| `channel` | LMPS→แปลง | transfer.fromchannel; ไม่มีใน transfer_hist/transfer_old | null |
| `transaction_status` | LMPS→แปลง | result/originalreference/shouldrevert/isreconciled/issettled candidates | unknown เว้นมี validated synthetic publication evidence |

Source reference ยังไม่มี direct destination ใน local intake allowlist; เป็น candidate ของ business linkage. `fromaccount`, `toaccount`, `fromuser`, `purpose`, `receipt` ไม่อยู่ shared wire. `responsetime`/`settletime` เป็น future lifecycle evidence ไม่ได้เป็น occurred_at อัตโนมัติ.

## 5. JSON fields ที่เป็นผล Risk / ข้อมูลระบบเรา

| SQL JSONB column / paths | Fields / หน้าที่ | แหล่ง |
| --- | --- | --- |
| `local_transaction_revisions.publication` | publisher/version; source/capture refs; binding; normalization_input; normalization evidence | MIX: synthetic evidence + mapping/config + lineage |
| `local_rule_versions.definition` | rule_id, rule_version, risk_dimension, kind, currency, statuses, threshold | SYS/config |
| `local_assessment_runs.report.rules` | Frozen rule definitions | SYS/config |
| `local_assessment_runs.report.rows[].source` | source_reference, observed_at, publisher/capture IDs, integrity refs | SYS lineage |
| `local_assessment_runs.report.rows[].results[]` | rule/version/hash, dimension, outcome/reason; evidence.amount/currency/transaction_status/threshold/threshold_currency/amount_semantics | DERIVED + synthetic evidence + SYS/config |
| `local_assessment_runs.report.counts` | targets, available/unavailable inputs, matched observations, rule matches/no matches/not applicable/unavailable | DERIVED |
| `local_risk_policies.policy` | policy_id, version, currency, window_seconds, baseline_windows, graph_depth, minimum_amount, structuring_ceiling, near_threshold_bps, severity_bps, rules | SYS/config; currency/amount ในนี้เป็น parameters ไม่ใช่ imported transaction values |
| `local_transaction_risks.snapshot.request` | format/provenance/mode/workspace/run; target; frozen policy; context | MIX; context ปัจจุบัน synthetic-declared |
| `snapshot.request.context` | binding/revision hash, identity_status, as_of, coverage_start/complete, events, flagged_accounts/version | Synthetic evidence + SYS/config; ไม่ใช่ verified account graph |
| `snapshot.request.context.events[]` | namespace, transaction_id, revision_number, sender, receiver, occurred_at, available_at, currency, amount, status, reversed_amount | Synthetic-declared facts; real history/account adapter ยังไม่มี |
| `local_transaction_risks.snapshot.observation` | status, revision_sha256, amount, reversed_amount, currency, transaction_status, observed_at | DERIVED from frozen revision |
| `local_transaction_risks.snapshot.result` | assessment/run/target; engine/catalog/policy versions; input/feature/revision hashes; eligibility/status/reasons; decision; scores; risk_types; findings | DERIVED + SYS |
| `snapshot.result.fraud_score` | status, value, meaning, severity, reason_code, coverage | DERIVED |
| `snapshot.result.mule_network_score` | status, value, meaning, severity, reason_code, coverage | DERIVED |
| `snapshot.result.aml_suspicion_score` | status, value, meaning, severity, reason_code, coverage | DERIVED |
| `snapshot.result.findings[]` | code, dimension, status, reason_code, metric(value/unit/threshold), severity, evidence_refs | DERIVED + rule config + lineage |
| `local_alert_policies.policy` | policy_id, version, minimum_severity, included_codes, include_partial | SYS/config |
| `local_alerts.snapshot` | format/provenance/mode/workspace; assessment_run_id/hash; policy; selected_risk_types; severity | DERIVED + SYS/config; assessment payload อ่านผ่าน reference |
| `local_risk_jobs.manifest` | format/provenance/mode/workspace; job_ref; risk_request; alert_policy | MIX frozen input/context/config |
| `local_risk_jobs.observation` | status, revision_sha256, amount, reversed_amount, currency, transaction_status, observed_at | DERIVED ตอน enqueue; missing ไม่เปลี่ยนเมื่อ revision มาทีหลัง |

Risk scores, Alert severity, reviewer outcome, job state และ retry count เป็นข้อมูลของระบบเรา ไม่ได้ copy จาก LMPS. Score เป็น risk_index ไม่ใช่ calibrated probability; unavailable ใช้ value=null ไม่ใช่ 0. Local outbox เป็น slice แยก; No.34 ไม่ได้เพิ่ม live notification side effect.

## 6. ทุก column ของ 4 source tables ที่เลือกไว้ใน mapping

ส่วนนี้ให้เห็นว่า LMPS ต้นทางมี fields อะไรบ้าง ไม่ใช่ permission/import allowlist. Offline inventory มี partial coverage/31 issues ไม่ใช่ live schema verification. Inventory ทั้งหมดมี 100 tables/1,581 columns; รายการเต็มอยู่ลิงก์ท้ายรายงาน.

### 6.1 LMPS `transfer` — 26 columns

| Source column | Declared type | NULL | Local intake profile |
| --- | --- | --- | --- |
| `id` | `INT(11)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `txtime` | `DATETIME` | ไม่ | รองรับเฉพาะ synthetic shape |
| `requesttime` | `DATETIME` | ไม่ | รองรับเฉพาะ synthetic shape |
| `reference` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `frommember` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `fromuser` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `fromaccount` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `totype` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `toaccount` | `VARCHAR(5000)` | ไม่ | ไม่อยู่ allowlist |
| `tomember` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `responsetime` | `DATETIME` | ได้ | ไม่อยู่ allowlist |
| `result` | `VARCHAR(200)` | ได้ | รองรับเฉพาะ synthetic shape |
| `amount` | `DECIMAL(24,2)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `ccy` | `VARCHAR(200)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `purpose` | `VARCHAR(500)` | ได้ | ไม่อยู่ allowlist |
| `isreconciled` | `TINYINT(1)` | ไม่ | ไม่อยู่ allowlist |
| `issettled` | `TINYINT(1)` | ไม่ | ไม่อยู่ allowlist |
| `settletime` | `DATETIME` | ได้ | ไม่อยู่ allowlist |
| `txtype` | `VARCHAR(200)` | ได้ | ไม่อยู่ allowlist |
| `fee` | `DECIMAL(24,2)` | ได้ | ไม่อยู่ allowlist |
| `originalreference` | `VARCHAR(200)` | ได้ | ไม่อยู่ allowlist |
| `shouldrevert` | `INT(11)` | ได้ | ไม่อยู่ allowlist |
| `qrtype` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |
| `requesttime_dt` | `DATE` | ได้ | ไม่อยู่ allowlist |
| `receipt` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |
| `fromchannel` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |
### 6.2 LMPS `transfer_hist` — 24 columns

| Source column | Declared type | NULL | Local intake profile |
| --- | --- | --- | --- |
| `id` | `INT(11)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `txtime` | `DATETIME` | ไม่ | รองรับเฉพาะ synthetic shape |
| `requesttime` | `DATETIME` | ไม่ | รองรับเฉพาะ synthetic shape |
| `reference` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `frommember` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `fromuser` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `fromaccount` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `totype` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `toaccount` | `VARCHAR(5000)` | ไม่ | ไม่อยู่ allowlist |
| `tomember` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `responsetime` | `DATETIME` | ได้ | ไม่อยู่ allowlist |
| `result` | `VARCHAR(200)` | ได้ | รองรับเฉพาะ synthetic shape |
| `amount` | `DECIMAL(24,2)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `ccy` | `VARCHAR(200)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `purpose` | `VARCHAR(500)` | ได้ | ไม่อยู่ allowlist |
| `isreconciled` | `TINYINT(1)` | ไม่ | ไม่อยู่ allowlist |
| `issettled` | `TINYINT(1)` | ไม่ | ไม่อยู่ allowlist |
| `settletime` | `DATETIME` | ได้ | ไม่อยู่ allowlist |
| `txtype` | `VARCHAR(200)` | ได้ | ไม่อยู่ allowlist |
| `fee` | `DECIMAL(24,2)` | ได้ | ไม่อยู่ allowlist |
| `originalreference` | `VARCHAR(200)` | ได้ | ไม่อยู่ allowlist |
| `shouldrevert` | `INT(11)` | ได้ | ไม่อยู่ allowlist |
| `qrtype` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |
| `requesttime_dt` | `DATE` | ได้ | ไม่อยู่ allowlist |
### 6.3 LMPS `transfer_old` — 24 columns

| Source column | Declared type | NULL | Local intake profile |
| --- | --- | --- | --- |
| `id` | `INT(11)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `txtime` | `DATETIME` | ไม่ | รองรับเฉพาะ synthetic shape |
| `requesttime` | `DATETIME` | ไม่ | ไม่อยู่ allowlist |
| `reference` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `frommember` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `fromuser` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `fromaccount` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `totype` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `toaccount` | `VARCHAR(5000)` | ไม่ | ไม่อยู่ allowlist |
| `tomember` | `VARCHAR(200)` | ไม่ | ไม่อยู่ allowlist |
| `responsetime` | `DATETIME` | ได้ | ไม่อยู่ allowlist |
| `result` | `VARCHAR(200)` | ได้ | รองรับเฉพาะ synthetic shape |
| `amount` | `DECIMAL(24,2)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `ccy` | `VARCHAR(200)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `purpose` | `VARCHAR(500)` | ได้ | ไม่อยู่ allowlist |
| `isreconciled` | `TINYINT(1)` | ไม่ | ไม่อยู่ allowlist |
| `issettled` | `TINYINT(1)` | ไม่ | ไม่อยู่ allowlist |
| `settletime` | `DATETIME` | ได้ | ไม่อยู่ allowlist |
| `txtype` | `VARCHAR(200)` | ได้ | ไม่อยู่ allowlist |
| `fee` | `DECIMAL(24,2)` | ได้ | ไม่อยู่ allowlist |
| `originalreference` | `VARCHAR(200)` | ได้ | ไม่อยู่ allowlist |
| `shouldrevert` | `INT(11)` | ได้ | ไม่อยู่ allowlist |
| `qrtype` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |
| `requesttime_dt` | `DATE` | ได้ | ไม่อยู่ allowlist |
### 6.4 LMPS `member` — 26 columns

| Source column | Declared type | NULL | Local intake profile |
| --- | --- | --- | --- |
| `code` | `VARCHAR(100)` | ไม่ | รองรับเฉพาะ synthetic shape |
| `iin` | `VARCHAR(100)` | ไม่ | ไม่อยู่ allowlist |
| `name` | `VARCHAR(500)` | ไม่ | ไม่อยู่ allowlist |
| `publickey` | `VARCHAR(5000)` | ได้ | ไม่อยู่ allowlist |
| `inquiryurl` | `VARCHAR(1000)` | ได้ | ไม่อยู่ allowlist |
| `transferurl` | `VARCHAR(1000)` | ได้ | ไม่อยู่ allowlist |
| `notifyurl` | `VARCHAR(1000)` | ได้ | ไม่อยู่ allowlist |
| `rtgscode` | `VARCHAR(32)` | ได้ | ไม่อยู่ allowlist |
| `rtgsaccount` | `VARCHAR(32)` | ได้ | ไม่อยู่ allowlist |
| `status` | `VARCHAR(16)` | ได้ | รองรับเฉพาะ synthetic shape |
| `crossbordersettlementbank` | `VARCHAR(500)` | ได้ | ไม่อยู่ allowlist |
| `COUNTRYCODE` | `VARCHAR(2)` | ได้ | ไม่อยู่ allowlist |
| `settlefinlink` | `INT(11)` | ได้ | ไม่อยู่ allowlist |
| `rtgsthbaccount` | `VARCHAR(32)` | ได้ | ไม่อยู่ allowlist |
| `rtgsthbcode` | `VARCHAR(32)` | ได้ | ไม่อยู่ allowlist |
| `rtgsusdaccount` | `VARCHAR(20)` | ได้ | ไม่อยู่ allowlist |
| `rtgsusdcode` | `VARCHAR(10)` | ได้ | ไม่อยู่ allowlist |
| `ismulticurrency` | `INT(11)` | ได้ | ไม่อยู่ allowlist |
| `rtgscnyaccount` | `VARCHAR(20)` | ได้ | ไม่อยู่ allowlist |
| `rtgscnycode` | `VARCHAR(20)` | ได้ | ไม่อยู่ allowlist |
| `crossborder_inbound` | `TEXT` | ได้ | ไม่อยู่ allowlist |
| `crossborder_outbound` | `TEXT` | ได้ | ไม่อยู่ allowlist |
| `retransferurl` | `VARCHAR(1000)` | ได้ | ไม่อยู่ allowlist |
| `member_type` | `VARCHAR(20)` | ได้ | รองรับเฉพาะ synthetic shape |
| `member_fullname` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |
| `messageformat` | `VARCHAR(100)` | ได้ | ไม่อยู่ allowlist |

## 7. Data flow และงานที่ยังไม่เชื่อม

```text
LMPS export / real source (ยังไม่เชื่อม)
  → No.35.1 profile + No.35.2 offline_dataset_batches/offline_dataset_rows (มี code; ทดสอบด้วยข้อมูลแต่ง)
  → approved canonical mapping/publication (ยังไม่เชื่อมจาก offline staging)
  → source_records.source_key + source_events.fields (intake เดิมเป็น synthetic slice)
  → approved linkage/normalization/publication (มี synthetic publisher)
  → local_transaction_revisions.payload + publication
  → local_risk_jobs.manifest + observation
  → local_transaction_risks.snapshot
  → local_alerts.snapshot
  → local_alert_reviews (ข้อมูลผู้ตรวจ)
```

History tables ไม่ UNION เข้า payment stream โดยอัตโนมัติ. Account representation/stable identity/masking boundary ยังไม่ยืนยันและผู้ใช้ให้เลื่อนการยืนยันไปก่อน; ไม่สร้าง verified account graph/enforcement. Transaction-only ingestion ที่ไม่พึ่ง identity ออกแบบต่อได้ภายใต้ scope/data-access ที่อนุมัติ. มี offline staging adapter แล้วใน No.35.2; การใช้ไฟล์จริงยังต้องมี data access/export context ที่อนุญาต และ canonical/Risk mapping ในชุดถัดไป ไม่เปลี่ยน provenance ของ synthetic payload แล้วส่งเข้าเดิม.

## 8. เอกสารต้นทาง

- [Operational data model — plan/02](../../../plan/02-architecture-data-and-api.md)
- [Enterprise PostgreSQL — plan/08](../../../plan/08-postgresql-enterprise-design.md)
- [PostgreSQL logical model](../architecture/postgresql-logical-model.md)
- [Source mapping และ gates](source-mapping.md)
- [Machine-readable mapping](source-mapping.json)
- [Offline LMPS inventory: 100 ตาราง](lmps-schema/report.md)
- [Offline LMPS metadata: 1,581 columns](lmps-schema/metadata.json)
- [Local source intake implementation](../../packages/database/src/source-intake.ts)
- [Transaction risk contract](../../packages/contracts/src/transaction-risk.ts)
- [Risk job contract](../../packages/contracts/src/risk-job.ts)
- [No.34 job flow](../architecture/adr/0012-synthetic-risk-job-flow.md)

รายงานนี้จัดทำ data dictionary เท่านั้น ไม่ได้แก้ code/schema/runtime configuration หรือเชื่อม source เพิ่ม.
