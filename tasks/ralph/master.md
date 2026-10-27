# Registered complete-plan catalog

Source: original sibling plan (11 Markdown documents),104 MUST/P00–P11,23 sessions/S00–S22. Original plan stays unchanged.

**Use the project launcher. master.json is a custom catalog, not a native Ralph --prd file.**

At registration:4 verified local B02 leaves,9 registered B03 leaves,122 blocked leaves; this is not full project completion. B01 historical5/5 is preserved separately.

```sh
cd /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform
./tools/ralph/launch.mjs status --batch rlp-master
./tools/ralph/launch.mjs run --batch rlp-master --home plusb
```

run starts all currently registered local work through B03, one task at a time. Resume uses resume with the same home. --headless selects logs instead of the TUI. No agent was started during registration.

| Plan task | Ralph task | State |
| --- | --- | --- |
| P00-03-T1 | — | blocked — F-LINUX, EXTERNAL-ACTION |
| P00-03-T2 | — | blocked — F-LEGAL, O-008 |
| P00-05-T1 | — | blocked — O-008, O-016, EXTERNAL-ACTION |
| P00-06-T1 | — | blocked — F-LINUX, F-LEGAL, EXTERNAL-ACTION |
| P00-07-T1 | — | blocked — F-OWNERS, O-006, O-007 |
| P00-08-T1 | rlp-b03/US-301 | registered |
| P01-01-T1 | — | blocked — O-001, O-006, EXTERNAL-ACTION |
| P01-02-T1 | — | blocked — O-001, O-006, O-005 |
| P01-03-T1 | — | blocked — O-002, O-001 |
| P01-04-T1 | — | blocked — O-003, O-001 |
| P01-05-T1 | — | blocked — O-004, O-001 |
| P01-06-T1 | — | blocked — O-004, O-005 |
| P01-06-T2 | — | blocked — G-DATA |
| P01-07-T1 | — | blocked — O-005, O-017 |
| P01-08-T1 | — | blocked — O-002, O-003, O-005 |
| P01-09-T1 | — | blocked — O-001, O-007, O-010 |
| P02-01-T1 | — | blocked — O-006, O-007, G-DATA |
| P02-01-T2 | — | blocked — G-DATA, O-014 |
| P02-02-T1 | — | blocked — O-007, G-DATA |
| P02-03-T1 | — | blocked — O-016, EXTERNAL-ACTION |
| P02-04-T1 | — | blocked — O-016 |
| P02-05-T1 | — | blocked — O-016, O-007, O-008, G-SEC |
| P02-06-T1 | — | blocked — O-009 |
| P02-07-T1 | — | blocked — O-007, O-010, O-016 |
| P02-07-T2 | — | blocked — O-007, O-008, O-010, G-SEC |
| P02-08-T1 | — | blocked — O-016 |
| P02-08-T2 | — | blocked — O-008, O-006, O-016 |
| P03-01-T1 | — | blocked — O-013, O-008, F-OWNERS |
| P03-02-T1 | — | blocked — O-013, O-008, EXTERNAL-ACTION |
| P03-02-T2 | — | blocked — O-001, O-006, EXTERNAL-ACTION |
| P03-03-T1 | — | blocked — O-013, G-DATA |
| P03-04-T1 | — | blocked — O-013 |
| P03-04-T2 | — | blocked — O-004, O-017, O-013 |
| P03-05-T1 | — | blocked — O-013 |
| P03-05-T2 | — | blocked — O-007, O-013 |
| P03-06-T1 | rlp-b03/US-302 | registered |
| P03-06-T2 | — | blocked — O-008, O-014, O-007, F-LEGAL |
| P03-07-T1 | — | blocked — O-006, O-014, O-008, F-LEGAL |
| P03-07-T2 | — | blocked — O-014, O-007 |
| P03-08-T1 | — | blocked — G-DATA, O-005 |
| P03-09-T1 | — | blocked — O-013, O-008 |
| P04-01-T1 | — | blocked — G-DATA, O-017, O-006 |
| P04-02-T1 | rlp-b03/US-303 | registered |
| P04-02-T2 | — | blocked — O-013, O-008, O-006, F-LEGAL |
| P04-03-T1 | — | blocked — O-013, O-006, O-007 |
| P04-03-T2 | — | blocked — O-013 |
| P04-04-T1 | — | blocked — O-015, O-008, O-006, F-LEGAL |
| P04-04-T2 | — | blocked — O-015 |
| P04-05-T1 | — | blocked — G-DATA, O-016 |
| P04-06-T1 | — | blocked — O-004, O-005 |
| P04-08-T1 | — | blocked — O-017, G-DATA |
| P04-09-T1 | — | blocked — O-007, O-006 |
| P05-01-T1 | — | blocked — G-DATA, O-010 |
| P05-02-T1 | — | blocked — G-DATA, O-010 |
| P05-03-T1 | — | blocked — O-010, O-005 |
| P05-03-T2 | — | blocked — O-010 |
| P05-04-T1 | — | blocked — G-DATA, O-002, O-017, G-LABEL |
| P05-05-T1 | — | blocked — O-002, O-003, O-017 |
| P05-06-T1 | — | blocked — O-014, O-006, F-LEGAL |
| P05-07-T1 | — | blocked — G-DATA, G-LABEL, O-010 |
| P05-08-T1 | — | blocked — O-006, O-010, G-DATA |
| P05-09-T1 | — | blocked — G-DATA, G-LABEL |
| P06-01-T1 | — | blocked — USER-UI, O-016 |
| P06-01-T2 | — | blocked — USER-UI, O-016 |
| P06-01-T3 | — | blocked — USER-UI, O-016 |
| P06-01-T4 | — | blocked — USER-UI, O-016 |
| P06-02-T1 | — | blocked — USER-UI |
| P06-03-T1 | — | blocked — USER-UI, O-010 |
| P06-04-T1 | — | blocked — USER-UI |
| P06-05-T1 | — | blocked — O-010, G-LABEL |
| P06-06-T1 | — | blocked — O-010, G-LABEL, O-016 |
| P06-07-T1 | rlp-b02/US-201 | verified |
| P06-07-T2 | rlp-b02/US-202 | verified |
| P06-07-T3 | rlp-b02/US-203 | verified |
| P06-07-T4 | rlp-b02/US-204 | verified |
| P06-07-T5 | — | blocked — O-010, G-DATA, G-LABEL |
| P06-08-T1 | — | blocked — USER-UI, O-010, O-007 |
| P07-01-T1 | — | blocked — O-009, USER-UI |
| P07-02-T1 | — | blocked — USER-UI, O-009, O-016 |
| P07-03-T1 | rlp-b03/US-304 | registered |
| P07-03-T2 | — | blocked — O-009, O-016, G-SEC |
| P07-04-T1 | — | blocked — O-009, O-010 |
| P07-05-T1 | — | blocked — O-009, O-006 |
| P07-06-T1 | rlp-b03/US-305 | registered |
| P07-06-T2 | — | blocked — O-009, G-PUSH, EXTERNAL-ACTION |
| P07-07-T1 | rlp-b03/US-306 | registered |
| P07-07-T2 | — | blocked — USER-UI, O-009 |
| P07-08-T1 | — | blocked — O-009, O-010, O-006 |
| P07-09-T1 | — | blocked — O-009, O-016 |
| P08-01-T1 | — | blocked — G-DATA, G-LABEL, O-017 |
| P08-02-T1 | — | blocked — G-LABEL, O-010 |
| P08-03-T1 | — | blocked — G-DATA, G-LABEL |
| P08-04-T1 | — | blocked — G-LABEL, G-DATA, O-010 |
| P08-05-T1 | — | blocked — O-008, O-016, O-007, EXTERNAL-ACTION |
| P08-05-T2 | — | blocked — O-008, O-007 |
| P08-06-T1 | — | blocked — O-008, O-006, G-SEC, EXTERNAL-ACTION |
| P08-07-T1 | rlp-b03/US-307 | registered |
| P08-07-T2 | — | blocked — O-008, F-OWNERS |
| P08-08-T1 | — | blocked — G-LABEL, O-010, O-006 |
| P08-09-T1 | rlp-b03/US-308 | registered |
| P08-09-T2 | — | blocked — O-011, G-DATA, G-LABEL, EXTERNAL-ACTION |
| P08-10-T1 | — | blocked — G-DETECT, G-LABEL, O-006 |
| P09-01-T1 | — | blocked — O-012, O-005, O-010 |
| P09-02-T1 | — | blocked — O-012, O-006, G-DATA |
| P09-03-T1 | — | blocked — O-012, O-007 |
| P09-04-T1 | — | blocked — O-012 |
| P09-05-T1 | — | blocked — O-012, O-010 |
| P09-06-T1 | — | blocked — O-006, O-012 |
| P09-07-T1 | — | blocked — O-012, O-010 |
| P09-08-T1 | — | blocked — O-012 |
| P09-08-T2 | — | blocked — O-012, G-SEC, EXTERNAL-ACTION |
| P09-09-T1 | — | blocked — O-012, O-016 |
| P10-01-T1 | — | blocked — O-008, O-015, F-OWNERS, F-LEGAL |
| P10-01-T2 | — | blocked — O-008, O-015, O-016 |
| P10-02-T1 | — | blocked — O-008, O-016, O-007, G-SEC, EXTERNAL-ACTION |
| P10-03-T1 | — | blocked — F-LEGAL, O-008, G-SEC |
| P10-04-T1 | — | blocked — O-006, O-007 |
| P10-04-T2 | — | blocked — O-006, O-008, G-DATA, EXTERNAL-ACTION |
| P10-05-T1 | — | blocked — O-008, O-013, EXTERNAL-ACTION |
| P10-05-T2 | — | blocked — O-012, O-009, EXTERNAL-ACTION |
| P10-06-T1 | — | blocked — O-007, O-008, O-016 |
| P10-06-T2 | — | blocked — O-007, O-008, EXTERNAL-ACTION |
| P10-07-T1 | — | blocked — O-007, O-008, O-012, O-009 |
| P10-07-T2 | — | blocked — G-OPS, EXTERNAL-ACTION |
| P10-08-T1 | — | blocked — F-OWNERS, O-006, O-007, O-016 |
| P10-08-T2 | — | blocked — O-006, O-008, EXTERNAL-ACTION |
| P10-09-T1 | rlp-b03/US-309 | registered |
| P10-09-T2 | — | blocked — G-SEC, EXTERNAL-ACTION |
| P11-01-T1 | — | blocked — G-DATA, G-SEC, G-DETECT, G-LABEL, G-OPS, G-RELEASE |
| P11-02-T1 | — | blocked — G-DATA, G-SEC, G-OPS, G-RELEASE, EXTERNAL-ACTION |
| P11-03-T1 | — | blocked — G-PUSH, G-DETECT, G-OPS, G-RELEASE, EXTERNAL-ACTION |
| P11-04-T1 | — | blocked — G-ONLINE, G-DETECT, G-SEC, G-OPS, G-RELEASE, EXTERNAL-ACTION |
| P11-05-T1 | — | blocked — G-RELEASE, G-OPS, EXTERNAL-ACTION |
| P11-06-T1 | — | blocked — F-OWNERS, O-010, G-LABEL, G-RELEASE |
| P11-07-T1 | — | blocked — F-OWNERS, G-RELEASE |

Read master.json for complete source requirements, dependencies, proposed paths, acceptance criteria and gates. Live receipts override the static registered snapshot; completed tasks are never restarted. When the9 ready tasks finish the master stops with122 blocked leaves until required evidence/authority is available.
