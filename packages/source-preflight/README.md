# @lmps/source-preflight

Local synthetic MariaDB 11.8 metadata inspector and isolated fixture manager. TypeScript + the exact `mariadb@3.5.4` Node connector; Node's test runner and existing Python tooling need no new testing framework.

Use root `source:prepare`, `source:init`, `source:start`, `source:preflight`, `source:stop` and `test:preflight` scripts. See the [operations, scope, report/exit-code and security guide](../../infrastructure/mariadb/README.md).

`inspect(config)` validates a local-only profile, opens one TLS-verified bounded connection, executes the fixed exported `SQL` allowlist, returns a redacted best-effort metadata report and destroys the connection. `validateConfig`, `sanitizeVersion`, `sanitizeVariables`, `sanitizeReplication` and `compareSchema` expose the narrow validation/comparison boundaries exercised by tests. The package does not accept arbitrary SQL or a source DSN, access the real LMPS replica, normalize transaction values or write to PostgreSQL.

`scripts/local.mjs` manages only a newly initialized owned fixture. `scripts/preflight.mjs` reads its generated private configuration and provides the JSON CLI. Tests use their own disposable fixture, not `.local/mariadb`. Do not treat the local fixture or its zero replica channels as real-source evidence.
