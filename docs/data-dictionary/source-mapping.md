# LMPS Source → Canonical Mapping — No.7

สถานะ **DRAFT_FOR_REVIEW**, 18 ตุลาคม 2026 ไม่มี Owner Sign-off, Production Normalizer, Connection หรือ Migration ในชุดงานนี้

ข้อเท็จจริงมาจาก [Offline DDL Inventory](lmps-schema/report.md) ซึ่งยัง Partial/31 Issues ไม่ใช่ Live Schema หรือ Row Samples. [Machine-readable Mapping](source-mapping.json) บันทึกเฉพาะ Column Declarations/Keys ที่เลือก, Candidate Fields, Gates และ Unknown Handling โดย Tests ตรวจเทียบกับ Inventory และ Contract จริง ห้ามใช้ Artifact นี้เป็น Capture Configuration ที่อนุมัติแล้ว

## 1. ขอบเขตข้อมูลรอบแรกที่เสนอ

| Source | หน้าที่ที่เสนอ | Keys ที่ประกาศจริง | ขอบเขตก่อนอนุมัติ |
| --- | --- | --- | --- |
| `transfer` | Candidate สำหรับ Current Transaction Feed | PK `(id, requesttime)`; UNIQUE `(reference, requesttime)` | ตรวจ Live Schema, Payment/Lookup Semantics, Corrections และ Key Reuse ก่อน Capture |
| `transfer_hist` | ตรวจประวัติ/Overlap เทียบ Current | PK `(id, requesttime)`; UNIQUE `(reference, requesttime)` | ไม่ UNION เข้า Live Payment Stream โดยอัตโนมัติ |
| `transfer_old` | ตรวจ Archive/History Semantics | PK `(id)`; UNIQUE `(reference)` | ไม่ใช้ Key Strategy ของ Current Table แทน และไม่อนุมานว่ามีข้อมูลย้อนหลังจริง |
| `member` | Candidate Dictionary สำหรับ Routing Participants | PK `(code)`; ไม่พบ UNIQUE บน `iin` | ตรวจ `code`/`iin`, Type, Ownership/Role และ Validity ก่อน Resolve Bank |

ทุกตารางมี `capture_enabled=false` ใน Mapping. Candidate Columns ไม่ใช่ Permission ให้อ่านค่า Production. Proposed First Capture จำกัด `transfer` และ Approved Member Fields หลังผ่าน Gate; History เป็น Comparison Scope จนทราบ Move/Copy/Overlap. Cross-border, Card, QR Payload Parsing, Disputes และ Chargebacks อยู่ภายหลังและไม่ถือเป็น Label อัตโนมัติ

Default สำหรับ Columns ที่ไม่อยู่ใน Mapping คือ Excluded. `fromuser`, `purpose`, `receipt`, Member URLs/Public Keys/Settlement Accounts และ Payloads อื่นไม่ถูกเพิ่มเข้า Shared Contract. `fromaccount/toaccount` เป็น Restricted Identity Candidates เท่านั้น; ต้องมี Field-access/Privacy Approval ก่อนอ่านหรือเก็บค่า และไม่อยู่ใน Canonical Wire Payload นี้

## 2. Mapping ที่ต้องตรวจจากเจ้าของข้อมูล

| Canonical Field/Concept | Source Candidate / Producer | Rule ที่เสนอและพฤติกรรมเมื่อยังไม่ทราบ |
| --- | --- | --- |
| `schema_version` | Producer | ใช้ Wire Version `0.1.0-draft.1`; Mapping Design Version แยกต่างหาก |
| `execution_mode`, `run_id`, `correlation_id` | Trusted Producer | Assign จาก Execution Context; ไม่ใช้ค่าจากผู้เรียกเป็น Authorization; Trace Run ไม่ทำให้ Live Dedup Key เปลี่ยนทุก Restart |
| `transaction_id` | Internal Handle หลังยืนยัน Business Linkage | ห้าม Copy `id` หรือ `reference` แล้วอ้างว่าเป็น Global Payment ID; ยังไม่พร้อมให้ Hold Canonical Emission |
| `transaction_revision` | Approved Source Version/Input Identity | Revision เป็น Opaque Handle; ห้ามเรียงตาม String, Request Time หรือเวลามาถึงเพื่ออนุมาน Source Order |
| `source_reference` | Source Record Registry | อ้าง Namespace + Opaque Record Handle ที่ Resolve Complete Source Key ได้; `mapping_version=null` ใน Examples หมายถึงยังไม่อนุมัติ ไม่ใช่ Production Mapping |
| `occurred_at` | `txtime`/`requesttime` Candidates | ทั้งคู่เป็น `DATETIME`; ยังไม่รู้ Timezone/Business Meaning จึงใช้ `null` ได้ ห้ามเติม `Z` หรือใช้เวลา Capture แทน |
| `observed_at` | Capture Observation | Actual UTC Observation Instant; Snapshot ไม่บอกว่าเคยรู้ข้อมูลเมื่อใดในอดีต ถ้าไม่มี Provenance ให้ Hold Canonical Emission |
| `sender`, `receiver` | `fromaccount`, `toaccount` Candidates | ปัจจุบัน `unresolved`, Representation=`unknown`; ไม่ส่ง Raw/Masked Value เข้า Contract และไม่สร้าง Verified Entity |
| `source_bank_id`, `destination_bank_id` | `frommember/tomember` + `member.code/iin/member_type` | เริ่ม `null`; Routing Member ไม่เท่ากับ Owning Bank; Preserve Leading Zeros และไม่เดา Join Column |
| `amount` | `amount DECIMAL(24,2)` | Decimal String แบบ Exact; ยืนยัน Units/Sign/Fee/Zero/Reversal ก่อนใช้ Canonical Magnitude; ยังไม่ทราบให้ Hold ไม่เติม 0 |
| `currency` | `ccy VARCHAR(200)` | ต้องมี Approved Codebook; Contract ต้องการสามตัวอักษร ไม่ใช่หลักฐานว่าค่าต้นทางเป็น ISO Code; ไม่มี Mapping ให้ Hold ไม่ Default เป็น LAK/XXX |
| `transaction_type` | `txtype`, `totype`, `qrtype` | `null` จนยืนยัน Product/Field Semantics; ไม่ Concatenate Codes เป็นประเภทใหม่ |
| `channel` | `transfer.fromchannel` | Candidate นี้ไม่มีใน `transfer_hist/transfer_old`; ไม่เติม Historical Channel จาก Current Values โดยอ้าง Point-in-time |
| `transaction_status` | `result`, `originalreference`, `shouldrevert`, `isreconciled`, `issettled` | `unknown` เมื่อยังไม่ยืนยัน Codebook; Flag/Reference อย่างเดียวไม่พิสูจน์ Executed Funds, Reversal หรือ Successful Payment |

`responsetime`/`settletime` เป็น Nullable Candidates สำหรับ Lifecycle/Latency Evidence ในอนาคต ไม่ถูกตั้งเป็น `occurred_at` อัตโนมัติ. Mapping มีทุก Top-level Field ของ Transaction Contract และ Source References ถูกตรวจว่ามีจริงใน Inventory

### Width, money และ input failures

`reference/frommember/tomember` ยาวได้ 200 ตัวอักษร, `toaccount` 5,000 ตัว ขณะที่ Wire Identifier จำกัด 128 ตัว จึงห้าม Truncate หรือ Cast ลง Field ปลายทางตรง ๆ ใช้ Opaque Handle + Authorized Registry Lookup เมื่อออกแบบ Encoding/Namespace/Collation/Collision Handling แล้ว ตรวจ Exact Source Identity ก่อนเก็บและไม่ Log ค่าเดิม

`DECIMAL(24,2)` มีพื้นที่ Integer 22 หลัก ไม่ใช่ Minor Units และ Numeric Type เพียงอย่างเดียวไม่ได้บังคับ Nonnegative; CHECK Constraints/Business Rules ยังต้องตรวจแยกจาก Partial Inventory. Contract ปัจจุบันรับ Magnitude ไม่ติดลบและกว้างกว่า Source: ค่า `-1.00` จึงอยู่ใน Source Numeric Range แต่ไม่เข้า Wire Amount; `1.001` หรือ `10000000000000000000000.00` อาจผ่าน Wire Shape แต่ไม่ใช่ Exact Source Range/Scale นี้ ต้อง Quarantine ตามนโยบาย ห้าม `abs()`, Round หรือ Wrap. Stage ข้อมูลที่ Source Fields/Codebooks ยังไม่พอใน Restricted Holding Area ที่อนุมัติ ไม่สร้าง Canonical Payment ปลอมให้ผ่าน Validation

Quarantine/Hold ในเอกสารนี้หมายถึง **Data Pipeline Disposition** ไม่ใช่การ Hold เงินหรือ Block ธุรกรรม. อนาคตต้องบันทึก Reason/Source Ref/Mapping Version และ Retry/Resolution Workflow โดยไม่ส่ง Raw Values เข้า Logs

## 3. แยก Identity สามระดับ

| Identity | Components ที่เสนอ | สิ่งที่ยังสรุปไม่ได้ |
| --- | --- | --- |
| Source Record | Stable Workspace + Source Namespace/Generation + Table + Complete Source PK | Row เดียวคือ Business Payment เดียวเสมอหรือไม่; PK อาจเปลี่ยน/ถูก Reuse ต้องมี Protocol |
| Capture Event | Source Lineage + Capture Epoch/Position/Row Ordinal/Operation ตาม Capture Strategy ที่เลือก | PK/`requesttime`/Payload Hash อย่างเดียวไม่ใช่ Change Event ID; Snapshot กับ Binlog ต้องมี Stitch/Restart Evidence |
| Business Transaction | Internal ID + Approved Business Key/Source Link Mapping | ยังไม่ยืนยัน Business Key, Retry และ Cross-history Linkage; ไม่มี Source Field ใดถูกเลือกเป็น Global Key ในชุดนี้ |

ตัวอย่าง Counterexamples ใช้ Source Namespace/Generation เดียวกันที่สมมติไว้: `id` เดียวกันแต่ `requesttime` ต่างกันเป็นคนละ Composite Source Key; PK เหมือนกันแต่ต่างตารางยังเป็นคนละ Scoped Source Record; ทั้งสองกรณีอาจเป็น Payment เดียวกันหรือคนละ Payment ซึ่งยัง UNVERIFIED. แม้ Source Key เดิมก็ไม่ได้พิสูจน์ว่าเป็น Change Event เดิม

Source Key ต้อง Preserve Component Types/Complete Value/Ordering และ Source Collation Semantics; ห้ามต่อ Strings ด้วย Delimiter ที่ Escape ไม่ชัดหรือ Hash แล้วละทิ้ง Collision Comparison. Source Generation ต้องรองรับ Restore/Truncate/ID Reuse และ Capture Failover. Source PK Update ต้องเก็บ Before/After Lineage เมื่อมีจริง ไม่สร้าง New Payment หรือ Financial Reversal จาก DELETE โดยอัตโนมัติ

Redelivery ของ Event เดิมต้องมี Stable Event Identity; Snapshot รอบใหม่อาจเป็น New Observation ของ Source Record เดิม ไม่ใช่ New Business Payment. Replay ต้องเก็บ Original Source Identity แต่ใช้ Isolated Sink Scope; Live Process Restart ไม่เปลี่ยน Dedup Namespace. Implementation/Format/Offsets ยังไม่เลือกใน No.7

## 4. Gates และผู้ต้องยืนยัน

[Mapping JSON](source-mapping.json) มี 13 Gates สถานะ UNVERIFIED พร้อม Owner **Roles** ซึ่งยังไม่ใช่การแต่งตั้งบุคคล: Access/Source Schema, Capture, Business Identity, Lifecycle, Time, Money, Currency, Member, Account, Product, Privacy และ Retention

ลำดับขอข้อมูลสำหรับงานถัดไป:

1. LMPS/Data Owner: Business Key/History Movement, Status/Product Codebooks, Timezones และ Currency/Amount Units
2. DBA/Security: Approved Read-only Access/Fields, Live Schema/Version/Binlog/Source Generation, Headroom และ Pause/Abort Budget
3. Risk/Governance/SRE: Data Retention/Replay Horizon, Visibility Scope, SLO/RPO/RTO และผู้รับผิดชอบจริง
4. Account Representation/Stable ID/Namespace/Role Linkage: ผู้ใช้ขอเลื่อนไว้; งานระดับธุรกรรมที่มีข้อมูลพอเดินต่อได้ แต่ Account Graph/Velocity/Enforcement ยัง Unavailable

## 5. Fixtures และ Verification

[Synthetic Corpus](../../packages/contracts/fixtures/source-mapping.json) มี 10 Wire Cases (6 Accepted/4 Rejected), 5 Money Boundaries และ 4 Source-key Counterexamples. Handles, Source Rows, Capture Times และ Currency Output เป็นข้อมูลแต่งขึ้น; LAK ในตัวอย่างไม่ได้ Mapping จาก `SYNTHETIC_CCY` ของระบบจริง. `wire_valid=true` แปลว่ารูปแบบผ่าน Contract เท่านั้น ไม่ใช่ Source Semantics/Production Emission ผ่าน

Python ตรวจ Mapping ↔ DDL Inventory ↔ Pydantic Fields, Exact Money/Keys และ Unknown Handling; Node ใช้ Ajv ตรวจ Wire Cases ชุดเดียวกันโดยไม่ Coerce/Mutate. Tests เพิ่มใน Runners ที่มีอยู่และถูกเรียกโดย `pnpm verify:offline`/`pnpm verify`; ไม่มี Dependency ใหม่หรือ Production Normalizer ใน Test Code

ดู [PostgreSQL Logical Model](../architecture/postgresql-logical-model.md) สำหรับการเก็บ Source Lineage, Immutable Revisions และ Evidence แยกจาก Current Projection และ [DB/Sync Readiness](../implementation-status/db-sync-readiness.md) สำหรับ Gate ที่ยังค้าง
