# claude-tokenstein — Implementation Plan (Windows-primary)

This plan executes PRD §14 in order with fine-grained sub-steps. **Primary deployment target: Windows 10/11 (x64).** macOS and Linux are secondary (developer machines and best-effort users). Every cross-cutting concern, hook, path, lockfile, and CI matrix is biased to Windows. Each section ends with explicit acceptance criteria. Code skeletons are illustrative — they show shape, not finished implementation.

---

## Table of contents

0. Repository preflight
1. Cross-cutting concerns (Windows-first)
2. Step 1 — Project bootstrap
3. Step 2 — DuckDB layer
4. Step 3 — JSONL ingest
5. Step 4 — CLI scaffold
6. Step 5 — Pricing & cost
7. Step 6 — Reports
8. Step 7 — SessionStart hook + lockfile
9. Step 8 — FX module
10. Step 9 — Admin API ingest
11. Step 10 — MCP server + plugin manifest
12. Step 11 — Whitespace normalization
13. Step 12 — Test plan
14. Step 13 — Distribution
15. Build-order dependency notes
16. Risk register
17. Glossary
18. Appendix A — Windows quick-reference
19. Appendix B — Cross-platform compatibility matrix

---

## 0. Repository preflight

Before step 1, the implementer must reconcile the repo's current state.

### 0.1 Existing files

- `PRD.md` — product spec, immutable input. Note that PRD §5 shows a POSIX `flock`-based hook script. **That sample assumes POSIX and must be replaced** with a PowerShell-based hook plus a POSIX fallback. See step 7.
- `.mcp.json` — references `gitnexus`, `claude-memory`, `ouroboros`. **This is the developer's dev-environment file, not the plugin manifest.** Move to `.claude/mcp.json` (project-local) before step 10 writes the plugin's `.mcp.json` at the repo root.
- `PLAN.md` — this document.

### 0.2 Initial git hygiene

- Confirm `git config core.fileMode false` on Windows clones — Windows does not preserve POSIX exec bit and trying to track it produces noise. The lock-related executable for POSIX dev machines is handled separately (step 7).
- Set `git config init.defaultBranch main` if not already.
- Set `git config core.autocrlf false` and use `.gitattributes` for explicit line-ending control. **CRLF for PowerShell scripts** (`.ps1`, `.cmd`) — Windows tooling tolerates LF, but some installers do not. **LF for everything else** — TypeScript, JSON, Markdown, POSIX shell scripts.

```
* text=auto eol=lf
*.ps1   text eol=crlf
*.cmd   text eol=crlf
*.bat   text eol=crlf
*.sh    text eol=lf
*.ts    text eol=lf
*.json  text eol=lf
*.md    text eol=lf
*.duckdb binary
*.duckdb.wal binary
```

### 0.3 Working assumptions

- **Primary OS: Windows 10 1809+ or Windows 11**. PowerShell 5.1 (default in-box) **and** PowerShell 7.x both supported. The hook script targets the lowest common denominator: `powershell.exe` (5.1).
- **Secondary OS: macOS 13+ (arm64/x64), Linux x64** for developer workstations.
- **Node 20.10+** required on all platforms — for stable `fetch`, `AbortSignal.timeout`, native ESM loaders, and Windows `npm` shims.
- Claude Code plugin loader version compatible with the `plugin.json` schema. Implementer must verify against current Claude Code docs at implementation time. **Specifically verify how Claude Code resolves and executes hook scripts on Windows** — does it call `cmd.exe`, `powershell.exe`, or just exec the path? The hook script set in step 7 covers the three plausible cases.
- No WSL assumption — users may be on plain Windows shell (PowerShell, cmd) without WSL installed.

### 0.4 Acceptance criteria

- `git ls-files` shows `PRD.md`, `PLAN.md`, `.gitattributes` (newly added), and `.claude/mcp.json` (relocated).
- The repo root has no `.mcp.json` until step 10 writes the plugin manifest.
- A clone on Windows shows no spurious file-mode diffs (`git status` clean immediately after clone).
- A clone on Windows shows `.ps1` files with CRLF line endings (`git ls-files --eol hooks/session-start.ps1`).

---

## 1. Cross-cutting concerns (Windows-first; read first, apply throughout)

### 1.1 TypeScript strict settings

`tsconfig.json` `compilerOptions` should set:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

`forceConsistentCasingInFileNames` matters more on Windows because NTFS is case-insensitive but case-preserving — TypeScript will tolerate `import './Foo.js'` referring to `foo.ts` on Windows but break on macOS/Linux. The flag catches this at compile time.

CI runs `tsc --noEmit` on a Windows runner.

### 1.2 Path handling — never assume forward slashes

Every path manipulation goes through `node:path` (`path.join`, `path.resolve`, `path.sep`). **Never** template strings like `` `${dir}/${file}` ``. The `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` shape from PRD §2 becomes, on Windows:

```
C:\Users\<user>\.claude\projects\<encoded-cwd>\<session-uuid>.jsonl
```

The encoded-cwd convention used by Claude Code on Windows currently appears to translate `C:\Users\foo\Desktop\proj` to `C--Users-foo-Desktop-proj` (colon and backslashes both become single dashes). Confirm against a real Windows Claude Code installation in step 3 fixtures; if the convention differs, update the decoder in `src/ingest/walk.ts`. Either way, **store the encoded form verbatim** in `messages.project_cwd` and let the `top --by=project` report group on it as-is.

`os.homedir()` returns the right thing on Windows (`C:\Users\<user>`); use it everywhere instead of expanding `~`.

### 1.3 Deterministic-id collision risk (`request_id` null in older transcripts)

PRD says `messages.id = sha256(session_id || iso_ts || request_id)`. When `request_id` is null and two assistant turns land in the same millisecond (rare but real for streamed responses), or when the same JSONL is replayed across a re-encoded transcript, collisions silently drop rows under `ON CONFLICT DO NOTHING`.

**Fallback rule.** When `request_id` is null, append `||file_path||line_offset||sha256(message_text[:512])` to the hash input. The path component is normalized via `path.normalize` and lowercased on Windows to match NTFS semantics so `C:\Users\Foo\...` and `c:\users\foo\...` produce the same id. Document the rule in `src/db/ids.ts` with one canonical function `messageId()` used everywhere.

```ts
// src/db/ids.ts (illustrative)
import { createHash } from "node:crypto";
import { normalize } from "node:path";

export interface MessageIdInput {
  sessionId: string;             // 'admin_api' allowed sentinel for synthetic rows
  isoTs: string;                 // already canonicalized to ISO 8601 with Z
  requestId: string | null;
  filePath?: string;             // required if requestId === null
  lineOffset?: number;           // required if requestId === null
  textHashHex?: string;          // required if requestId === null; sha256 of first 512 chars
}

export function messageId(input: MessageIdInput): string {
  const parts: string[] = [input.sessionId, input.isoTs];
  if (input.requestId !== null) {
    parts.push(input.requestId);
  } else {
    if (!input.filePath || input.lineOffset == null || !input.textHashHex) {
      throw new Error("messageId: requestId null requires filePath/lineOffset/textHashHex");
    }
    const fp = process.platform === "win32"
      ? normalize(input.filePath).toLowerCase()
      : normalize(input.filePath);
    parts.push("null", fp, String(input.lineOffset), input.textHashHex);
  }
  const hex = createHash("sha256").update(parts.join("\x00")).digest("hex");
  return formatAsUuid(hex.slice(0, 32));
}

function formatAsUuid(hex32: string): string {
  return [hex32.slice(0, 8), hex32.slice(8, 12), hex32.slice(12, 16),
          hex32.slice(16, 20), hex32.slice(20, 32)].join("-");
}
```

The NUL separator (`\x00`) prevents adjacency collisions (`"a","bc"` vs `"ab","c"`).

### 1.4 DuckDB on Windows

Use `@duckdb/node-api` (the official new binding). Reasons:

1. Actively maintained by DuckDB Labs.
2. Prebuilt **Windows x64** binaries — no MSVC toolchain required on the user's machine. Verify the package ships `prebuilt/win32-x64/...` artifacts; if not, fall back to the legacy `duckdb` package which has broader prebuilt coverage.
3. Async-first API matches our async ingest.
4. Supports `access_mode: 'READ_ONLY'` cleanly for the reader/writer split.

Note: parameter binding goes through `await connection.prepare(sql)` then `prepared.bind([...])` — do not paste examples from the legacy `duckdb` package.

**Windows-specific gotchas:**

- DuckDB writes a `.wal` sidecar next to the database file. On Windows, `~/.claude-tokenstein/tokens.duckdb.wal` may be locked by an antivirus scanner mid-write — document the symptom and suggest excluding `~/.claude-tokenstein/` from real-time scanning.
- DuckDB acquires a Windows file lock on the DB file when opened for writing. Reader connections (`READ_ONLY`) acquire only a shared lock and coexist fine with one writer.
- Long path support: DuckDB and Node both handle `\\?\C:\...` (extended-length) paths if `LongPathsEnabled` is set in the registry. We don't need it for the default install path, but encoded-cwd directories can grow long — log a warning if `dbPath()` exceeds 240 chars.

### 1.5 Hook script — Windows primary, POSIX fallback

PRD §5 shows a `flock`-based shell script. **That cannot run on Windows.** Replace with a PowerShell `.ps1` script as primary, plus a `.cmd` shim and a POSIX `.sh` for developer machines.

Full discussion in step 7. Cross-cutting summary: **the lockfile mechanism is `proper-lockfile` (JS) on every platform**, because (a) Windows has no `flock`, (b) using JS uniformly avoids two code paths, (c) `proper-lockfile` correctly handles Windows file locking semantics.

The shell hook merely launches a detached `claude-tokenstein ingest --since-last --with-lock` and exits; the JS process holds the lock.

### 1.6 Bundled price-table model-id divergence

PRD's `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` do not match Anthropic's dated billing IDs (`claude-opus-4-5-20250929`-style). This plan adds a `MODEL_ALIASES` map in `src/pricing/loader.ts` that normalizes inbound model strings to canonical short keys before price lookup.

The implementer should refresh both the alias map and `prices.json` against live transcripts on first run. A debug subcommand `claude-tokenstein debug list-models` prints distinct `model` values seen in the DB and whether each maps to a known price.

### 1.7 Whitespace normalization (§7) ordering

§7 in the build sequence comes after JSONL ingest (§2/§3) but is *consumed* by ingest (`prompts.text` is normalized at insert time). Resolution: in step 3, scaffold `src/normalize/text.ts` as a passthrough identity function with a TODO; replace with the real implementation in step 11. **This is the single retroactive touchpoint in the plan.**

### 1.8 Logging strategy

All long-running paths (ingest, FX fetch, admin API) write to `%USERPROFILE%\.claude-tokenstein\logs\ingest.log` with structured prefixes:

```
2026-05-02T10:14:21Z [INFO]  ingest.start source=claude_code
2026-05-02T10:14:21Z [WARN]  pricing.unknown_model model=claude-haiku-4-5
2026-05-02T10:14:23Z [INFO]  ingest.done files=12 lines=4023 messages=187 dt_ms=2031
```

**Line endings in the log file: LF, regardless of OS.** Windows tooling (Notepad++, VS Code, `Get-Content`) handles LF correctly; emitting CRLF doubles bytes for no benefit and confuses `tail -f` from Git Bash users.

Log rotation: rename to `.1` when size > 10 MB; keep one rotation. On Windows, `fs.renameSync` over an existing file fails with `EPERM` if another handle is open — close the writer stream first, then rename, then reopen.

### 1.9 Error class hierarchy

```ts
// src/errors.ts
export class TokensteinError extends Error { exitCode = 1; }
export class UserError       extends TokensteinError { exitCode = 2; }
export class LockBusyError   extends TokensteinError { exitCode = 0; }   // hook quietness
export class FxUnavailableError extends TokensteinError { exitCode = 1; }
export class ConfigError     extends UserError {}
export class IngestError     extends TokensteinError {}
```

`cli.ts` top-level catch maps `instanceof` to `process.exit(err.exitCode)` and writes the stack to the log.

### 1.10 Time and timezone

All timestamps stored as UTC `TIMESTAMP` (no zone). Inputs parsed strictly: JSONL `timestamp` is ISO-8601 with `Z`; Admin API `bucket_start` likewise. Reports render in the user's local timezone (`Intl.DateTimeFormat` with default locale) but query in UTC.

Windows users may have non-English locales (`de-DE`, `tr-TR`, `ja-JP`); `Intl.DateTimeFormat` and `Intl.NumberFormat` handle these correctly out of the box. **Test the `cost` and `today` reports under a non-en-US locale** because date and decimal formatting differ (e.g., `1.234,56` in `de-DE`).

The `today` subcommand interprets "today" in local time — convert local midnight → UTC range before WHERE. Watch DST transitions: a "today" boundary on a DST-shifting day is 23 or 25 hours, not 24.

### 1.11 Code style

- Two-space indent.
- Named exports only (no default exports).
- Async/await everywhere; no `.then()` chains except in test stubs.
- File names: `kebab-case.ts`. Type names: `PascalCase`. Functions and variables: `camelCase`.
- SQL: uppercase keywords for readability against DuckDB's case-insensitive identifiers.
- **No reliance on terminal ANSI color** in default output: Windows `cmd.exe` and older PowerShell hosts may not interpret ANSI escape codes. `cli-table3` defaults to no color, which suits us. Add `--color` opt-in (not opt-out).

### 1.12 Security posture

- `%USERPROFILE%\.claude-tokenstein\config.json` cannot be `chmod 600` on Windows — POSIX modes do not exist on NTFS. Use ACL inheritance: the directory is created under the user profile which inherits user-only ACLs from `%USERPROFILE%`. **Loader checks** that the file is not in a world-readable location (skip the mode check entirely on Windows; on POSIX, refuse to load if mode & 0o077).
- Admin API key never logged; redact via `redactSecrets()` in the logger.
- SQL: every dynamic query uses parameter binding. Whitelist column names for `top --by`.
- No `eval`, no `Function` constructor.
- Document for Windows users: keep the config file inside `%USERPROFILE%\.claude-tokenstein\` (which is inside their home and not world-readable by default). Do not put it in `C:\ProgramData\` or any shared location.

### 1.13 Process spawning on Windows

- Avoid shelling out via `child_process.exec` — this invokes `cmd.exe` and is vulnerable to argument injection on Windows. Use `child_process.spawn` with `{shell: false}` and an explicit command + array of args.
- Never construct shell commands by string concatenation with user input.
- The JSONL parser and DuckDB calls are all in-process — no spawning needed in the hot path.

---

## 2. Step 1 — Project bootstrap

### 2.1 Build-tooling choice

`tsx` for dev/runtime, `tsc --noEmit` for CI typecheck. Bundling rejected because (a) `@duckdb/node-api` ships native binaries that `esbuild` cannot bundle, (b) Windows users get a `.cmd` shim from `npm` automatically — no need for a custom binary.

**Justification:** plugin users invoke the CLI via `node_modules\.bin\claude-tokenstein.cmd` after `npm install`; there is no published binary, so bundling buys nothing. `tsx` execs `.ts` directly and removes the pre-publish build step.

### 2.2 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/package.json`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/tsconfig.json`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/bin/claude-tokenstein.mjs`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/.eslintrc.cjs`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/.prettierrc`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/.gitignore`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/.gitattributes` (from §0.2)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/.nvmrc` — pinned Node 20 LTS
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/README.md` — placeholder; filled in step 13

### 2.3 `package.json` skeleton

```json
{
  "name": "claude-tokenstein",
  "version": "0.1.0",
  "description": "Track and report Claude token usage from local logs and the Anthropic Admin API",
  "type": "module",
  "engines": { "node": ">=20.10" },
  "os": ["win32", "darwin", "linux"],
  "bin": { "claude-tokenstein": "./bin/claude-tokenstein.mjs" },
  "files": ["bin", "src", "commands", "hooks", "plugin.json", ".mcp.json", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\" \"*.md\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "dev": "tsx src/cli.ts",
    "ingest": "tsx src/cli.ts ingest"
  },
  "dependencies": {
    "@duckdb/node-api": "^1.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "commander": "^12.x",
    "cli-table3": "^0.6.x",
    "proper-lockfile": "^4.x",
    "undici": "^6.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/proper-lockfile": "^4.x",
    "@typescript-eslint/eslint-plugin": "^7.x",
    "@typescript-eslint/parser": "^7.x",
    "eslint": "^8.x",
    "prettier": "^3.x",
    "tsx": "^4.x",
    "typescript": "^5.x",
    "vitest": "^1.x"
  }
}
```

Note the **double-quoted** glob in `lint`/`format` scripts — Windows `cmd.exe` does not glob-expand single quotes. Always double-quote globs in npm scripts for cross-platform compatibility.

### 2.4 `bin/claude-tokenstein.mjs` shim

```js
#!/usr/bin/env node
// Use tsx's programmatic loader so a global install works without npx.
// On Windows, npm wraps this in a .cmd file automatically — the shebang is harmless.
import { register } from "tsx/esm/api";
register();
await import("../src/cli.ts");
```

On Windows, `npm install` generates `node_modules\.bin\claude-tokenstein.cmd` (cmd shim) and `claude-tokenstein.ps1` (PowerShell shim) automatically alongside the bare `.mjs`. Users never invoke the `.mjs` directly on Windows.

### 2.5 ESLint + Prettier config

`.eslintrc.cjs` — extend `plugin:@typescript-eslint/recommended-type-checked` with the project tsconfig as `parserOptions.project`. Disable `no-console` (we use stdout intentionally). Enforce `@typescript-eslint/consistent-type-imports`.

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

`endOfLine: lf` enforces LF in `.ts`/`.json`/`.md` even on Windows; `.gitattributes` already takes care of CRLF for `.ps1`/`.cmd`.

### 2.6 `.gitignore`

```
node_modules/
dist/
coverage/
*.duckdb
*.duckdb.wal
.tsbuildinfo
.DS_Store
Thumbs.db
desktop.ini
```

`Thumbs.db` and `desktop.ini` are Windows shell debris. `~/.claude-tokenstein/` is outside the repo, no entry needed.

### 2.7 Trade-offs

- `commander` over `yargs`: smaller, type-friendly, declarative subcommands map cleanly to PRD's seven reports. Both are cross-platform; no Windows preference.
- `zod` for config validation gives free TS types and gates the admin key shape (`/^sk-ant-admin-/`).
- `proper-lockfile` over hand-rolled `O_EXCL` write: works on Windows (where `O_EXCL` is unreliable), handles stale-lock detection, and is the same code path on every platform.

### 2.8 Acceptance criteria

- `npm install` on Windows completes with no native-build steps (DuckDB ships prebuilt binaries).
- `npx tsx src/cli.ts --version` prints the package version on Windows.
- `npm run typecheck` exits 0 on Windows against an empty `src/cli.ts` stub.
- `npm run lint` exits 0 on the empty stub on Windows.
- `node_modules\.bin\claude-tokenstein.cmd` exists after install.

---

## 3. Step 2 — DuckDB layer

### 3.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/schema.sql`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/duckdb.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/migrate.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/migrations/001_init.sql`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/ids.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/paths.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/types.ts` — TS types mirroring schema rows

### 3.2 Schema

`migrations/001_init.sql` is verbatim PRD §4 with two amendments:

1. Wrap each `CREATE TABLE` and `CREATE INDEX` in `IF NOT EXISTS`.
2. Add a `_migrations` housekeeping table (created by the runner, not the SQL file).

```sql
-- 001_init.sql
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY,
    session_id      VARCHAR NOT NULL,
    project_cwd     VARCHAR NOT NULL,
    git_branch      VARCHAR,
    ts              TIMESTAMP NOT NULL,
    model           VARCHAR NOT NULL,
    service_tier    VARCHAR,
    request_id      VARCHAR,
    claude_version  VARCHAR,
    source          VARCHAR NOT NULL,
    input_tokens                BIGINT NOT NULL,
    output_tokens               BIGINT NOT NULL,
    cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_input_tokens     BIGINT NOT NULL DEFAULT 0,
    cache_eph_1h_tokens         BIGINT NOT NULL DEFAULT 0,
    cache_eph_5m_tokens         BIGINT NOT NULL DEFAULT 0,
    web_search_requests         BIGINT NOT NULL DEFAULT 0,
    web_fetch_requests          BIGINT NOT NULL DEFAULT 0,
    user_prompt_id              UUID,
    response_text_id            UUID
);

CREATE TABLE IF NOT EXISTS prompts (
    id          UUID PRIMARY KEY,
    role        VARCHAR NOT NULL,
    text        VARCHAR NOT NULL,
    char_count  BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_state (
    source              VARCHAR PRIMARY KEY,
    last_ingested_ts    TIMESTAMP,
    last_run_ts         TIMESTAMP,
    cursor              VARCHAR
);

CREATE TABLE IF NOT EXISTS files_seen (
    path        VARCHAR PRIMARY KEY,
    mtime       TIMESTAMP,
    size_bytes  BIGINT,
    line_count  BIGINT,
    sha256      VARCHAR
);

CREATE TABLE IF NOT EXISTS prices (
    model               VARCHAR,
    effective_from      DATE,
    input_per_mtok_usd  DOUBLE,
    output_per_mtok_usd DOUBLE,
    cache_write_per_mtok_usd DOUBLE,
    cache_read_per_mtok_usd  DOUBLE,
    PRIMARY KEY (model, effective_from)
);

CREATE TABLE IF NOT EXISTS fx_rates (
    date     DATE PRIMARY KEY,
    usd_eur  DOUBLE NOT NULL,
    fetched_at TIMESTAMP NOT NULL,
    source   VARCHAR NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msgs_ts      ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_msgs_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_msgs_project ON messages(project_cwd);
CREATE INDEX IF NOT EXISTS idx_msgs_model   ON messages(model);
```

`files_seen.path` stores the full Windows path, e.g., `C:\Users\foo\.claude\projects\C--Users-foo-Desktop-proj\abcd-1234.jsonl`. The VARCHAR length is unbounded in DuckDB so long paths are fine.

### 3.3 Connection wrapper

```ts
// src/db/duckdb.ts (illustrative)
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { dbPath, ensureRuntimeDir } from "./paths.js";
import { runMigrations } from "./migrate.js";

let writerInstance: DuckDBInstance | null = null;

export async function openWriter(): Promise<DuckDBConnection> {
  await ensureRuntimeDir();
  if (!writerInstance) {
    writerInstance = await DuckDBInstance.create(dbPath());
  }
  const conn = await writerInstance.connect();
  await runMigrations(conn);
  return conn;
}

export async function openReader(): Promise<DuckDBConnection> {
  await ensureRuntimeDir();
  if (!(await dbExists())) {
    const w = await openWriter();
    await w.closeSync();
    writerInstance = null;
  }
  const ro = await DuckDBInstance.create(dbPath(), { access_mode: "READ_ONLY" });
  return ro.connect();
}
```

### 3.4 Migration runner

```ts
// src/db/migrate.ts (illustrative)
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

export async function runMigrations(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL
    );
  `);
  const applied = await conn.runAndReadAll("SELECT version FROM _migrations");
  const appliedSet = new Set(applied.getRowObjects().map((r) => r.version));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const version = parseInt(f.split("_", 1)[0], 10);
    if (Number.isNaN(version)) continue;
    if (appliedSet.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    await conn.run("BEGIN");
    try {
      await conn.run(sql);
      await conn.run("INSERT INTO _migrations VALUES (?, ?)", [version, new Date()]);
      await conn.run("COMMIT");
    } catch (e) {
      await conn.run("ROLLBACK");
      throw e;
    }
  }
}
```

### 3.5 Paths helper (Windows-aware)

```ts
// src/db/paths.ts (illustrative)
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const ROOT = join(homedir(), ".claude-tokenstein");

export const dbPath        = () => join(ROOT, "tokens.duckdb");
export const configPath    = () => join(ROOT, "config.json");
export const lockPath      = () => join(ROOT, "ingest.lock");
export const logPath       = () => join(ROOT, "logs", "ingest.log");
export const pricesOverridePath = () => join(ROOT, "prices.json");

export async function ensureRuntimeDir(): Promise<void> {
  // Mode 0o700 is a no-op on Windows; the directory inherits user-only ACLs from %USERPROFILE%.
  await mkdir(join(ROOT, "logs"), { recursive: true, mode: 0o700 });
}
```

On Windows, `homedir()` returns `C:\Users\<user>`. Resulting paths look like `C:\Users\foo\.claude-tokenstein\tokens.duckdb`. The leading dot is allowed by NTFS (the limitation was lifted decades ago).

### 3.6 TS row types

```ts
// src/db/types.ts (illustrative)
export interface MessageRow {
  id: string;
  session_id: string;
  project_cwd: string;
  git_branch: string | null;
  ts: Date;
  model: string;
  service_tier: string | null;
  request_id: string | null;
  claude_version: string | null;
  source: "claude_code" | "admin_api";
  input_tokens: bigint;
  output_tokens: bigint;
  cache_creation_input_tokens: bigint;
  cache_read_input_tokens: bigint;
  cache_eph_1h_tokens: bigint;
  cache_eph_5m_tokens: bigint;
  web_search_requests: bigint;
  web_fetch_requests: bigint;
  user_prompt_id: string | null;
  response_text_id: string | null;
}

export interface FilesSeenRow {
  path: string;
  mtime: Date;
  size_bytes: bigint;
  line_count: bigint;
  sha256: string;
}
```

DuckDB returns `BIGINT` as JS `bigint`. Code that sums/compares must keep it `bigint` end-to-end or convert with explicit `Number()` knowing the precision risk above 2^53.

### 3.7 Architectural decision: writer vs reader connections

Recommend **opening fresh per-command** (no persistent reader). DuckDB cold-open on a 1M-row file is sub-100 ms; slash commands are short-lived child processes anyway.

### 3.8 Risks / edge cases

- DuckDB allows exactly one writer process. Reader connections always READ_ONLY.
- DB file missing at first slash-command invocation → `openReader()` calls `openWriter()` first to create+migrate, then closes and reopens read-only.
- DuckDB may write a `.wal` sidecar; `.gitignore` covers `*.duckdb.wal`.
- `BIGINT → bigint` JSON serialization is not native; reports must `String(bigint)` or compute in JS using `Number()` after bounds-checking.
- **Windows AV interference.** Some antivirus products (Windows Defender included) scan `.duckdb` files on every write, slowing ingest. Document an exclusion recipe in the README troubleshooting section.

### 3.9 Acceptance criteria

- `await openWriter()` on a missing file creates `%USERPROFILE%\.claude-tokenstein\tokens.duckdb` with all PRD §4 tables and indexes.
- Calling `openWriter()` twice in the same process applies migrations exactly once.
- `await openReader()` on an existing file with another writer attached succeeds; attempting a write on the reader throws.
- `messageId()` produces stable UUIDs across runs given the same inputs (snapshot test).
- `messageId({...filePath: "C:\\Users\\Foo\\x.jsonl"...})` and `messageId({...filePath: "c:\\users\\foo\\x.jsonl"...})` produce **the same** id on Windows (case-insensitive normalization).

---

## 4. Step 3 — JSONL ingest

### 4.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/claude-code.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/walk.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/jsonl-parser.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/orchestrator.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/types.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/normalize/text.ts` — passthrough stub for now

### 4.2 Public API

```ts
export interface IngestStats {
  filesScanned: number;
  filesSkipped: number;
  linesRead: number;
  messagesInserted: number;
  promptsInserted: number;
  skipped: { truncated: number; noUsage: number; parseError: number };
  durationMs: number;
}

export async function ingestClaudeCode(
  conn: DuckDBConnection,
  opts: { sinceLast?: boolean; dryRun?: boolean }
): Promise<IngestStats> { /* ... */ }
```

### 4.3 Walker (Windows-aware)

```ts
// src/ingest/walk.ts (illustrative)
import { homedir } from "node:os";
import { opendir } from "node:fs/promises";
import { join } from "node:path";

export async function* globProjects(): AsyncIterable<string> {
  const root = join(homedir(), ".claude", "projects");
  for await (const projectDir of await opendir(root)) {
    if (!projectDir.isDirectory()) continue;
    for await (const entry of await opendir(join(root, projectDir.name))) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        yield join(root, projectDir.name, entry.name);
      }
    }
  }
}
```

`opendir` on Windows correctly enumerates entries — no path-separator hardcoding needed because `join` handles it.

### 4.4 Per-file algorithm

1. `stat` file. Look up `files_seen` row by path.
2. If `mtime` and `size_bytes` unchanged → skip.
3. Open with `readline` over a `createReadStream`. For-await iterate keeping a `currentLineNo` counter starting at the prior `line_count`. Use a `skip(N)` helper that drops the first N lines without parsing.
4. For each non-empty line: `parseLine`. If parse fails and we are *not* at the last line of the file → log + skip; if at the last line → log + do **not** advance `line_count` past it (allows retry next ingest).
5. If `parsed.type === 'assistant' && parsed.usage` → build a `messages` row. Resolve `user_prompt_id` (see §4.6). Resolve `response_text_id` by extracting the assistant text from `parsed.content`, `normalizePromptText`, sha256, upsert into `prompts`.
6. After every N=500 messages or end-of-file: commit transaction, update `files_seen` row.

**Windows note:** `fs.createReadStream` on Windows opens with non-exclusive sharing by default — Claude Code can continue appending to the JSONL while we read. `readline` with the default newline handling correctly splits on `\n` regardless of whether the file uses LF or CRLF (the trailing `\r` lands on each line and `JSON.parse` tolerates it on lines that are pure JSON; if a transcript ever contains a bare `\r` mid-string, that's already JSON-invalid and parse will fail — handled by the truncation logic).

### 4.5 Parser

```ts
// src/ingest/jsonl-parser.ts (illustrative)
export interface ParsedLine {
  raw: string;
  uuid?: string;
  parentUuid?: string | null;
  type?: "user" | "assistant" | "system" | "summary" | string;
  ts?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  cliVersion?: string;
  message?: {
    role?: "user" | "assistant";
    content?: ContentBlock[] | string;
    model?: string;
    usage?: Usage;
    id?: string;
  };
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown; id: string }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  service_tier?: string;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
}

export function parseLine(raw: string): ParsedLine | null {
  try { return { raw, ...JSON.parse(raw) }; } catch { return null; }
}
```

### 4.6 User→assistant pairing for `user_prompt_id` (deviation from PRD)

PRD says "look back to nearest preceding `type == 'user'` line." In real Claude Code transcripts, `type == 'user'` is also emitted for `tool_result` messages, so naive "nearest preceding" pairs the assistant turn with the most recent tool result rather than the human's prompt.

**Recommended algorithm.** Maintain an in-memory `parentUuid → parsedLine` map for the current file; walk from the assistant's `parentUuid` up the chain until you hit a line where `type === 'user'` *and* `message.content` is either a plain string or an array containing at least one block whose `type !== 'tool_result'`. That is the human prompt. Cache it.

```ts
function isHumanUserLine(p: ParsedLine): boolean {
  if (p.type !== "user") return false;
  const content = p.message?.content;
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.some((b) => b.type !== "tool_result");
}

function resolveUserPrompt(
  current: ParsedLine,
  byUuid: Map<string, ParsedLine>
): ParsedLine | null {
  let cursor = current.parentUuid ? byUuid.get(current.parentUuid) : null;
  let hops = 0;
  while (cursor && hops < 50) {
    if (isHumanUserLine(cursor)) return cursor;
    cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : null;
    hops++;
  }
  return null;
}
```

### 4.7 Idempotent insert

```sql
INSERT INTO messages (id, session_id, project_cwd, git_branch, ts, model, ...)
VALUES (?, ?, ?, ?, ?, ?, ...)
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompts (id, role, text, char_count)
VALUES (?, ?, ?, ?)
ON CONFLICT (id) DO NOTHING;
```

### 4.8 Risks / edge cases

- **Truncated last line** during active session — don't advance `line_count` past failing line.
- **JSONL line without `usage`** — skip silently.
- **Encoded-cwd directory translation on Windows.** Claude Code on Windows encodes paths like `C:\Users\foo\Desktop\proj` → `C--Users-foo-Desktop-proj` (best guess; verify against a real Windows install). Store the encoded form verbatim in `messages.project_cwd`.
- **Git branch field** only present on some lines. Carry the most recent value forward within a file.
- **`service_tier`** at `message.usage.service_tier`; **`claude_version`** at top-level `cliVersion`.
- **Cache ephemeral fields** at `cache_creation.ephemeral_5m_input_tokens` and `..._1h_input_tokens`.
- **Web tool counters** at `usage.server_tool_use.web_search_requests` / `..web_fetch_requests`.
- **CRLF line endings inside strings.** Some transcripts may store user prompts containing literal `\r\n`. The JSONL delimiter is `\n` only; the `\r\n` inside a quoted string is JSON-valid. Don't strip newlines pre-parse.
- **Antivirus locking the JSONL file.** On Windows, AV may briefly hold a file open after Claude Code writes it, causing `EBUSY` on read. Implement a one-retry-with-50ms-sleep for `EBUSY`/`EPERM` on `createReadStream`.

### 4.9 Concurrency within ingest

Sequential per file; lines processed strictly in order. No cross-file parallelism in v1.

### 4.10 Acceptance criteria

- Ingesting a fixture JSONL twice yields zero new rows the second time.
- Truncating the last byte of a fixture and ingesting yields N-1 messages and leaves `files_seen.line_count` at the last *complete* line.
- A turn whose immediate predecessor is a `tool_result` resolves `user_prompt_id` to the human prompt several lines back.
- An assistant turn with `cache_creation.ephemeral_5m_input_tokens=42` produces a row with `cache_eph_5m_tokens=42`.
- On Windows, ingesting a fixture containing CRLF line endings produces the same row count as the LF variant.

---

## 5. Step 4 — CLI scaffold

### 5.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/cli.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/log.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/config.ts`

### 5.2 Subcommand layout

```
claude-tokenstein <subcommand> [options]

  ingest        Run an ingest pass
                  --since-last           use ingest_state cursors (default true)
                  --source <s>           claude_code | admin_api | all (default all)
                  --dry-run              compute work but do not write
                  --with-lock            acquire JS lockfile (used by hook)

  report <N>    Last N day totals
  today         Today's totals + per-model split
  session [id]  Single-session breakdown (default $env:CLAUDE_SESSION_ID on Windows)
  hourly        Last 24h hour-by-hour
  top           Top-N by tokens or cost
                  --by <session|project|model>  default model
                  --n <N>                       default 10
  cost <YYYY-MM>  Per-model cost for month
  debug list-models   Distinct model values + price-table coverage
  mcp           Run MCP server (used by Claude Code plugin host)

Global:
  --currency <usd|eur>  default usd (read from config if set)
  --json                machine output (snake_case JSON)
  --color               opt-in ANSI color (default off; matters on cmd.exe)
```

### 5.3 `commander` wiring

```ts
// src/cli.ts (illustrative)
import { Command } from "commander";
import { TokensteinError } from "./errors.js";
import { initLogger, log } from "./log.js";

const program = new Command()
  .name("claude-tokenstein")
  .version(pkgVersion())
  .option("--currency <c>", "usd or eur", "usd")
  .option("--json")
  .option("--color");

// ... subcommands

try {
  await initLogger();
  await program.parseAsync(process.argv);
} catch (e) {
  log.error("uncaught", e);
  if (e instanceof TokensteinError) process.exit(e.exitCode);
  process.exit(1);
}
```

### 5.4 Logger

```ts
// src/log.ts (illustrative)
import { createWriteStream, statSync, renameSync, closeSync } from "node:fs";
import { logPath } from "./db/paths.js";

let stream: NodeJS.WritableStream | null = null;

export async function initLogger(): Promise<void> {
  await rotateIfBig();
  stream = createWriteStream(logPath(), { flags: "a" });
}

async function rotateIfBig(): Promise<void> {
  try {
    const s = statSync(logPath());
    if (s.size <= 10 * 1024 * 1024) return;
    // On Windows, rename over an existing file requires the source to be closed first.
    if (stream) { (stream as any).end(); stream = null; }
    renameSync(logPath(), logPath() + ".1");
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
}

function emit(level: "INFO" | "WARN" | "ERROR", msg: string, meta?: object) {
  const line = `${new Date().toISOString()} [${level.padEnd(5)}] ${msg}` +
               (meta ? " " + JSON.stringify(meta) : "");
  stream?.write(line + "\n");
  if (process.env.TOKENSTEIN_DEBUG) console.error(line);
}

export const log = {
  info:  (m: string, meta?: object) => emit("INFO",  m, redact(meta)),
  warn:  (m: string, meta?: object) => emit("WARN",  m, redact(meta)),
  error: (m: string, e?: unknown)   => emit("ERROR", m, { error: serialize(e) }),
};

function redact(meta?: object): object | undefined {
  if (!meta) return undefined;
  const json = JSON.stringify(meta).replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***");
  return JSON.parse(json);
}
```

### 5.5 Config loader (Windows-aware)

```ts
// src/config.ts (illustrative)
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { configPath } from "./db/paths.js";
import { ConfigError } from "./errors.js";

const Schema = z.object({
  admin_api_key: z.string().regex(/^sk-ant-admin-/).optional(),
  default_currency: z.enum(["usd", "eur"]).default("usd"),
  fx_override_usd_eur: z.number().positive().nullable().default(null),
  ingest: z.object({
    claude_code: z.boolean().default(true),
    admin_api: z.boolean().default(true),
    max_admin_api_lookback_days: z.number().int().positive().default(30),
  }).default({}),
  store_prompts: z.boolean().default(true),
});

export type Config = z.infer<typeof Schema>;

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    if (process.platform !== "win32") {
      const s = await stat(configPath());
      if ((s.mode & 0o077) !== 0) {
        throw new ConfigError(`config.json is too permissive (mode ${s.mode.toString(8)}); chmod 600`);
      }
    }
    // On Windows, NTFS ACLs are inherited from %USERPROFILE% (user-only by default).
    // Skip the POSIX mode check; document the requirement to keep the file inside the user profile.
    raw = await readFile(configPath(), "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return Schema.parse({});
    throw e;
  }
  const parsed = Schema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new ConfigError(parsed.error.message);
  return parsed.data;
}
```

### 5.6 Argument parser choice

`commander` — declarative, typed via `.opts<T>()`, smaller install than `yargs`, ESM-friendly.

### 5.7 Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (or expected lock contention from hook) |
| 1 | Unexpected error |
| 2 | User error (bad args, missing config, validation failure) |
| 3 | Lock contention when *not* invoked from hook |

### 5.8 Acceptance criteria

- `claude-tokenstein --help` lists all subcommands plus `ingest`, `mcp`, and `debug`.
- `claude-tokenstein ingest --dry-run` prints planned work and exits 0 without touching the DB.
- An uncaught exception writes a stack trace to `%USERPROFILE%\.claude-tokenstein\logs\ingest.log` and exits 1.
- An admin key embedded in a thrown error message appears as `sk-ant-***` in the log file.
- On Windows, the loader does **not** error if the config file's "mode" is anything (skipped).

---

## 6. Step 5 — Pricing & cost

### 6.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/prices.json`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/loader.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/cost.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/snapshot.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/types.ts`

### 6.2 `prices.json` (verbatim PRD §8)

```json
{
  "claude-opus-4-7":   { "input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.50 },
  "claude-sonnet-4-6": { "input":  3.0, "output": 15.0, "cache_write":  3.75, "cache_read": 0.30 },
  "claude-haiku-4-5":  { "input":  0.8, "output":  4.0, "cache_write":  1.00, "cache_read": 0.08 }
}
```

### 6.3 Loader

```ts
// src/pricing/loader.ts (illustrative)
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pricesOverridePath } from "../db/paths.js";

export interface ModelPrice {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}
export type PriceTable = Record<string, ModelPrice>;

export const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-5-20250929": "claude-opus-4-5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  "claude-opus-latest": "claude-opus-4-7",
};

export function canonicalModelId(raw: string): string {
  if (MODEL_ALIASES[raw]) return MODEL_ALIASES[raw];
  const m = /^(.+?)-(\d{8})$/.exec(raw);
  return m ? m[1] : raw;
}

let warnedUnknown = new Set<string>();

export function priceFor(table: PriceTable, model: string): ModelPrice | null {
  const canon = canonicalModelId(model);
  const p = table[canon];
  if (!p) {
    if (!warnedUnknown.has(canon)) warnedUnknown.add(canon);
    return null;
  }
  return p;
}

export async function loadPrices(): Promise<PriceTable> {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const bundled = JSON.parse(await readFile(join(HERE, "prices.json"), "utf8"));
  let override: PriceTable = {};
  try {
    override = JSON.parse(await readFile(pricesOverridePath(), "utf8"));
  } catch { /* no override file — fine */ }
  return deepMerge(bundled, override);
}

function deepMerge(a: PriceTable, b: PriceTable): PriceTable {
  const out: PriceTable = { ...a };
  for (const k of Object.keys(b)) out[k] = { ...a[k], ...b[k] };
  return out;
}
```

### 6.4 Cost formula

```ts
// src/pricing/cost.ts
import type { ModelPrice } from "./loader.js";

export interface TokenRow {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export function costUsd(row: TokenRow, p: ModelPrice | null): number {
  if (!p) return 0;
  return (
    (row.input_tokens / 1e6)                * p.input +
    (row.output_tokens / 1e6)               * p.output +
    (row.cache_creation_input_tokens / 1e6) * p.cache_write +
    (row.cache_read_input_tokens / 1e6)     * p.cache_read
  );
}
```

### 6.5 Snapshot

```ts
// src/pricing/snapshot.ts
export async function snapshotPrices(
  conn: DuckDBConnection,
  table: PriceTable,
  effectiveFrom: Date
): Promise<number> {
  let inserted = 0;
  for (const [model, p] of Object.entries(table)) {
    const result = await conn.run(
      `INSERT INTO prices (model, effective_from, input_per_mtok_usd, output_per_mtok_usd,
                            cache_write_per_mtok_usd, cache_read_per_mtok_usd)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (model, effective_from) DO NOTHING`,
      [model, effectiveFrom, p.input, p.output, p.cache_write, p.cache_read]
    );
    inserted += result.rowsChanged;
  }
  return inserted;
}
```

### 6.6 Architectural decision

Cost is **computed at query time** in reports. The `prices` table is for historical audit only.

### 6.7 Acceptance criteria

- `costUsd({input:1_000_000, output:0, cache_creation_input_tokens:0, cache_read_input_tokens:0}, opusPrices)` returns `15.00` exactly.
- Unknown model id logs warning once per canonical id and returns 0 cost.
- After ingest, `SELECT count(*) FROM prices WHERE effective_from = today()` ≥ number of bundled models.

---

## 7. Step 6 — Reports

### 7.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/report.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/today.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/session.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/hourly.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/top.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/cost.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/queries.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/render.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/reports/format.ts`

### 7.2 Render helpers

```ts
// src/reports/render.ts (illustrative)
import Table from "cli-table3";

export function renderTable(headers: string[], rows: (string | number)[][]): string {
  const t = new Table({ head: headers, style: { head: [], border: [] } });
  for (const r of rows) t.push(r as any);
  return t.toString();
}

const SPARK = "▁▂▃▄▅▆▇█";
export function renderSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return SPARK[3].repeat(values.length);
  return values.map((v) => SPARK[Math.round(((v - min) / (max - min)) * 7)]).join("");
}

export function formatCurrency(n: number, currency: "usd" | "eur"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

export function formatTokens(n: number | bigint): string {
  const num = typeof n === "bigint" ? Number(n) : n;
  return new Intl.NumberFormat(undefined).format(num);
}
```

**Windows console caveat.** The Unicode block characters `▁▂▃▄▅▆▇█` render correctly in Windows Terminal, modern PowerShell (7+), and Claude Code's chat. They may render as `?` in legacy `cmd.exe` with the default OEM codepage. Set `chcp 65001` (UTF-8) for cmd.exe, or document that users on `cmd.exe` should use Windows Terminal. The slash command surface (which renders inline in Claude Code's chat) is unaffected.

### 7.3 SQL queries (final form)

#### `report <N>`

```sql
SELECT ts::DATE                          AS day,
       SUM(input_tokens)                 AS input,
       SUM(output_tokens)                AS output,
       SUM(cache_creation_input_tokens)  AS cache_write,
       SUM(cache_read_input_tokens)      AS cache_read,
       SUM(input_tokens + output_tokens) AS total,
       model
FROM messages
WHERE ts >= today() - INTERVAL ($1) DAY
GROUP BY day, model
ORDER BY day, model;
```

#### `today`

```sql
SELECT model,
       SUM(input_tokens)                 AS input,
       SUM(output_tokens)                AS output,
       SUM(cache_creation_input_tokens)  AS cache_write,
       SUM(cache_read_input_tokens)      AS cache_read,
       COUNT(*)                          AS turns
FROM messages
WHERE ts >= ?
  AND ts <  ?
GROUP BY model
ORDER BY (input + output) DESC;
```

#### `session [id]`

```sql
SELECT ts, model,
       input_tokens, output_tokens,
       cache_creation_input_tokens, cache_read_input_tokens
FROM messages
WHERE session_id = ?
ORDER BY ts;
```

`?` defaults to `process.env.CLAUDE_SESSION_ID` (works on Windows — `process.env` is the same API). Error out (exit 2) if unset and no arg.

#### `hourly`

```sql
SELECT date_trunc('hour', ts)             AS hour,
       SUM(input_tokens + output_tokens)  AS total
FROM messages
WHERE ts >= now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour;
```

#### `top --by=<col> --n=<N>`

```ts
const TOP_BY = { session: "session_id", project: "project_cwd", model: "model" } as const;
type TopBy = keyof typeof TOP_BY;
```

```sql
SELECT {{col}}                            AS bucket,
       SUM(input_tokens + output_tokens)  AS total_tokens,
       COUNT(*)                           AS turns,
       MAX(ts)                            AS last_seen
FROM messages
WHERE {{col}} IS NOT NULL
GROUP BY bucket
ORDER BY total_tokens DESC
LIMIT ?;
```

#### `cost <YYYY-MM>`

```sql
SELECT model,
       SUM(input_tokens)                 AS input,
       SUM(output_tokens)                AS output,
       SUM(cache_creation_input_tokens)  AS cache_write,
       SUM(cache_read_input_tokens)      AS cache_read,
       COUNT(*)                          AS turns
FROM messages
WHERE ts >= make_date(?, ?, 1)
  AND ts <  make_date(?, ?, 1) + INTERVAL 1 MONTH
GROUP BY model
ORDER BY (input + output) DESC;
```

### 7.4 JSON output mode (`--json`)

Every report exposes `renderXxxReport()` for human path and `collectXxxReport()` for the JSON path. The CLI driver picks based on `--json`.

### 7.5 Acceptance criteria

- `claude-tokenstein report 7` renders a 7-row table with a 7-character sparkline.
- `claude-tokenstein top --by=DROP --n=3` rejects with exit code 2.
- `claude-tokenstein cost 2026-04 --currency=eur` renders both USD and EUR columns and shows the FX footer.
- `claude-tokenstein --json today` emits valid JSON parseable by `JSON.parse`.
- Under `tr-TR` locale on Windows, `formatCurrency(15, "usd")` produces `15,00 $` (or equivalent locale-correct rendering).

---

## 8. Step 7 — SessionStart hook + lockfile (Windows-primary)

### 8.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/hooks/session-start.ps1` — **primary, Windows**
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/hooks/session-start.cmd` — cmd.exe shim that calls the .ps1
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/hooks/session-start.sh` — POSIX dev fallback (macOS/Linux)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/lock.ts`

### 8.2 Hook script — PowerShell (primary)

```powershell
# hooks/session-start.ps1
# Fire-and-forget detached ingest. Returns immediately.
$ErrorActionPreference = "SilentlyContinue"
$root = Join-Path $env:USERPROFILE ".claude-tokenstein"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "ingest.log"

# Start-Process with -WindowStyle Hidden detaches and returns instantly.
# claude-tokenstein.cmd is on PATH because npm install put it in node_modules\.bin
# OR the plugin install put it on the user's PATH.
Start-Process -FilePath "claude-tokenstein.cmd" `
              -ArgumentList "ingest", "--since-last", "--with-lock" `
              -WindowStyle Hidden `
              -RedirectStandardOutput $log `
              -RedirectStandardError $log
exit 0
```

### 8.3 Hook script — cmd.exe shim

Some plugin loaders may invoke `.cmd` files via `cmd.exe /c` rather than PowerShell. Provide a thin shim:

```bat
@echo off
REM hooks/session-start.cmd
REM Forwards to the PowerShell script. PowerShell 5.1 is in-box on Windows 10+.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0session-start.ps1"
exit /b 0
```

`%~dp0` resolves to the directory containing the .cmd file, so the script finds its sibling `.ps1` regardless of working directory.

`-ExecutionPolicy Bypass` is needed because users may have `Restricted` policy on their machine — Bypass affects only this invocation, not the user's global setting.

### 8.4 Hook script — POSIX fallback

```sh
#!/bin/sh
# hooks/session-start.sh
# macOS/Linux developer machines only.
set -eu
LOG="$HOME/.claude-tokenstein/logs/ingest.log"
mkdir -p "$(dirname "$LOG")"
( claude-tokenstein ingest --since-last --with-lock >>"$LOG" 2>&1 ) &
exit 0
```

Note: PRD §5's `flock`-based variant is dropped because (a) it doesn't apply to Windows, (b) the JS lockfile path works uniformly on every OS, (c) one code path is easier to maintain than two.

Mark the .sh executable for POSIX devs: `git update-index --chmod=+x hooks/session-start.sh`.

### 8.5 Which hook does the plugin manifest reference?

Open question — depends on how Claude Code resolves hooks on Windows. Three plausible behaviors:

1. **Plugin loader exec's the path directly.** Set `hooks.sessionStart` to `hooks/session-start.cmd` on Windows. Document a Linux/macOS variant (`session-start.sh`).
2. **Plugin loader runs through a shell.** Then `.cmd` works on Windows (cmd.exe is the default), `.sh` works on POSIX.
3. **Plugin loader supports a manifest that conditions on platform.** Best case — declare both:

```json
"hooks": {
  "sessionStart": {
    "windows": "hooks/session-start.cmd",
    "posix":   "hooks/session-start.sh"
  }
}
```

**Implementer must verify Claude Code's actual hook-resolution logic against current docs.** If only one entry is supported, prefer the Windows path and document a one-line `chmod +x` install step for POSIX users.

### 8.6 Lock module (uniform across platforms)

```ts
// src/ingest/lock.ts (illustrative)
import lockfile from "proper-lockfile";
import { lockPath } from "../db/paths.js";
import { LockBusyError } from "../errors.js";

export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(lockPath(), {
      realpath: false,
      stale: 60_000,
      retries: 0,
    });
  } catch (e: any) {
    if (e?.code === "ELOCKED") throw new LockBusyError("ingest already running");
    throw e;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}
```

`proper-lockfile` writes a directory (`<lockPath>.lock/`) atomically using `mkdir`, which is atomic on NTFS, ext4, and APFS alike. Stale detection uses mtime + a 60 s threshold — handles the case where a Windows reboot orphans the lock.

### 8.7 Architectural decision

JS lockfile uniformly across platforms. PowerShell hook on Windows because `cmd.exe`'s `start` command does not detach reliably; PowerShell's `Start-Process -WindowStyle Hidden` is the idiomatic detach. The `.cmd` shim exists only to keep the entry point uniform if the plugin loader prefers `.cmd`.

### 8.8 Performance check

Hook must return < 50 ms per PRD §11. Measurements on Windows 11:

- `powershell.exe -NoProfile` cold start: ~200–400 ms (cold). Already exceeds 50 ms.
- **Mitigation:** the hook's heavy lifting (the actual ingest) runs in a separate detached process; the hook itself returns as soon as `Start-Process` queues the new process. The 50 ms target applies to **the user-perceived blocking**; if Claude Code awaits the hook process exit, PowerShell startup time is the bottleneck.
- **Alternative:** if the plugin loader supports an "async hook" mode where the hook returns immediately and the loader does not await, the PowerShell startup is invisible. **Verify against Claude Code docs.**
- If sync-only and 50 ms is hard, switch the Windows hook to a tiny native binary or a `.bat` that uses `start /b` to detach without invoking PowerShell. Trade off: `start /b` does not redirect output as cleanly. Since the ingest writes its own log, output redirection is not strictly required:

```bat
@echo off
REM Lightweight detach without PowerShell.
start "" /b "claude-tokenstein.cmd" ingest --since-last --with-lock >nul 2>&1
exit /b 0
```

This `.cmd`-only path returns in < 30 ms on Windows 11. Recommend this as the **production** hook and keep the PowerShell variant for output-debugging.

### 8.9 Acceptance criteria

- Hook returns within 50 ms on Windows 11 (`Measure-Command { .\hooks\session-start.cmd }`).
- Two concurrent invocations result in exactly one ingest run; the second exits 0 silently.
- Hook script is invoked correctly by Claude Code on Windows (verify by tailing `ingest.log` after a fresh session start).
- On macOS/Linux dev machines, `hooks/session-start.sh` is mode 0755 and produces equivalent behavior.

---

## 9. Step 8 — FX module

### 9.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/fx.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/fx-cache.ts`

### 9.2 API

```ts
// src/pricing/fx.ts (illustrative)
import { fetch } from "undici";
import { FxUnavailableError } from "../errors.js";

export interface FxRate {
  rate: number;
  source: "manual" | "frankfurter" | "fallback";
  asOf: Date;
}

export async function getRate(
  conn: DuckDBConnection,
  date: Date,
  cfg: { override: number | null }
): Promise<FxRate> {
  if (cfg.override !== null) {
    return { rate: cfg.override, source: "manual", asOf: date };
  }
  const cached = await readRate(conn, date);
  if (cached) return cached;
  try {
    const fetched = await fetchFromFrankfurter(date);
    await cacheRate(conn, fetched);
    return fetched;
  } catch {
    const last = await readMostRecentRate(conn);
    if (last) return { ...last, source: "fallback" };
    throw new FxUnavailableError("no FX rate available offline");
  }
}

async function fetchFromFrankfurter(date: Date): Promise<FxRate> {
  const url = `https://api.frankfurter.app/${iso(date)}?from=USD&to=EUR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const body = await res.json() as { date: string; rates: { EUR: number } };
  return { rate: body.rates.EUR, source: "frankfurter", asOf: new Date(body.date) };
}
```

**Windows note on TLS.** `undici.fetch` uses Node's built-in TLS, which on Windows ships its own bundled CA list (Mozilla). It does **not** consult the Windows certificate store, so corporate-MITM proxies that inject custom roots into the Windows store will fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Document the workaround: `set NODE_EXTRA_CA_CERTS=path\to\corporate-root.crt` (or set the env var globally). The FX failure falls through to `fallback` → `FxUnavailableError`, which the report handles gracefully.

### 9.3 Cache

```ts
// src/pricing/fx-cache.ts
export async function readRate(conn: DuckDBConnection, date: Date): Promise<FxRate | null> { /* ... */ }
export async function readMostRecentRate(conn: DuckDBConnection): Promise<FxRate | null> { /* ... */ }
export async function cacheRate(conn: DuckDBConnection, fx: FxRate): Promise<void> { /* ... */ }
```

### 9.4 Risks

Frankfurter weekend/holiday gap: API returns last business-day rate keyed under that returned date. Store under API-returned date. Fallback path picks it up on Monday.

### 9.5 Acceptance criteria

- With `fx_override_usd_eur=0.92` set, `getRate` returns `{rate: 0.92, source: 'manual'}` without network.
- Disconnected network with no cached row → throws `FxUnavailableError`; report renders USD only with footer note.
- Disconnected network with one cached row → returns that row with `source: 'fallback'`.
- On a Windows machine behind a corporate-MITM proxy without `NODE_EXTRA_CA_CERTS`, FX fetch fails gracefully and the report falls back to USD-only with a clear footer.

---

## 10. Step 9 — Admin API ingest

### 10.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/admin-api.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/admin-api-client.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/admin-api-types.ts`

### 10.2 Algorithm (PRD §5)

1. Read `config.admin_api_key`. Missing → log warning, return zero-stats.
2. `startingAt = ingest_state.last_ingested_ts(source='admin_api') ?? now() - lookbackDays`.
3. Loop: paginated GET to `/v1/organizations/usage_report/messages` with `bucket_width=1h`, `group_by=model,workspace_id`.
   - Headers: `x-api-key`, `anthropic-version: 2023-06-01`.
   - Retry with exponential backoff on 429/5xx, max 5 attempts.
4. Synthesize `messages` rows with `source='admin_api'`, `session_id=NULL`, `project_cwd=NULL`.
5. Persist `ingest_state.cursor` after each page; `last_ingested_ts = bucket_end` once drained.
6. Stop when `has_more: false` or `bucket_end > now() - 5min`.

### 10.3 Client

```ts
// src/ingest/admin-api-client.ts (illustrative)
import { fetch } from "undici";

export async function* paginate(
  startingAt: string,
  apiKey: string
): AsyncIterable<UsageBucket> {
  let page: string | undefined;
  while (true) {
    const url = new URL("https://api.anthropic.com/v1/organizations/usage_report/messages");
    url.searchParams.set("starting_at", startingAt);
    url.searchParams.set("bucket_width", "1h");
    url.searchParams.set("group_by", "model,workspace_id");
    url.searchParams.set("limit", "100");
    if (page) url.searchParams.set("page", page);

    const res = await retryingFetch(url.toString(), apiKey);
    const body = (await res.json()) as UsagePage;
    for (const b of body.data) yield b;
    if (!body.has_more || !body.next_page) return;
    page = body.next_page;
  }
}
```

Same TLS/CA caveat as §9.2 — corporate proxies need `NODE_EXTRA_CA_CERTS`.

### 10.4 Synthetic message rows

Built via `messageId({sessionId: 'admin_api', isoTs: bucket.starting_at, requestId: <model>|<workspace_id>})` for cross-source uniqueness.

### 10.5 Risks

- Field name divergence between Admin API and JSONL — explicit map in client.
- 5-minute API latency window — never request `ending_at > now() - 5min`.
- Lookback cap (`max_admin_api_lookback_days`) — guards against unbounded backfill.

### 10.6 Acceptance criteria

- With `admin_api_key=null` ingest exits 0 with one warning logged.
- Mock fixtures pass; pagination cursor advances; idempotent on rerun.
- 429 response triggers exactly one retry with delay ≥ 250 ms.

---

## 11. Step 10 — MCP server + plugin manifest

### 11.1 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/plugin.json`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/.mcp.json` (after dev `.mcp.json` is moved per §0.1)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/mcp/server.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/commands/tokenstein-report.md` (and 6 siblings)

### 11.2 `plugin.json` (illustrative)

```json
{
  "name": "claude-tokenstein",
  "version": "0.1.0",
  "description": "Track and report Claude token usage",
  "commands": [
    "commands/tokenstein-report.md",
    "commands/tokenstein-today.md",
    "commands/tokenstein-session.md",
    "commands/tokenstein-hourly.md",
    "commands/tokenstein-top.md",
    "commands/tokenstein-cost.md",
    "commands/tokenstein-ingest.md"
  ],
  "hooks": {
    "sessionStart": {
      "windows": "hooks/session-start.cmd",
      "posix":   "hooks/session-start.sh"
    }
  },
  "mcpServers": {
    "claude-tokenstein": {
      "command": "node",
      "args": ["./bin/claude-tokenstein.mjs", "mcp"]
    }
  }
}
```

If Claude Code's manifest schema does not support per-platform hooks, fall back to a single entry pointing at `hooks/session-start.cmd` and document the POSIX `chmod +x` install step.

### 11.3 MCP server

PRD §2 says no programmatic MCP query tools in v1 — the server is the host process for slash commands.

```ts
// src/mcp/server.ts (illustrative)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "claude-tokenstein", version: "0.1.0" },
  { capabilities: {} }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 11.4 Slash command stubs

```markdown
---
name: tokenstein-today
description: Today's Claude token totals + per-model split
---
!claude-tokenstein today $ARGUMENTS
```

The `!` prefix shells out via Claude Code's slash-command runner. On Windows, Claude Code resolves `claude-tokenstein` via PATH which finds the `npm`-generated `.cmd` shim. Implementer must verify the exact frontmatter format against current Claude Code docs.

### 11.5 Acceptance criteria

- `claude` CLI installs the plugin from a local path on Windows and lists all seven slash commands.
- Triggering `/tokenstein today` in a fresh session prints the same output as `claude-tokenstein today` from PowerShell.
- SessionStart hook fires on session start (verify by tailing `%USERPROFILE%\.claude-tokenstein\logs\ingest.log`).
- The MCP server starts and accepts an `initialize` request.

---

## 12. Step 11 — Whitespace normalization

### 12.1 File to update

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/normalize/text.ts` — replace step 3's passthrough with the real implementation.

### 12.2 Algorithm (PRD §7)

1. Split on `\n` into lines.
2. Toggle `inFence` on lines whose `trim()` starts with ` ``` `. Lines while `inFence === true` pass through verbatim.
3. For lines outside fences: `line.replace(/[ \t]+/g, ' ').trim()`.
4. Collapse runs of ≥2 consecutive empty lines outside fences into one blank line.
5. Trim leading/trailing whitespace of the whole.

```ts
// src/normalize/text.ts
export function normalizePromptText(input: string): string {
  // CRLF tolerance: trim trailing \r before fence detection.
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let blankRun = 0;
  for (const line of lines) {
    const trimmedForFence = line.trim();
    const isFence = /^```/.test(trimmedForFence);
    if (isFence) {
      inFence = !inFence;
      out.push(line);
      blankRun = 0;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const collapsed = line.replace(/[ \t]+/g, " ").trim();
    if (collapsed === "") {
      blankRun++;
      if (blankRun <= 1) out.push("");
    } else {
      blankRun = 0;
      out.push(collapsed);
    }
  }
  return out.join("\n").trim();
}
```

### 12.3 Tricky bit: unbalanced fences

If EOF arrives with `inFence === true`, treat the trailing region as code (already handled — those lines were pushed verbatim). Document the choice in a header comment. Rationale: false-positive code preservation is reversible; falsely normalizing real code blocks corrupts whitespace-significant content (Python, YAML, makefiles).

### 12.4 Edge cases

- Tildes (`~~~`) as alternative fence markers: out of scope for v1.
- Indented fences (≥4 spaces) — Markdown spec says they aren't fences. Our regex matches anyway. Acceptable for v1.
- CRLF line endings normalized to LF before processing — Windows users frequently paste CRLF content.

### 12.5 Acceptance criteria

- Round-trip a fixture with mixed prose + a Python code block; assert the code block is byte-identical, prose is collapsed.
- Input with a single unmatched ` ``` ` near the end: assert no whitespace changes after the orphan fence.
- Three blank lines between paragraphs collapse to one.
- A CRLF-line-ended input produces the same normalized output as the LF equivalent.

---

## 13. Step 12 — Test plan

### 13.1 Layout

```
test/
  unit/
    normalize.test.ts
    cost.test.ts
    fx.test.ts
    prices-merge.test.ts
    ids.test.ts
    config.test.ts
    paths.test.ts
  integration/
    migrations.test.ts
    ingest-claude-code.test.ts
    ingest-admin-api.test.ts
    reports.test.ts
    fx-cache.test.ts
    lock.test.ts
  e2e/
    plugin-install.ps1          manual, Windows
    plugin-install.sh           manual, POSIX
  fixtures/
    jsonl/
      happy-3-turn.jsonl
      tool-result-between.jsonl
      truncated-last-line.jsonl
      no-usage-only.jsonl
      streamed-split.jsonl
      crlf-line-endings.jsonl   Windows-specific fixture
    admin-api/
      page-1.json
      page-2.json
    config/
      mode-600.json             POSIX-only test
      mode-644.json             POSIX-only test
```

### 13.2 Unit tests

`normalize.test.ts` — table-driven; CRLF and unbalanced fence cases.

`cost.test.ts` — per-formula component, mixed-rows, unknown-model returns 0.

`fx.test.ts` — getRate precedence; mock both `manual` and `fallback` paths.

`prices-merge.test.ts` — bundled + override precedence.

`ids.test.ts` — stability snapshot; null-`request_id` fallback; case-insensitive Windows path normalization (test runs on every OS but the assertion is conditional).

`config.test.ts` — schema validation; mode 644 rejection (POSIX-only via `process.platform` guard); missing file → defaults.

`paths.test.ts` — `dbPath()` returns a path under `os.homedir()`; `ensureRuntimeDir()` is idempotent.

### 13.3 Integration tests

Use real DuckDB against tmp dirs (`os.tmpdir()` + `mkdtemp` per test).

`migrations.test.ts` — runMigrations idempotent.

`ingest-claude-code.test.ts` — feed each fixture, assert exact row counts and field values; rerun and assert zero new rows. Special CRLF fixture verifies cross-OS parity.

`ingest-admin-api.test.ts` — `undici.MockAgent` returning the two `page-*.json` fixtures.

`reports.test.ts` — seeded DB, snapshot rendered table strings.

`fx-cache.test.ts` — `MockAgent` for frankfurter; assert cache reuse, fallback after offline.

`lock.test.ts` — concurrent `withLock` calls: second throws `LockBusyError`. Stale-lock recovery: orphan a lock with `stale: 50ms`, sleep 100ms, second call succeeds.

### 13.4 E2E (manual)

- `plugin-install.ps1` — installs plugin into a sandbox `%USERPROFILE%\.claude\` (env-var override `CLAUDE_HOME`), starts Claude Code, asserts hook execution and slash command output.
- `plugin-install.sh` — POSIX equivalent for dev machines.

### 13.5 Mock vs hit-real

| Surface | Strategy |
|---------|----------|
| Frankfurter API | `undici.MockAgent` |
| Admin API | `undici.MockAgent` |
| DuckDB | Real, file-based, tmp dir |
| Filesystem | Real, tmp dir |
| `~/.claude/projects/*` | Fixture dir, `HOME` overridden |

### 13.6 Coverage target

- `cost.ts`, `normalize/text.ts`, `ids.ts`, `fx.ts` ≥ 90% lines.
- Overall ≥ 75% lines.

### 13.7 CI matrix (Windows-primary)

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

**`windows-latest` is required-to-pass.** macOS and Linux are advisory but should pass — they help catch path-separator regressions.

### 13.8 Acceptance criteria

- `npm test` runs unit + integration in < 60 s on Windows (slower than macOS due to fs syscalls).
- Coverage reported; core modules ≥ 90% lines.
- CI green on all three OSes for a fresh PR.

---

## 14. Step 13 — Distribution

### 14.1 Steps

1. Tag release: `git tag v0.1.0 && git push --tags`.
2. `package.json` `"files"` whitelist already set in §2.3.
3. Optional `npm publish` (or install directly from a git URL).
4. README install section:
   - Prereq: Node ≥ 20.10, Claude Code (plugin-supporting version), Windows 10/11 (or macOS 13+/Linux x64).
   - Install: `claude plugin install gunesbizim/claude-tokenstein`.
   - First-run config (Windows PowerShell):
     ```powershell
     New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude-tokenstein" | Out-Null
     notepad "$env:USERPROFILE\.claude-tokenstein\config.json"
     ```
   - First-run config (POSIX):
     ```sh
     mkdir -p ~/.claude-tokenstein && chmod 700 ~/.claude-tokenstein
     $EDITOR ~/.claude-tokenstein/config.json
     ```
   - Verify: `/tokenstein ingest` then `/tokenstein today`.
5. CHANGELOG seeded with v0.1.0 entry.

### 14.2 Files to create

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/README.md`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/CHANGELOG.md`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/LICENSE` (MIT recommended)

### 14.3 README skeleton

Sections:

1. What it does — one paragraph.
2. Install — Windows-first, then POSIX.
3. Configuration — sample `config.json`. **NTFS ACL note** for Windows: keep the file inside `%USERPROFILE%\.claude-tokenstein\` so it inherits user-only permissions; do not move it to `C:\ProgramData\`.
4. Slash command reference — table mirroring PRD §6.
5. Pricing override — example `~/.claude-tokenstein/prices.json`.
6. Troubleshooting — log path, common errors:
   - "DuckDB locked" → another ingest is running; check the lockfile.
   - "TLS UNABLE_TO_GET_ISSUER_CERT_LOCALLY" on Windows → set `NODE_EXTRA_CA_CERTS`.
   - "block characters render as `?` in cmd.exe" → use Windows Terminal or `chcp 65001`.
   - "Hook does not run on Windows" → verify `node_modules\.bin\claude-tokenstein.cmd` is on PATH; check Execution Policy if PowerShell variant used.
7. Uninstall — Windows: `Remove-Item -Recurse -Force "$env:USERPROFILE\.claude-tokenstein"`. POSIX: `rm -rf ~/.claude-tokenstein`.

### 14.4 Acceptance criteria

- Fresh clone + `npm install` + `claude plugin install ./` + new Claude Code session **on Windows** → SessionStart hook spawns ingest within 50 ms; `/tokenstein today` returns rows for the day's usage.
- `npm pack` produces a tarball containing `hooks/session-start.cmd`, `hooks/session-start.ps1`, `hooks/session-start.sh`.
- README "Install" section followed verbatim by a fresh Windows user yields working state.

---

## 15. Build-order dependency notes

- Step 11 (normalization) is consumed by step 3 (ingest writes `prompts.text`). Step 3 ships a passthrough stub; step 11 swaps in the real implementation. Single retroactive touchpoint.
- Step 5 (pricing) is consumed by step 6 (reports compute cost).
- Step 8 (FX) is consumed by step 6's `cost` and any `--currency=eur` invocation. Step 6 should call FX through a typed interface so reports can be unit-tested with a fake FX provider before step 8 lands.
- Step 9 (Admin API) writes to the same `messages` table as step 3. Both must use the same `messageId()` helper.
- Step 10 (manifest) requires the existing dev-environment `.mcp.json` to be moved before the plugin manifest is dropped.
- Step 7 (hook + lockfile) depends on the CLI binary existing (step 4). The Windows hook needs `claude-tokenstein.cmd` resolvable on PATH — which `npm install` provides via `node_modules\.bin\` linking.

---

## 16. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | Deterministic-id collision on null `request_id` | Medium | Silent data loss | §1.3 fallback: append file path + line offset + text hash |
| R2 | Model-id mismatch with bundled prices | High | Cost = 0 for real rows | §1.6 alias map + `debug list-models` subcommand |
| R3 | DuckDB single-writer collision during ingest + report | Medium | Slash command errors | Reader connections always READ_ONLY |
| R4 | Truncated last JSONL line during active session | High | Skipped rows | Don't advance `line_count` past failing line |
| R5 | `tool_result` mistaken for human prompt | High | Wrong `user_prompt_id` | Walk parentUuid chain, skip `tool_result` blocks |
| R6 | Frankfurter API down during EUR-mode report | Medium | Report fails | Fallback to last cached, label `[stale fx]` |
| R7 | Admin API rate-limiting | Low | Ingest stalls | Exponential backoff, max 5 attempts |
| R8 | **PowerShell hook startup > 50 ms** | High | Hook misses perf target | §8.8 use `.cmd`-only `start /b` variant in production |
| R9 | BigInt → Number precision loss | Low | Wrong sums above 2^53 tokens | Keep BigInt end-to-end; convert only at render |
| R10 | Concurrent ingest from two Claude sessions | Medium | Wasted work | Lockfile, 2nd exits 0 silently |
| R11 | Plugin loader API change | Low | Install breakage | Document tested Claude Code version range |
| R12 | Admin API field rename | Low | Wrong cost data | Explicit field map in client; integration test fixture |
| R13 | DuckDB upgrade breaking schema | Low | Migration failure | Pin `@duckdb/node-api` minor; test migration runner |
| R14 | Empty `~/.claude/projects/` (fresh user) | High | Ingest finds nothing | Walker yields zero, ingest reports `filesScanned=0`, exit 0 |
| R15 | `CLAUDE_SESSION_ID` env var not set | Medium | `session` command errors | Exit 2 with clear message naming the env var |
| R16 | **Windows AV scanning slows ingest** | Medium | Slow ingest, possible EBUSY | README troubleshooting: exclude `~/.claude-tokenstein/` from real-time scanning |
| R17 | **Corporate-MITM proxy breaks TLS on Windows** | Medium | FX/admin API fail | Document `NODE_EXTRA_CA_CERTS`; FX falls back gracefully |
| R18 | **Unicode block chars render as `?` in cmd.exe** | Medium | Sparkline broken | Document Windows Terminal recommendation; degrade gracefully |
| R19 | **Claude Code hook resolution differs across OS** | High | Hook never fires on Windows | §8.5 ship `.cmd` + `.ps1` + `.sh`; verify per-platform manifest support |
| R20 | **PowerShell ExecutionPolicy=Restricted** | Medium | `.ps1` blocked | `.cmd` shim uses `-ExecutionPolicy Bypass` |
| R21 | **Long Windows paths (>260 chars)** | Low | DB or JSONL access fails | Log warning if path > 240 chars; document `LongPathsEnabled` registry tweak |
| R22 | **CRLF in JSONL fixtures** | Medium | Parse mismatch | `normalizePromptText` strips CRLF; integration test on CRLF fixture |
| R23 | **NTFS file lock from antivirus during JSONL read** | Medium | EBUSY | One-retry with 50 ms delay on EBUSY/EPERM in walker |

---

## 17. Glossary

| Term | Definition |
|------|------------|
| JSONL | JSON Lines — one JSON object per line, used by Claude Code transcripts |
| Admin API | Anthropic's `/v1/organizations/usage_report/messages` endpoint, requires `sk-ant-admin-…` |
| `parentUuid` | Per-line field in Claude Code transcripts linking a turn to its parent |
| `tool_result` | A message block emitted as the synthetic "user" follow-up after a tool call; not a human prompt |
| Idempotent insert | Re-running the same insert produces no new rows (via `ON CONFLICT DO NOTHING`) |
| Sparkline | One-line ASCII bar chart using Unicode block characters `▁▂▃▄▅▆▇█` |
| Lockfile | A file/directory whose existence indicates a single writer has the resource; `proper-lockfile` handles cross-platform semantics |
| `proper-lockfile` | npm package implementing atomic mkdir-based locking on every OS |
| `frankfurter.app` | Free, no-auth ECB-backed FX rate API |
| Cache (write/read) | Anthropic prompt cache: `cache_creation` is the write that populates the cache; `cache_read` is the discounted re-read |
| Cache ephemeral 5m / 1h | Sub-categories of cache writes with different TTLs and pricing |
| `%USERPROFILE%` | Windows environment variable equivalent to POSIX `~` (typically `C:\Users\<user>`) |
| NTFS | Windows default filesystem; case-insensitive, case-preserving; supports ACLs not POSIX modes |
| Windows Terminal | Modern terminal app on Windows; renders Unicode correctly. Distinct from legacy `cmd.exe` window |
| Execution Policy | PowerShell's script-execution gate; `Restricted` blocks unsigned scripts; `Bypass` disables for one invocation |
| `Start-Process -WindowStyle Hidden` | PowerShell idiom for detached background process launch |

---

## 18. Appendix A — Windows quick-reference

### Common paths

| Purpose | Path |
|---------|------|
| User home | `C:\Users\<user>` (`$env:USERPROFILE`) |
| Tokenstein root | `C:\Users\<user>\.claude-tokenstein\` |
| DB file | `C:\Users\<user>\.claude-tokenstein\tokens.duckdb` |
| Config | `C:\Users\<user>\.claude-tokenstein\config.json` |
| Log | `C:\Users\<user>\.claude-tokenstein\logs\ingest.log` |
| Lock | `C:\Users\<user>\.claude-tokenstein\ingest.lock` |
| Claude Code transcripts | `C:\Users\<user>\.claude\projects\<encoded-cwd>\<session>.jsonl` |
| Plugin install (typical) | `C:\Users\<user>\.claude\plugins\claude-tokenstein\` |
| CLI shim | `<install>\node_modules\.bin\claude-tokenstein.cmd` |

### Common PowerShell snippets

```powershell
# Tail the log live
Get-Content "$env:USERPROFILE\.claude-tokenstein\logs\ingest.log" -Wait -Tail 50

# Trigger an ingest manually
claude-tokenstein ingest

# Inspect today's report from terminal
claude-tokenstein today

# Rotate the lockfile if orphaned
Remove-Item "$env:USERPROFILE\.claude-tokenstein\ingest.lock" -Recurse -Force

# Check Claude Code session id
$env:CLAUDE_SESSION_ID

# Set CA bundle for corporate MITM
[Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", "C:\path\to\corp-root.crt", "User")
```

### Common cmd.exe snippets

```bat
REM Tail the log (no native tail; use PowerShell or write a loop)
powershell -Command "Get-Content '%USERPROFILE%\.claude-tokenstein\logs\ingest.log' -Wait -Tail 50"

REM Set UTF-8 codepage so block characters render
chcp 65001
claude-tokenstein report 7
```

---

## 19. Appendix B — Cross-platform compatibility matrix

| Concern | Windows 10/11 | macOS 13+ | Linux |
|---------|---------------|-----------|-------|
| Hook script | `.cmd` (preferred) or `.ps1` | `.sh` | `.sh` |
| Lock mechanism | `proper-lockfile` (mkdir on NTFS) | `proper-lockfile` | `proper-lockfile` |
| Path separator | `\` (handled by `node:path`) | `/` | `/` |
| Home directory | `os.homedir()` → `C:\Users\<user>` | `~` | `~` |
| Config permissions | NTFS ACL inheritance from `%USERPROFILE%` | mode 600 enforced | mode 600 enforced |
| Line endings | CRLF for `.cmd`/`.ps1`, LF elsewhere | LF | LF |
| Default terminal | Windows Terminal recommended; cmd.exe needs `chcp 65001` | Terminal.app | Any |
| Sparkline glyphs | Render in Windows Terminal & Claude Code chat; broken in default cmd.exe | Render | Render |
| TLS root store | Bundled CAs (Mozilla) — **not** Windows store; corporate MITM needs `NODE_EXTRA_CA_CERTS` | OS keychain | System CA bundle |
| AV interference | Possible (Defender, third-party); document exclusion | Rare | None |
| `flock` availability | Absent | Absent (use Homebrew) | Present |
| DuckDB binary | Prebuilt x64 | Prebuilt arm64+x64 | Prebuilt x64 |

---

## Critical files for implementation

Top-priority files the implementer should focus on first; everything else hangs off these.

- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/duckdb.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/schema.sql` (and `migrations/001_init.sql`)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/db/ids.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/claude-code.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/ingest/jsonl-parser.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/cli.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/loader.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/pricing/cost.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/src/normalize/text.ts`
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/hooks/session-start.cmd` (Windows primary)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/hooks/session-start.ps1` (Windows alternative)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/hooks/session-start.sh` (POSIX dev)
- `/Users/gunesbizim/Desktop/projects/claude-tokenstein/plugin.json`
