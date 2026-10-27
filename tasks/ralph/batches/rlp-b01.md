# RLP-B01 — approved synthetic implementation queue

Approved by the user's instruction to start on 2026-10-25. Execute US-101 through US-105 sequentially without further per-task permission. Stop on a failed check, decision, usage limit or scope conflict. Never log out, rotate accounts, commit, push, deploy or access real datasets/databases. PLAN.md and the sibling plan directory remain the source of truth and unchanged. Runner A0-A2 must pass before activating this queue.

## 3. Scope และ local contract ที่เสนอให้อนุมัติ

ทุก input/output ใช้ `provenance=local_synthetic`, `execution_mode=test`, `simulation_only=true`, `enforcement=false`, `production_ready=false` และ synthetic identifier namespaces เท่านั้น ไม่รับ source-export/real-pilot bundle เป็น input ของ simulator

ข้อกำหนดต่อไปนี้เป็น **local test contract ที่เสนอ** ไม่ใช่ SLO, source semantics หรือ risk threshold ที่องค์กรอนุมัติ:

1. Strict bounded input: scenario JSON ไม่เกิน64KiB และไม่เกิน200 commands; ปฏิเสธ unknown fields/invalid IDs/dates/decimal/oversized inputs โดยไม่ coercion
2. จำนวนเงินใช้ canonical decimal string ตาม existing exact-money bounds; คำนวณด้วย integer/BigInt ไม่ใช้ floating point และไม่รวมคนละ currency
3. Test clock มาจาก scenario และเลื่อนไปข้างหน้าอย่างชัดเจน; ไม่ใช้ wall-clock/random values เป็นส่วนของ deterministic result
4. Caller workspace/client เป็น trusted fixture context แยกจาก request body; body เปลี่ยน caller scope เองไม่ได้ ไม่มีการอ้างว่า fixture context เป็น corporate authentication
5. Binding ครอบ workspace/client, synthetic namespace, payment/attempt identity, sender/receiver, amount/currency, product และ explicit expiry
6. Request retry ใช้ scoped idempotency key: payload เดิมคืนผลเดิม; payload ต่างกัน conflict โดยไม่เพิ่ม request/reservation; retry ไม่ต่ออายุ expiry เดิม
7. Reference ใช้ lookup ภายใน simulatorที่ตรวจ caller/binding/expiry; hash ไม่ถูกอ้างเป็น authorization ของระบบจริง
8. Reservation จำลอง **in-flight request count/amount** ของ synthetic sender+currency ไม่ใช่ bank balance หรือเงินจริง; capacity มาจาก explicit scenario fixture ไม่ใช้ default allow เมื่อข้อมูลขาด
9. คำขอพร้อมกัน key เดียวกันต้องผ่าน serialized/atomic critical section; workspace/client/currency ต่างกันไม่ปะปน state
10. Synthetic outcome `executed/failed/cancelled/expired` เปลี่ยน reservation state ตาม contract เพียงครั้งเดียว; duplicate retry ไม่เพิ่ม contribution/release ซ้ำ; conflicting outcome ถูกปฏิเสธ
11. ไม่มี inferred reversal/settlement/business identity หรือ real account graph; unsupported/unknown state กลับ unavailable/rejected พร้อม machine-readable reason
12. CLI รายงาน counts/status แบบไม่มี raw parties/identifiers/amounts ใน console; scenario/report อยู่ใน private local files ตาม helper เดิม


### US-101: Define strict synthetic pre-transfer simulation contracts

**Priority:** P1

Runner activation required outside this application queue.

เพิ่ม typed request/caller/binding/outcome/scenario/result schemas สำหรับ simulatorเท่านั้น ใช้ existing Ajv/decimal/date/identifier conventions ไม่เปลี่ยน contract ของ production หรือ generated Python/OpenAPI artifacts

Allowed files:

- NEW `packages/contracts/src/pretransfer-simulation.ts`
- CHANGE `packages/contracts/package.json` — เพิ่มเฉพาะ exports `./pretransfer-simulation`; คง scripts/dependencies/engines/exports เดิม
- NEW `packages/contracts/test/pretransfer-simulation.test.mjs`

**Acceptance Criteria:**

- [ ] Input/output มี explicit local_synthetic/test/simulation_only/enforcement=false boundaries
- [ ] Caller context แยกจาก body; reject unknown/coerced fields, non-synthetic IDs, invalid dates/expiry, malformed decimals และเกิน64KiB/200 commands
- [ ] Exact decimal round-trip รวมขอบเขตใหญ่กว่า JS safe integer ผ่านโดยไม่ใช้ Number เก็บเงิน
- [ ] Contract validationไม่สร้าง state, risk score, identity link, DB/network/provider effect หรือ claim production authorization
- [ ] `pnpm --filter @lmps/contracts typecheck` และ `pnpm --filter @lmps/contracts test` ผ่าน
- [ ] Host allowlist/manifest-field guard, unchanged protected source และ publication/secret checks ผ่าน

### US-102: Implement deterministic binding and scoped idempotency

**Priority:** P2

**Depends on:** US-101

เพิ่ม pure simulator registry สำหรับ binding hash/reference, request retry และ explicit expiry ใช้ `riskHash`/exact-money primitives ที่มีแล้ว ไม่สร้าง risk engine อีกชุดหรือเปลี่ยน existing evaluator

Allowed files:

- NEW `packages/risk/src/pretransfer-simulation.ts`
- CHANGE `packages/risk/src/index.ts` — additive export เท่านั้น; existing evaluator semantics คงเดิม
- NEW `packages/risk/test/pretransfer-simulation.test.mjs`

**Acceptance Criteria:**

- [ ] Same caller/key/payload คืน frozen result/reference เดิมโดยไม่เพิ่ม state; payload ต่าง conflict แบบไม่มี partial mutation
- [ ] Binding ครอบ caller/workspace/namespace/payment-attempt/parties/money/currency/product/expiry ทั้งหมด
- [ ] Wrong client/workspace/payment/receiver/amount/currency/product และ expired reference ถูกปฏิเสธโดยไม่เปิดเผยรายการของ scope อื่น
- [ ] Expiry boundaryใช้ supplied clock; retry ไม่ต่อ TTL; output deterministic ไม่ใช้ wall-clock/randomness
- [ ] Unknown/missing/unsupported context ไม่คืน allow/zero risk และไม่ใช้ hash เป็น production authorization
- [ ] `pnpm --filter @lmps/risk typecheck` และ `pnpm --filter @lmps/risk test` ผ่าน รวม existing regression
- [ ] Host scope/source/publication checks ผ่าน

### US-103: Serialize concurrent synthetic reservations and reconcile outcomes

**Priority:** P3

**Depends on:** US-102

เพิ่ม bounded per-key concurrency control และ reservation/outcome state สำหรับ in-flight requests ใน simulator ไม่จำลอง bank balanceหรือ claim online feature engine

Allowed files:

- NEW `packages/risk/src/pretransfer-reservations.ts`
- CHANGE `packages/risk/src/index.ts` — additive export เท่านั้น
- NEW `packages/risk/test/pretransfer-reservations.test.mjs`

**Acceptance Criteria:**

- [ ] Actual concurrent Promise submissions key เดียวกันและ explicit capacity1 ไม่ได้ reservation2รายการ; ไม่ใช่ทดสอบด้วย sequential inputs อย่างเดียว
- [ ] Duplicate request/callback และ timeout-after-record retry ไม่เพิ่ม pending/executed contribution หรือ releaseซ้ำ
- [ ] Executed/failed/cancelled/expired transitions ถูกต้อง; conflicting outcome ไม่แก้ frozen bindingหรือ state เงียบ ๆ
- [ ] Currency/workspace/client/sender scopes ไม่ปะปน; amount comparisons exact และ resource/state bounds ถูกบังคับ
- [ ] Queue/lock release หลัง thrown error/cancellation ผ่าน; independent reference model ทดสอบ interleavings/reordered retries
- [ ] Missing policy/context และ unsupported reversal ออก unavailable/rejected ตาม local contract
- [ ] `pnpm --filter @lmps/risk typecheck` และ `pnpm --filter @lmps/risk test` ผ่าน
- [ ] Existing detector/features/policy/Case semantics ไม่เปลี่ยน; host scope/source/publication checks ผ่าน

### US-104: Add private file-only scenario CLI and reproducible report

**Priority:** P4

**Depends on:** US-103

เพิ่ม worker entrypoint/CLI สำหรับ invented scenario files และ private immutable report โดย reuse `readPrivateJson`/`savePrivateReport` จาก helper เดิม Console แสดง counts/status เท่านั้น

Allowed files:

- NEW `apps/risk-workers/src/pretransfer-simulator.ts`
- NEW `apps/risk-workers/scripts/pretransfer-simulate.mjs`
- NEW `apps/risk-workers/test/pretransfer-simulator.test.mjs`
- CHANGE root `package.json` — เพิ่มเฉพาะ script `risk:simulate-pretransfer`; คง scripts/dependencies/toolchain เดิม
- NEW `docs/operations/pretransfer-simulator.md`

**Acceptance Criteria:**

- [ ] Strict bounded private JSON inputและ existing private-file/link/FIFO/owner/size checks ถูก reuse ไม่ขยาย helper เดิมให้รับ unsafe files
- [ ] Repeated identical scenario/run returns identical report; changed input under same run conflicts และไม่ overwrite reportเดิม
- [ ] Reportsผูก scenario/config/code/contract versions และ invariant counts; console/errors ไม่พิมพ์ parties, raw IDs, amounts, secrets หรือ private input contents
- [ ] CLIใช้ library จาก US-102/103 จริง และ actual subprocess smoke ทำงานได้จาก root/worker directory
- [ ] CLIไม่มี DB/source/network/real-model/provider/payment calls และปฏิเสธ real-source bundle shape
- [ ] `pnpm --filter @lmps/risk-workers typecheck` และ `pnpm --filter @lmps/risk-workers test` ผ่าน
- [ ] New root commandและ usage examples ถูกตรวจจริงก่อนบันทึกว่ารันได้; ไม่มีการอ้างว่าคำสั่งใหม่มีอยู่แล้วในขั้น draft
- [ ] Host scope/source/publication checks ผ่าน

### US-105: Close the batch with full local acceptance and honest handoff

**Priority:** P4

**Depends on:** US-104

รันทดสอบ end-to-end ของ scenario/retry/concurrency และ full fresh-source verification บน isolated local fixtures บันทึก commands/results/limitations โดยไม่เปิด target gates

Allowed files:

- NEW `apps/risk-workers/test/pretransfer-acceptance.test.mjs`
- CHANGE `docs/operations/pretransfer-simulator.md`
- CHANGE `docs/implementation-status/current.md` — append actual results/remaining gates; preserve previous evidence/history

**Acceptance Criteria:**

- [ ] Contract → binding/retry → concurrent reservations → outcomes → private report ทำงานร่วมกันและ reproducible
- [ ] Scope-denial, changed money/parties, expiry equality, duplicate/out-of-order/conflicting callbacks, failed command and resource cap cases ผ่าน
- [ ] Existing26 + new automation tests, pinned `pnpm typecheck`, `pnpm test`, `pnpm build`, publication/secret scan และ `pnpm verify:fresh` ผ่าน หรือหยุดงานพร้อม actual failure evidence
- [ ] Countเฉพาะผลที่รันจริง ไม่ยืม970 testsเดิมมาเป็นผลชุดใหม่; online advisory checks ระบุ RUN/SKIP ตามจริง ไม่มี dependencyใหม่ที่ถูกเพิ่มเงียบ ๆ
- [ ] Original database data/credentials, source/plan files, Git index/branch/history และ unrelated user edits ไม่เปลี่ยน
- [ ] Handoffระบุ local/synthetic only, ไม่มี actual LMPS endpoint/authority/G-ONLINE/production capacity/identity claim และ real2GBยัง deferred
- [ ] ทุก taskมี verification/promotion receipt, tasksที่ผ่านแล้วไม่ถูกเรียกใหม่เมื่อ resume และคิวหยุดหลัง5งาน


