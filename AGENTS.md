# Working rules

- Before every implementation batch, list the goal, ordered tasks, files/services, verification and unresolved inputs in chat; wait for the user's instruction to start that batch.
- Once a batch is approved, finish its scope without asking again for every file/command. List material scope additions before implementing them.
- This is a new NestJS/TypeScript + Python/FastAPI platform. Do not reuse the previous Go/local runtime.
- Build only the approved item. Item 1 is repository/toolchain setup; API, ML service, contracts, profiling tools and CI are separate items.
- Source configuration, masking/full-account representation, stable account identity and the masking boundary remain unverified. Do not invent account linkage or treat earlier assumptions as verified facts.
- Keep secrets, real account values and private datasets out of source control and logs. Record actual checks and pending gates in `docs/implementation-status/current.md`.
