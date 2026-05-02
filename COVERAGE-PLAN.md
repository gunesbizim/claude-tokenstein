# Test Coverage Plan — Target 90% Total

> **Goal:** Lift overall test coverage from 78.5% statements / 54.6% branches / 70% functions / 81.2% lines to 90%+ across all four metrics.
>
> **Approach:** Seven-phase incremental plan with concrete test skeletons. Each phase builds on the previous, with measurable coverage checkpoints. Total estimated effort: 7 new test files, 2 modified test files, 1 small source refactor, ~140 new test cases.

---

## Table of Contents

1. [Baseline Coverage Analysis](#baseline-coverage-analysis)
2. [Strategy & Constraints](#strategy--constraints)
3. [File-by-File Gap Analysis](#file-by-file-gap-analysis)
4. [Phase 1 — Pure-Function Unit Tests](#phase-1--pure-function-unit-tests)
5. [Phase 2 — `queries.ts` Integration Tests](#phase-2--queriests-integration-tests)
6. [Phase 3 — Render Command Tests](#phase-3--render-command-tests)
7. [Phase 4 — `pricing/loader.ts` Tests](#phase-4--pricingloaderts-tests)
8. [Phase 5 — `config.ts` Error Paths](#phase-5--configts-error-paths)
9. [Phase 6 — `html-queries.ts` Branch Coverage](#phase-6--html-queriests-branch-coverage)
10. [Phase 7 — Remaining Small Gaps](#phase-7--remaining-small-gaps)
11. [Per-Phase Coverage Estimates](#per-phase-coverage-estimates)
12. [Test Patterns & Conventions](#test-patterns--conventions)
13. [Refactor Required](#refactor-required)
14. [Risks & Open Questions](#risks--open-questions)
15. [Implementation Checklist](#implementation-checklist)
16. [Out of Scope](#out-of-scope)

---

## Baseline Coverage Analysis

### Numerical baseline (from `npm run coverage` on 2026-05-02)

| Metric | Covered | Total | Percentage | Target (90%) | Gap |
|---|---|---|---|---|---|
| Statements | 354 | 451 | 78.49% | 406 | **+52** |
| Branches | 195 | 357 | 54.62% | 321 | **+126** |
| Functions | 77 | 110 | 70.00% | 99 | **+22** |
| Lines | 320 | 394 | 81.21% | 355 | **+35** |

### Why branches is the binding constraint

The branch gap (+126) dwarfs the statement gap (+52). Every conditional, ternary, optional chain, default value, and short-circuit `??` / `||` expression generates branches that v8 tracks separately from raw statement coverage. A single test that hits the happy path of a function might cover 100% of statements while only hitting half of its branches.

This means the plan must **explicitly target** else-branches, error paths, edge values (0, empty, null, missing), and platform-specific code. A "happy path only" suite will plateau around 75–80% branches even with 95% statements.

### Coverage report breakdown by directory

```
All files          |   78.49 |    54.62 |      70 |   81.21
 src               |   33.33 |       25 |     100 |   31.25  ← errors.ts (0%) drags this
  config.ts        |   42.85 |       25 |     100 |   41.66
  errors.ts        |       0 |      100 |     100 |       0
 src/db            |   75.55 |       80 |      50 |   78.04
  ids.ts           |     100 |    88.88 |     100 |     100
  migrate.ts       |      84 |    66.66 |     100 |   90.47
  paths.ts         |   22.22 |      100 |    12.5 |   22.22  ← lots of unused getters
 src/ingest        |   86.39 |    69.49 |     100 |   87.78
  claude-code.ts   |   86.55 |       68 |     100 |   87.27
  jsonl-parser.ts  |   85.71 |    77.77 |     100 |   90.47
 src/pricing       |      60 |    64.28 |   66.66 |   57.69
  loader.ts        |   53.84 |    58.33 |      50 |   52.17  ← loadPrices() untested
 src/reports       |   77.65 |    42.26 |   68.42 |   82.91
  alltime.ts       |   84.21 |       75 |   66.66 |   86.66
  format.ts        |   66.66 |       50 |   33.33 |   66.66  ← totalTokens, modelRowToTableRow
  html-data.ts     |      75 |    83.33 |   66.66 |   86.95
  html-queries.ts  |     100 |     52.5 |     100 |     100  ← all branches in date math
  html-template.ts |   96.96 |    91.66 |     100 |     100
  queries.ts       |   22.58 |    16.32 |      25 |   22.72  ← BIGGEST GAP
  render.ts        |   88.23 |       60 |   83.33 |   92.85
  ytd.ts           |   84.21 |    83.33 |   66.66 |   86.66
```

The **single largest gap** is `src/reports/queries.ts` at 22.58% statements. Five of its seven query functions (`queryReport`, `queryToday`, `querySession`, `queryHourly`, `queryTop`, `queryCost`) have effectively zero test coverage. Closing this single file gets us roughly halfway to the statement target.

---

## Strategy & Constraints

### Principles

1. **No mocking what's fast.** DuckDB starts in <50ms. Every integration test gets its own temp directory and fresh database. This matches the existing pattern in `test/integration/queries-ytd-alltime.test.ts` and avoids the false-confidence trap of mock-based tests.
2. **Mock only when necessary.** `process.env.HOME` and `Date.now` are the only things that need swapping. Module cache busting (`import("./mod.js?t=" + Date.now())`) is the existing pattern — reuse it.
3. **One test = one assertion topic.** Don't bundle 10 expectations into one test. v8 coverage doesn't care about test count, but readability and bisecting failure does.
4. **Cover error paths explicitly.** Every `throw` statement, every catch block, every `if (!x) return null` is a branch that needs hitting.
5. **Edge values matter.** `0`, `1`, `Number.MAX_SAFE_INTEGER`, empty strings, undefined, null, leap years, DST transitions, ISO week 53 — every one of these is a potential bug AND a branch.
6. **Reuse the `insertMessage` helper.** It's already proven in `test/integration/queries-ytd-alltime.test.ts`. Copy it into new test files (or extract to a shared `test/integration/helpers.ts` if duplication grows).

### Constraints

- **TypeScript `rootDir` is `src`.** Test files generate non-blocking warnings during `tsc --noEmit` (pre-existing). This won't change.
- **vitest 4.x.** Some APIs (e.g., `vi.useFakeTimers`) behave slightly differently than v3. Verify any time-mocking before relying on it.
- **No process spawning in tests.** Tests run in-process via vitest's pool, so anything that calls `child_process.exec`/`fork` or spawns a subprocess (like the `--open` flag in `cli.ts`) cannot be unit-tested cleanly. Test the function that decides what to do, not the side effect.
- **MCP server protocol tests are out of scope.** Would require a stdio harness; defer.

### Coverage tooling

- **Provider:** `@vitest/coverage-v8` (already installed)
- **Command:** `npm run coverage` → `vitest run --coverage`
- **Report:** Text summary printed to stdout. To inspect HTML drill-down, add `--coverage.reporter=html` and open `coverage/index.html`.
- **CI integration (future):** none yet. Consider adding `coverage` to the test step in CI once we hit 90% so it doesn't regress.

---

## File-by-File Gap Analysis

### `src/errors.ts` — 0% statements, 0% lines, 0/6 classes covered

**Uncovered lines:** 2–11 (all six error class bodies)

**Why uncovered:** The error classes are imported and instantiated in production code paths (`UserError` thrown in `session.ts`, `top.ts`, `cost.ts`; `ConfigError` in `config.ts`) but those throw paths are themselves uncovered. Once Phases 3 and 5 land, these will start being hit, but the simplest path is a direct unit test that just instantiates each class.

**Effort:** 5 minutes. 7 tests, all one-liners.

---

### `src/db/paths.ts` — 22.22% statements, 12.5% functions

**Uncovered lines:** 7, 9–20

**Why uncovered:** Only `dbPath()` and `pricesOverridePath()` are called by current tests (via `loadPrices` in production). The other path helpers (`configPath`, `lockPath`, `logPath`, `reportPath`, `runtimeRoot`) and `ensureRuntimeDir` are exported but unexercised in tests.

**What to test:** Each path helper returns a string ending with the expected suffix; `ensureRuntimeDir` creates the logs directory.

**Effort:** 10 minutes.

---

### `src/reports/queries.ts` — 22.58% statements, 16.32% branches

**Uncovered lines:** 36–125 (queryReport body, queryToday, querySession), 142–155 (queryHourly, queryTop), 232–245 (queryCost)

**Why uncovered:** The existing `test/integration/queries-ytd-alltime.test.ts` only exercises `queryYTD` and `queryAllTime`. Five other query functions have no tests.

**What to test:** Each function with at least one happy-path test, one empty-DB test, and grouping/filtering correctness. `queryTop` needs all three `by` dimensions exercised plus an invalid value. `queryCost` needs valid year/month and edge cases.

**Effort:** 60 minutes — biggest phase.

---

### `src/pricing/loader.ts` — 53.84% statements, 50% functions

**Uncovered lines:** 38–57 (`loadPrices`, `deepMerge`)

**Why uncovered:** Production code calls `loadPrices()` but tests pass an inline `PriceTable` object instead. The override merge logic (`deepMerge`) is exercised only in a separate `prices-merge.test.ts` against `priceFor`, not against `loadPrices` directly.

**What to test:** `loadPrices` with no override, with override, with malformed override, with override that overlaps existing keys.

**Effort:** 20 minutes.

---

### `src/config.ts` — 42.85% statements, 25% branches

**Uncovered lines:** 30–36 (POSIX permission check + throw), 39–43 (catch block error handling, schema parse failure)

**Why uncovered:** Existing tests cover defaults and happy-path parse but not the security checks or error paths.

**What to test:** World-readable file throws, malformed JSON throws, schema violation throws, ENOENT returns defaults.

**Effort:** 20 minutes.

---

### `src/reports/format.ts` — 66.66% statements, 33.33% functions

**Uncovered lines:** 28–37 (`totalTokens`, `modelRowToTableRow`)

**Why uncovered:** `computeRowCost` is exercised via the integration tests for ytd/alltime, but `totalTokens` and `modelRowToTableRow` aren't called explicitly anywhere with assertions.

**What to test:** `totalTokens` arithmetic, `modelRowToTableRow` array length and column order.

**Effort:** 15 minutes.

---

### `src/reports/render.ts` — 88.23% statements, 60% branches

**Uncovered lines:** 36 (`formatDate`)

**Why uncovered:** `formatDate` is exported but never called in production (likely vestigial or used elsewhere).

**What to test:** Direct call returns a non-empty locale-formatted date string.

**Effort:** 5 minutes.

---

### `src/reports/html-queries.ts` — 100% statements, 52.5% branches

**Uncovered branches:** 11, 61–125

**Why uncovered:** The branches in question are inside the date-math helpers (`weekStart`, `monthStart`, `quarterStart`). The `dow === 0 ? 6 : dow - 1` ternary, the `Math.floor((m) / 3) * 3` quarter math, etc. — these all have branches that aren't hit because the queries always run with `new Date()`, which is whatever time it happens to be when the tests run.

**What to test:** Each helper with explicit dates that exercise each branch path. Requires either:
- (a) Exporting helpers and unit-testing them with explicit `Date` arguments, or
- (b) Adding an optional `now: Date` parameter to the query functions and testing each Q boundary explicitly.

Option (a) is cleaner and lower-risk.

**Effort:** 30 minutes (small refactor + tests).

---

### `src/reports/html-data.ts` — 75% statements, 66.66% functions

**Uncovered lines:** 66–68

**Why uncovered:** The `priceFor` returns `null` branch (when a model isn't in the price table) isn't hit because all test inserts use models that are in `TEST_PRICES`.

**What to test:** Insert a row with an unknown model name, verify `totalCost` and `totalCacheReadCost` still compute (treating unknown as $0).

**Effort:** 5 minutes.

---

### `src/reports/html-template.ts` — 96.96% statements

**Uncovered lines:** 9 (a `fmtTokens` < 1000 branch), 354 (likely the very last `</html>` line concatenation or a fall-through)

**Why uncovered:** Most test data uses larger token counts; the `n < 1000` branch in `fmtTokens` isn't hit. Line 354 may be a coverage artefact.

**What to test:** Render with a tiny dataset (input < 1000) so the formatting branch fires.

**Effort:** 5 minutes.

---

### `src/db/migrate.ts` — 84% statements, 66.66% branches

**Uncovered lines:** 38–39

**Why uncovered:** Likely an error path or the second migration's idempotency check.

**What to test:** Run a migration on a DB that already has the table partially applied (or simulate via direct SQL), confirm migration handles it without error.

**Effort:** 15 minutes.

---

## Phase 1 — Pure-Function Unit Tests

**Goal:** Cover the cheap wins — error classes, path helpers, format utilities, render utilities. No DuckDB needed.

**Estimated coverage delta:**
- Statements: +6.5% (≈30 stmts)
- Branches: +5.5% (≈20 branches)
- Functions: +14% (≈15 fns)
- Lines: +5% (≈20 lines)

**Files created:** 4

### 1.1 — `test/unit/errors.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  TokensteinError,
  UserError,
  LockBusyError,
  FxUnavailableError,
  ConfigError,
  IngestError,
} from "../../src/errors.js";

describe("error classes", () => {
  it("TokensteinError has default exitCode 1", () => {
    const e = new TokensteinError("base error");
    expect(e.exitCode).toBe(1);
    expect(e.message).toBe("base error");
    expect(e instanceof Error).toBe(true);
  });

  it("UserError overrides exitCode to 2", () => {
    const e = new UserError("bad input");
    expect(e.exitCode).toBe(2);
    expect(e instanceof TokensteinError).toBe(true);
  });

  it("LockBusyError overrides exitCode to 0 (not an error condition)", () => {
    const e = new LockBusyError("already running");
    expect(e.exitCode).toBe(0);
    expect(e instanceof TokensteinError).toBe(true);
  });

  it("FxUnavailableError keeps default exitCode 1", () => {
    const e = new FxUnavailableError("fx api down");
    expect(e.exitCode).toBe(1);
    expect(e instanceof TokensteinError).toBe(true);
  });

  it("ConfigError extends UserError (exitCode 2)", () => {
    const e = new ConfigError("bad config");
    expect(e.exitCode).toBe(2);
    expect(e instanceof UserError).toBe(true);
    expect(e instanceof TokensteinError).toBe(true);
  });

  it("IngestError keeps default exitCode 1", () => {
    const e = new IngestError("ingest failed");
    expect(e.exitCode).toBe(1);
    expect(e instanceof TokensteinError).toBe(true);
  });

  it("error messages survive instantiation", () => {
    const messages = ["a", "with spaces", "with\nnewline", ""];
    for (const m of messages) {
      expect(new TokensteinError(m).message).toBe(m);
    }
  });
});
```

**Coverage hit:**
- `errors.ts` 0% → 100% statements, 100% functions
- 6 class function entries, ~12 statements, instanceof checks cover the prototype chain branches

### 1.2 — `test/unit/paths.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let originalHome: string | undefined;
let testHome: string;

beforeEach(async () => {
  originalHome = process.env["HOME"];
  testHome = await mkdtemp(join(tmpdir(), "tokenstein-paths-"));
  process.env["HOME"] = testHome;
});

afterEach(async () => {
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
  await rm(testHome, { recursive: true, force: true });
});

describe("path helpers", () => {
  it("dbPath() ends with tokens.duckdb", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    expect((mod as any).dbPath()).toMatch(/\.claude-tokenstein[/\\]tokens\.duckdb$/);
  });

  it("configPath() ends with config.json", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    expect((mod as any).configPath()).toMatch(/config\.json$/);
  });

  it("lockPath() ends with ingest.lock", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    expect((mod as any).lockPath()).toMatch(/ingest\.lock$/);
  });

  it("logPath() ends with logs/ingest.log", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    expect((mod as any).logPath()).toMatch(/logs[/\\]ingest\.log$/);
  });

  it("pricesOverridePath() ends with prices.json", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    expect((mod as any).pricesOverridePath()).toMatch(/prices\.json$/);
  });

  it("reportPath() ends with report.html", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    expect((mod as any).reportPath()).toMatch(/report\.html$/);
  });

  it("runtimeRoot() returns absolute path containing .claude-tokenstein", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    const root = (mod as any).runtimeRoot();
    expect(root).toMatch(/\.claude-tokenstein$/);
  });

  it("ensureRuntimeDir() creates the logs directory", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    await (mod as any).ensureRuntimeDir();
    const logsDir = join(testHome, ".claude-tokenstein", "logs");
    const s = await stat(logsDir);
    expect(s.isDirectory()).toBe(true);
  });

  it("ensureRuntimeDir() is idempotent", async () => {
    const mod = await import(`../../src/db/paths.js?t=${Date.now()}`);
    await (mod as any).ensureRuntimeDir();
    await (mod as any).ensureRuntimeDir(); // should not throw
    const logsDir = join(testHome, ".claude-tokenstein", "logs");
    const s = await stat(logsDir);
    expect(s.isDirectory()).toBe(true);
  });
});
```

**Coverage hit:**
- `paths.ts` 22% → 100% statements, 12.5% → 100% functions
- Branch on the `mkdir({ recursive: true })` is implicit

### 1.3 — `test/unit/format.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { totalTokens, modelRowToTableRow, computeRowCost } from "../../src/reports/format.js";
import type { ModelRow } from "../../src/reports/queries.js";
import type { PriceTable } from "../../src/pricing/types.js";

const PRICES: PriceTable = {
  "model-a": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
  "model-b": { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5 },
};

const sampleRow = (overrides: Partial<ModelRow> = {}): ModelRow => ({
  model: "model-a",
  input: 1000,
  output: 500,
  cache_write: 200,
  cache_read: 100,
  turns: 5,
  ...overrides,
});

describe("totalTokens", () => {
  it("sums all four token fields", () => {
    expect(totalTokens(sampleRow())).toBe(1000 + 500 + 200 + 100);
  });

  it("returns 0 for all-zero row", () => {
    expect(totalTokens(sampleRow({ input: 0, output: 0, cache_write: 0, cache_read: 0 }))).toBe(0);
  });

  it("does NOT include turns in the sum", () => {
    const row = sampleRow({ input: 0, output: 0, cache_write: 0, cache_read: 0, turns: 999 });
    expect(totalTokens(row)).toBe(0);
  });

  it("handles large values without precision loss for safe-int range", () => {
    const row = sampleRow({ input: 1_000_000, output: 2_000_000, cache_write: 3_000_000, cache_read: 4_000_000 });
    expect(totalTokens(row)).toBe(10_000_000);
  });
});

describe("modelRowToTableRow", () => {
  it("returns 8-element array", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    expect(result).toHaveLength(8);
  });

  it("first element is model name", () => {
    const result = modelRowToTableRow(sampleRow({ model: "model-b" }), PRICES, "usd", 1);
    expect(result[0]).toBe("model-b");
  });

  it("indexes 1-4 are input/output/cache_write/cache_read formatted", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    // formatTokens uses Intl.NumberFormat — adds thousands separators
    expect(result[1]).toMatch(/1[,.]?000/);
    expect(result[2]).toMatch(/500/);
    expect(result[3]).toMatch(/200/);
    expect(result[4]).toMatch(/100/);
  });

  it("index 5 is total of all four token types", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    // 1000+500+200+100 = 1800
    expect(result[5]).toMatch(/1[,.]?800/);
  });

  it("index 6 is turns count as string", () => {
    const result = modelRowToTableRow(sampleRow({ turns: 42 }), PRICES, "usd", 1);
    expect(result[6]).toBe("42");
  });

  it("index 7 is USD cost when currency=usd", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    expect(result[7]).toContain("$");
  });

  it("index 7 is EUR cost when currency=eur", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "eur", 0.92);
    expect(result[7]).toContain("€");
  });

  it("unknown model produces $0 cost", () => {
    const result = modelRowToTableRow(sampleRow({ model: "unknown-model" }), PRICES, "usd", 1);
    expect(result[7]).toMatch(/\$0/);
  });
});

describe("computeRowCost", () => {
  it("formats USD with $ symbol", () => {
    const cost = computeRowCost(sampleRow(), PRICES, "usd", 1);
    expect(cost).toContain("$");
  });

  it("formats EUR with € symbol", () => {
    const cost = computeRowCost(sampleRow(), PRICES, "eur", 0.92);
    expect(cost).toContain("€");
  });

  it("EUR cost is USD cost × fxRate", () => {
    const usdCost = computeRowCost(sampleRow(), PRICES, "usd", 1);
    const eurCost = computeRowCost(sampleRow(), PRICES, "eur", 0.5);
    // Hard to compare exactly because of currency symbol, but value should be roughly half
    const usdNum = parseFloat(usdCost.replace(/[^\d.]/g, ""));
    const eurNum = parseFloat(eurCost.replace(/[^\d.]/g, ""));
    expect(eurNum).toBeCloseTo(usdNum * 0.5, 4);
  });

  it("returns $0 for unknown model", () => {
    const cost = computeRowCost(sampleRow({ model: "unknown" }), PRICES, "usd", 1);
    expect(cost).toMatch(/\$0/);
  });
});
```

**Coverage hit:**
- `format.ts` 67% → 100% statements, 33% → 100% functions
- All four branches in `modelRowToTableRow` array construction covered

### 1.4 — `test/unit/render.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  renderTable,
  renderSparkline,
  formatCurrency,
  formatTokens,
  formatDate,
} from "../../src/reports/render.js";

describe("renderTable", () => {
  it("renders a table with header row only when no data rows", () => {
    const out = renderTable(["A", "B", "C"], []);
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out).toContain("C");
  });

  it("renders multiple rows", () => {
    const out = renderTable(["X", "Y"], [["1", "2"], ["3", "4"]]);
    expect(out).toContain("1");
    expect(out).toContain("4");
  });

  it("accepts mixed string/number row values", () => {
    const out = renderTable(["X"], [[1], ["b"]]);
    expect(out).toContain("1");
    expect(out).toContain("b");
  });
});

describe("renderSparkline", () => {
  it("returns empty string for empty array", () => {
    expect(renderSparkline([])).toBe("");
  });

  it("returns single-character mid-glyph for single value", () => {
    const out = renderSparkline([5]);
    expect(out).toHaveLength(1);
  });

  it("returns equal-glyph string when all values are equal", () => {
    // max === min branch
    const out = renderSparkline([5, 5, 5]);
    expect(out).toHaveLength(3);
    // All chars should be the same
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
  });

  it("returns rising sparkline for increasing values", () => {
    const out = renderSparkline([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out).toHaveLength(8);
    // First and last should be the lowest and highest glyphs
    expect(out[0]).toBe("▁");
    expect(out[7]).toBe("█");
  });

  it("handles zero values correctly", () => {
    const out = renderSparkline([0, 0, 5, 0]);
    expect(out).toHaveLength(4);
  });
});

describe("formatCurrency", () => {
  it("formats USD with $ symbol", () => {
    const out = formatCurrency(12.34, "usd");
    expect(out).toContain("12.34");
    // Locale-dependent symbol
    expect(out).toMatch(/[$US]/);
  });

  it("formats EUR with € symbol", () => {
    const out = formatCurrency(12.34, "eur");
    expect(out).toContain("12.34");
    expect(out).toMatch(/[€EUR]/);
  });

  it("preserves up to 4 fractional digits", () => {
    const out = formatCurrency(0.1234, "usd");
    expect(out).toMatch(/0\.1234|0,1234/);
  });

  it("rounds to minimum 2 fractional digits", () => {
    const out = formatCurrency(1, "usd");
    expect(out).toMatch(/1\.00|1,00/);
  });
});

describe("formatTokens", () => {
  it("formats integer with thousands separator", () => {
    expect(formatTokens(1234)).toMatch(/1[,.]?234/);
  });

  it("formats 0", () => {
    expect(formatTokens(0)).toMatch(/^0$/);
  });

  it("handles bigint input", () => {
    const out = formatTokens(BigInt(1_000_000));
    expect(out).toMatch(/1[,.]000[,.]000/);
  });

  it("handles BigInt zero", () => {
    expect(formatTokens(BigInt(0))).toMatch(/^0$/);
  });
});

describe("formatDate", () => {
  it("formats a Date object as a non-empty string", () => {
    const out = formatDate(new Date("2026-05-02T12:00:00Z"));
    expect(out).toBeTruthy();
    expect(out.length).toBeGreaterThan(0);
  });

  it("output contains year, month, day digits", () => {
    const out = formatDate(new Date("2026-05-02T12:00:00Z"));
    // Locale-dependent format but should contain these somewhere
    expect(out).toMatch(/2026|26/);
  });
});
```

**Coverage hit:**
- `render.ts` 88% → 100% statements
- `renderSparkline` `max === min` branch covered
- `formatTokens` bigint branch covered
- `formatDate` first call

### Phase 1 cumulative impact

| File | Stmts before | Stmts after |
|---|---|---|
| `errors.ts` | 0% | 100% |
| `paths.ts` | 22% | 100% |
| `format.ts` | 67% | 100% |
| `render.ts` | 88% | 100% |
| **Overall** | **78.5%** | **~84%** |

---

## Phase 2 — `queries.ts` Integration Tests

**Goal:** Cover the five query functions that have effectively zero test coverage. This is the single biggest coverage win in the plan.

**Estimated coverage delta:**
- Statements: +5% (≈25 stmts)
- Branches: +10% (≈35 branches — many in WHERE clauses, ORDER BY)
- Functions: +5% (≈5 fns)
- Lines: +6% (≈25 lines)

**File created:** 1 (`test/integration/queries.test.ts`)

### 2.1 — Test file structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import {
  queryReport,
  queryToday,
  querySession,
  queryHourly,
  queryTop,
  queryCost,
} from "../../src/reports/queries.js";

let tmpDir: string;

async function freshConn(name: string): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
  const db = await DuckDBInstance.create(join(tmpDir, `${name}.duckdb`));
  const conn = await db.connect();
  await runMigrations(conn);
  return { db, conn };
}

async function insertMessage(
  conn: DuckDBConnection,
  opts: {
    ts: string;
    model: string;
    input: number;
    output: number;
    cache_write?: number;
    cache_read?: number;
    session_id?: string;
    project_cwd?: string;
  },
): Promise<void> {
  const {
    ts, model, input, output,
    cache_write = 0, cache_read = 0,
    session_id = "test-session",
    project_cwd = "/test",
  } = opts;
  await conn.run(
    `INSERT INTO messages (id, session_id, project_cwd, ts, model, source,
       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (gen_random_uuid(), ?, ?, ?::TIMESTAMP, ?, 'test', ?, ?, ?, ?)`,
    [session_id, project_cwd, ts, model, input, output, cache_write, cache_read],
  );
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-q-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const TODAY = new Date();
const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

### 2.2 — `queryReport` tests (5 tests)

```typescript
describe("queryReport", () => {
  it("returns rows from the last N days", async () => {
    const { conn, db } = await freshConn("report-window");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${daysAgo(2)} 10:00:00`, model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${daysAgo(10)} 10:00:00`, model: "m-a", input: 9999, output: 0 });

    const rows = await queryReport(conn, 7);
    const totalInput = rows.reduce((s, r) => s + r.input, 0);
    expect(totalInput).toBe(300);

    conn.closeSync(); db.closeSync();
  });

  it("days=1 includes today only", async () => {
    const { conn, db } = await freshConn("report-1day");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 50, output: 0 });
    await insertMessage(conn, { ts: `${daysAgo(1)} 10:00:00`, model: "m-a", input: 100, output: 0 });

    const rows = await queryReport(conn, 1);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBeLessThanOrEqual(150);

    conn.closeSync(); db.closeSync();
  });

  it("returns empty for empty DB", async () => {
    const { conn, db } = await freshConn("report-empty");
    const rows = await queryReport(conn, 30);
    expect(rows).toHaveLength(0);
    conn.closeSync(); db.closeSync();
  });

  it("groups by day + model", async () => {
    const { conn, db } = await freshConn("report-group");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${today} 12:00:00`, model: "m-b", input: 300, output: 150 });

    const rows = await queryReport(conn, 7);
    const aRow = rows.find((r) => r.day === today && r.model === "m-a");
    const bRow = rows.find((r) => r.day === today && r.model === "m-b");
    expect(aRow?.input).toBe(300);
    expect(bRow?.input).toBe(300);

    conn.closeSync(); db.closeSync();
  });

  it("total_all = input + output + cache_write + cache_read", async () => {
    const { conn, db } = await freshConn("report-total-all");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a",
      input: 100, output: 50, cache_write: 30, cache_read: 20,
    });

    const rows = await queryReport(conn, 7);
    expect(rows[0]?.total_all).toBe(200);
    expect(rows[0]?.total).toBe(150);

    conn.closeSync(); db.closeSync();
  });
});
```

### 2.3 — `queryToday` tests (5 tests)

```typescript
describe("queryToday", () => {
  it("returns rows from local-midnight today", async () => {
    const { conn, db } = await freshConn("today-window");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${daysAgo(1)} 23:59:00`, model: "m-a", input: 9999, output: 0 });

    const rows = await queryToday(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(100);

    conn.closeSync(); db.closeSync();
  });

  it("returns empty when no data today", async () => {
    const { conn, db } = await freshConn("today-empty");
    await insertMessage(conn, { ts: `${daysAgo(2)} 10:00:00`, model: "m-a", input: 100, output: 50 });

    const rows = await queryToday(conn);
    expect(rows).toHaveLength(0);

    conn.closeSync(); db.closeSync();
  });

  it("groups by model", async () => {
    const { conn, db } = await freshConn("today-group");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-b", input: 50, output: 25 });

    const rows = await queryToday(conn);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.model === "m-a");
    expect(a?.input).toBe(300);

    conn.closeSync(); db.closeSync();
  });

  it("includes turns count", async () => {
    const { conn, db } = await freshConn("today-turns");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-a", input: 100, output: 50 });

    const rows = await queryToday(conn);
    expect(rows[0]?.turns).toBe(3);

    conn.closeSync(); db.closeSync();
  });

  it("orders by total tokens desc", async () => {
    const { conn, db } = await freshConn("today-order");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "small", input: 10, output: 5 });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "big", input: 1000, output: 500 });

    const rows = await queryToday(conn);
    expect(rows[0]?.model).toBe("big");
    expect(rows[1]?.model).toBe("small");

    conn.closeSync(); db.closeSync();
  });
});
```

### 2.4 — `querySession` tests (4 tests)

```typescript
describe("querySession", () => {
  it("returns rows for given session id", async () => {
    const { conn, db } = await freshConn("session-id");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "abc" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-a", input: 200, output: 100, session_id: "abc" });
    await insertMessage(conn, { ts: `${today} 12:00:00`, model: "m-a", input: 9999, output: 0, session_id: "xyz" });

    const rows = await querySession(conn, "abc");
    expect(rows[0]?.input).toBe(300);

    conn.closeSync(); db.closeSync();
  });

  it("returns empty for unknown session id", async () => {
    const { conn, db } = await freshConn("session-missing");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "abc" });

    const rows = await querySession(conn, "does-not-exist");
    expect(rows).toHaveLength(0);

    conn.closeSync(); db.closeSync();
  });

  it("groups by model with turns count", async () => {
    const { conn, db } = await freshConn("session-group");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50, session_id: "s" });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "s" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-b", input: 100, output: 50, session_id: "s" });

    const rows = await querySession(conn, "s");
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.model === "m-a");
    expect(a?.turns).toBe(2);

    conn.closeSync(); db.closeSync();
  });

  it("includes cache_write and cache_read fields", async () => {
    const { conn, db } = await freshConn("session-cache");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a",
      input: 0, output: 0, cache_write: 500, cache_read: 1000,
      session_id: "cache-sess",
    });

    const rows = await querySession(conn, "cache-sess");
    expect(rows[0]?.cache_write).toBe(500);
    expect(rows[0]?.cache_read).toBe(1000);

    conn.closeSync(); db.closeSync();
  });
});
```

### 2.5 — `queryHourly` tests (5 tests)

```typescript
describe("queryHourly", () => {
  it("returns rows from the last 24 hours", async () => {
    const { conn, db } = await freshConn("hourly-window");
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);
    const ago25h = new Date(now.getTime() - 25 * 3600_000);

    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: ago25h.toISOString(), model: "m-a", input: 9999, output: 0 });

    const rows = await queryHourly(conn);
    const total = rows.reduce((s, r) => s + r.total, 0);
    expect(total).toBe(150);

    conn.closeSync(); db.closeSync();
  });

  it("total includes cache tokens (regression test)", async () => {
    const { conn, db } = await freshConn("hourly-cache");
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);

    await insertMessage(conn, {
      ts: oneHourAgo.toISOString(), model: "m-a",
      input: 100, output: 50, cache_write: 200, cache_read: 300,
    });

    const rows = await queryHourly(conn);
    expect(rows[0]?.total).toBe(650);

    conn.closeSync(); db.closeSync();
  });

  it("returns empty when DB has no recent data", async () => {
    const { conn, db } = await freshConn("hourly-empty");
    const ago30h = new Date(Date.now() - 30 * 3600_000);
    await insertMessage(conn, { ts: ago30h.toISOString(), model: "m-a", input: 100, output: 50 });

    const rows = await queryHourly(conn);
    expect(rows).toHaveLength(0);

    conn.closeSync(); db.closeSync();
  });

  it("orders by hour ascending", async () => {
    const { conn, db } = await freshConn("hourly-order");
    const now = new Date();
    const ago3h = new Date(now.getTime() - 3 * 3600_000);
    const ago1h = new Date(now.getTime() - 1 * 3600_000);
    const ago5h = new Date(now.getTime() - 5 * 3600_000);

    await insertMessage(conn, { ts: ago3h.toISOString(), model: "m-a", input: 100, output: 0 });
    await insertMessage(conn, { ts: ago1h.toISOString(), model: "m-a", input: 200, output: 0 });
    await insertMessage(conn, { ts: ago5h.toISOString(), model: "m-a", input: 50, output: 0 });

    const rows = await queryHourly(conn);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].hour >= rows[i - 1].hour).toBe(true);
    }

    conn.closeSync(); db.closeSync();
  });

  it("returns hour as ISO-like string", async () => {
    const { conn, db } = await freshConn("hourly-format");
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);

    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 100, output: 0 });

    const rows = await queryHourly(conn);
    expect(rows[0]?.hour).toMatch(/^\d{4}-\d{2}-\d{2}/);

    conn.closeSync(); db.closeSync();
  });
});
```

### 2.6 — `queryTop` tests (6 tests)

```typescript
describe("queryTop", () => {
  it("by='model' returns top N models by total tokens", async () => {
    const { conn, db } = await freshConn("top-model");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "small", input: 10, output: 0 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "medium", input: 100, output: 0 });
    await insertMessage(conn, { ts: `${today} 12:00:00`, model: "big", input: 1000, output: 0 });

    const rows = await queryTop(conn, "model", 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.bucket).toBe("big");
    expect(rows[1]?.bucket).toBe("medium");

    conn.closeSync(); db.closeSync();
  });

  it("by='session' groups by session_id", async () => {
    const { conn, db } = await freshConn("top-session");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m", input: 100, output: 0, session_id: "s1" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m", input: 200, output: 0, session_id: "s2" });

    const rows = await queryTop(conn, "session", 5);
    const s2Row = rows.find((r) => r.bucket === "s2");
    expect(s2Row?.total_tokens).toBe(200);

    conn.closeSync(); db.closeSync();
  });

  it("by='project' groups by project_cwd", async () => {
    const { conn, db } = await freshConn("top-project");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m", input: 100, output: 0, project_cwd: "/proj-a" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m", input: 50, output: 0, project_cwd: "/proj-b" });

    const rows = await queryTop(conn, "project", 5);
    expect(rows.find((r) => r.bucket === "/proj-a")?.total_tokens).toBe(100);

    conn.closeSync(); db.closeSync();
  });

  it("invalid by throws", async () => {
    const { conn, db } = await freshConn("top-invalid");
    await expect(queryTop(conn, "garbage", 5)).rejects.toThrow();
    conn.closeSync(); db.closeSync();
  });

  it("respects N limit", async () => {
    const { conn, db } = await freshConn("top-limit");
    for (let i = 0; i < 10; i++) {
      await insertMessage(conn, {
        ts: `${today} 10:00:00`, model: `m-${i}`, input: 100 + i, output: 0,
      });
    }
    const rows = await queryTop(conn, "model", 3);
    expect(rows).toHaveLength(3);
    conn.closeSync(); db.closeSync();
  });

  it("total includes cache tokens", async () => {
    const { conn, db } = await freshConn("top-cache");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m",
      input: 100, output: 50, cache_write: 200, cache_read: 300,
    });
    const rows = await queryTop(conn, "model", 5);
    expect(rows[0]?.total_tokens).toBe(650);
    conn.closeSync(); db.closeSync();
  });
});
```

### 2.7 — `queryCost` tests (5 tests)

```typescript
describe("queryCost", () => {
  it("returns rows for given year+month", async () => {
    const { conn, db } = await freshConn("cost-month");
    const yyyy = TODAY.getFullYear();
    const mm = TODAY.getMonth() + 1;
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50 });

    const rows = await queryCost(conn, yyyy, mm);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.input).toBeGreaterThanOrEqual(100);

    conn.closeSync(); db.closeSync();
  });

  it("excludes other months", async () => {
    const { conn, db } = await freshConn("cost-exclude");
    // Insert into Jan 2025 specifically
    await insertMessage(conn, { ts: "2025-01-15 10:00:00", model: "m-a", input: 100, output: 50 });
    // Insert into Feb 2025
    await insertMessage(conn, { ts: "2025-02-15 10:00:00", model: "m-a", input: 9999, output: 0 });

    const rows = await queryCost(conn, 2025, 1);
    const total = rows.reduce((s, r) => s + r.input, 0);
    expect(total).toBe(100);

    conn.closeSync(); db.closeSync();
  });

  it("returns empty for month with no data", async () => {
    const { conn, db } = await freshConn("cost-empty");
    const rows = await queryCost(conn, 1999, 1);
    expect(rows).toHaveLength(0);
    conn.closeSync(); db.closeSync();
  });

  it("groups by model with turns count", async () => {
    const { conn, db } = await freshConn("cost-group");
    await insertMessage(conn, { ts: "2025-03-01 10:00:00", model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: "2025-03-15 10:00:00", model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: "2025-03-20 10:00:00", model: "m-b", input: 50, output: 25 });

    const rows = await queryCost(conn, 2025, 3);
    const a = rows.find((r) => r.model === "m-a");
    expect(a?.input).toBe(300);
    expect(a?.turns).toBe(2);

    conn.closeSync(); db.closeSync();
  });

  it("populates cache_write and cache_read fields", async () => {
    const { conn, db } = await freshConn("cost-cache");
    await insertMessage(conn, {
      ts: "2025-04-01 10:00:00", model: "m-a",
      input: 100, output: 50, cache_write: 1000, cache_read: 5000,
    });
    const rows = await queryCost(conn, 2025, 4);
    expect(rows[0]?.cache_write).toBe(1000);
    expect(rows[0]?.cache_read).toBe(5000);
    conn.closeSync(); db.closeSync();
  });
});
```

### Phase 2 cumulative impact

| File | Stmts before | Stmts after |
|---|---|---|
| `queries.ts` | 22.58% | ≈95% |
| **Overall** | **84%** | **≈89%** |

---

## Phase 3 — Render Command Tests

**Goal:** Cover the 8 render command modules end-to-end. Many of these have early-return branches ("No data") and error paths (invalid arguments) that are uncovered.

**Estimated coverage delta:**
- Statements: +3% (≈14 stmts — small file bodies)
- Branches: +12% (≈40 branches — every "No data" path, error throws, currency footer)
- Functions: +9% (≈10 fns — all the `collect*` companion functions)
- Lines: +3.5% (≈14 lines)

**File created:** 1 (`test/integration/render-commands.test.ts`)

### 3.1 — Test file structure

Same boilerplate as Phase 2 (freshConn, insertMessage, beforeEach/afterEach).

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// ... imports as Phase 2 ...
import { renderTodayCommand, collectTodayCommand } from "../../src/reports/today.js";
import { renderSessionCommand } from "../../src/reports/session.js";
import { renderHourlyCommand, collectHourlyCommand } from "../../src/reports/hourly.js";
import { renderTopCommand, collectTopCommand } from "../../src/reports/top.js";
import { renderCostCommand, collectCostCommand } from "../../src/reports/cost.js";
import type { PriceTable } from "../../src/pricing/types.js";

const PRICES: PriceTable = {
  "m-a": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
};
```

### 3.2 — `renderTodayCommand` tests (4 tests)

```typescript
describe("renderTodayCommand", () => {
  it("returns 'No usage recorded today.' when DB empty", async () => {
    const { conn, db } = await freshConn("render-today-empty");
    const out = await renderTodayCommand(conn, PRICES, "usd", 1);
    expect(out).toBe("No usage recorded today.");
    conn.closeSync(); db.closeSync();
  });

  it("returns header + table when data exists", async () => {
    const { conn, db } = await freshConn("render-today-data");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 1000, output: 500 });
    const out = await renderTodayCommand(conn, PRICES, "usd", 1);
    expect(out).toContain("Today");
    expect(out).toContain("m-a");
    conn.closeSync(); db.closeSync();
  });

  it("header includes total of all four token types", async () => {
    const { conn, db } = await freshConn("render-today-totalall");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a",
      input: 100, output: 50, cache_write: 200, cache_read: 300,
    });
    const out = await renderTodayCommand(conn, PRICES, "usd", 1);
    expect(out).toMatch(/650/);
    conn.closeSync(); db.closeSync();
  });

  it("collectTodayCommand returns array with cost field", async () => {
    const { conn, db } = await freshConn("collect-today");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 1_000_000, output: 0 });
    const result = await collectTodayCommand(conn, PRICES, "usd", 1) as Array<{ cost: string }>;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].cost).toBeDefined();
    conn.closeSync(); db.closeSync();
  });
});
```

### 3.3 — `renderSessionCommand` tests (5 tests)

```typescript
describe("renderSessionCommand", () => {
  it("throws UserError when no session id and no env var", async () => {
    const { conn, db } = await freshConn("session-no-id");
    delete process.env["CLAUDE_SESSION_ID"];
    await expect(
      renderSessionCommand(conn, undefined, PRICES, "usd", 1),
    ).rejects.toThrow(/No session id/);
    conn.closeSync(); db.closeSync();
  });

  it("uses CLAUDE_SESSION_ID env var when no arg provided", async () => {
    const { conn, db } = await freshConn("session-env");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "env-sess" });
    process.env["CLAUDE_SESSION_ID"] = "env-sess";
    try {
      const out = await renderSessionCommand(conn, undefined, PRICES, "usd", 1);
      expect(out).toContain("env-sess");
    } finally {
      delete process.env["CLAUDE_SESSION_ID"];
    }
    conn.closeSync(); db.closeSync();
  });

  it("returns 'No data for session X' when session has no rows", async () => {
    const { conn, db } = await freshConn("session-empty");
    const out = await renderSessionCommand(conn, "missing", PRICES, "usd", 1);
    expect(out).toBe("No data for session missing");
    conn.closeSync(); db.closeSync();
  });

  it("returns header with turn count", async () => {
    const { conn, db } = await freshConn("session-turns");
    for (let i = 0; i < 5; i++) {
      await insertMessage(conn, {
        ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "s",
      });
    }
    const out = await renderSessionCommand(conn, "s", PRICES, "usd", 1);
    expect(out).toContain("5 turns");
    conn.closeSync(); db.closeSync();
  });

  it("table contains model rows", async () => {
    const { conn, db } = await freshConn("session-table");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "s" });
    const out = await renderSessionCommand(conn, "s", PRICES, "usd", 1);
    expect(out).toContain("m-a");
    conn.closeSync(); db.closeSync();
  });
});
```

### 3.4 — `renderHourlyCommand` tests (4 tests)

```typescript
describe("renderHourlyCommand", () => {
  it("returns 'No usage in the last 24 hours.' when empty", async () => {
    const { conn, db } = await freshConn("hourly-render-empty");
    const out = await renderHourlyCommand(conn);
    expect(out).toBe("No usage in the last 24 hours.");
    conn.closeSync(); db.closeSync();
  });

  it("returns sparkline + table when data exists", async () => {
    const { conn, db } = await freshConn("hourly-render-data");
    const oneHourAgo = new Date(Date.now() - 3600_000);
    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 1000, output: 0 });
    const out = await renderHourlyCommand(conn);
    expect(out).toContain("1,000");
    expect(out).toContain("Hour");
    conn.closeSync(); db.closeSync();
  });

  it("bar widths scale to max", async () => {
    const { conn, db } = await freshConn("hourly-bars");
    const now = new Date();
    const ago1 = new Date(now.getTime() - 1 * 3600_000);
    const ago2 = new Date(now.getTime() - 2 * 3600_000);
    await insertMessage(conn, { ts: ago1.toISOString(), model: "m-a", input: 100, output: 0 });
    await insertMessage(conn, { ts: ago2.toISOString(), model: "m-a", input: 1000, output: 0 });

    const out = await renderHourlyCommand(conn);
    // The biggest bar should be 20 chars; smaller bar ~2 chars
    const lines = out.split("\n");
    const barLines = lines.filter((l) => l.includes("█"));
    expect(barLines.length).toBeGreaterThan(0);
    conn.closeSync(); db.closeSync();
  });

  it("collectHourlyCommand returns rows", async () => {
    const { conn, db } = await freshConn("hourly-collect");
    const oneHourAgo = new Date(Date.now() - 3600_000);
    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 100, output: 0 });
    const rows = await collectHourlyCommand(conn) as Array<{ hour: string; total: number }>;
    expect(rows.length).toBeGreaterThan(0);
    conn.closeSync(); db.closeSync();
  });
});
```

### 3.5 — `renderTopCommand` tests (6 tests)

```typescript
describe("renderTopCommand", () => {
  it("throws UserError on invalid by", async () => {
    const { conn, db } = await freshConn("top-render-invalid");
    await expect(renderTopCommand(conn, "garbage", 5)).rejects.toThrow(/Invalid --by/);
    conn.closeSync(); db.closeSync();
  });

  it("returns 'No data.' when empty", async () => {
    const { conn, db } = await freshConn("top-render-empty");
    const out = await renderTopCommand(conn, "model", 5);
    expect(out).toBe("No data.");
    conn.closeSync(); db.closeSync();
  });

  it("returns table for by='model'", async () => {
    const { conn, db } = await freshConn("top-render-data");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 0 });
    const out = await renderTopCommand(conn, "model", 5);
    expect(out).toContain("m-a");
    expect(out).toContain("Top 5 by model");
    conn.closeSync(); db.closeSync();
  });

  it("truncates long bucket names with leading ellipsis", async () => {
    const { conn, db } = await freshConn("top-truncate");
    const longProject = "/a/very/very/long/project/path/that/exceeds/the/sixty/character/limit/significantly";
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 0, project_cwd: longProject,
    });
    const out = await renderTopCommand(conn, "project", 5);
    expect(out).toContain("…");
    conn.closeSync(); db.closeSync();
  });

  it("collectTopCommand throws on invalid by", async () => {
    const { conn, db } = await freshConn("top-collect-invalid");
    await expect(collectTopCommand(conn, "garbage", 5)).rejects.toThrow(/Invalid --by/);
    conn.closeSync(); db.closeSync();
  });

  it("collectTopCommand returns rows for valid by", async () => {
    const { conn, db } = await freshConn("top-collect-data");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 0 });
    const rows = await collectTopCommand(conn, "model", 5) as Array<{ bucket: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].bucket).toBe("m-a");
    conn.closeSync(); db.closeSync();
  });
});
```

### 3.6 — `renderCostCommand` tests (6 tests)

```typescript
describe("renderCostCommand", () => {
  it("throws on month not matching YYYY-MM", async () => {
    const { conn, db } = await freshConn("cost-render-invalid-1");
    await expect(renderCostCommand(conn, "foo", PRICES, "usd", 1)).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("throws on month=2024-13", async () => {
    const { conn, db } = await freshConn("cost-render-invalid-2");
    await expect(renderCostCommand(conn, "2024-13", PRICES, "usd", 1)).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("throws on month=2024-00", async () => {
    const { conn, db } = await freshConn("cost-render-invalid-3");
    await expect(renderCostCommand(conn, "2024-00", PRICES, "usd", 1)).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("returns 'No data for YYYY-MM.' when empty", async () => {
    const { conn, db } = await freshConn("cost-render-empty");
    const out = await renderCostCommand(conn, "1999-01", PRICES, "usd", 1);
    expect(out).toBe("No data for 1999-01.");
    conn.closeSync(); db.closeSync();
  });

  it("returns table with cost column for valid data", async () => {
    const { conn, db } = await freshConn("cost-render-data");
    await insertMessage(conn, { ts: "2025-06-15 10:00:00", model: "m-a", input: 1_000_000, output: 0 });
    const out = await renderCostCommand(conn, "2025-06", PRICES, "usd", 1);
    expect(out).toContain("m-a");
    expect(out).toContain("$");
    conn.closeSync(); db.closeSync();
  });

  it("currency=eur prepends FX footer when fxSource provided", async () => {
    const { conn, db } = await freshConn("cost-fx-footer");
    await insertMessage(conn, { ts: "2025-06-15 10:00:00", model: "m-a", input: 1_000_000, output: 0 });
    const out = await renderCostCommand(conn, "2025-06", PRICES, "eur", 0.92, "ECB cached");
    expect(out).toContain("FX source");
    expect(out).toContain("ECB cached");
    conn.closeSync(); db.closeSync();
  });

  it("collectCostCommand throws on invalid month", async () => {
    const { conn, db } = await freshConn("cost-collect-invalid");
    await expect(collectCostCommand(conn, "foo")).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });
});
```

### Phase 3 cumulative impact

After Phase 3, every render command has:
- Empty-data branch covered
- Happy-path branch covered
- Error-throw branches covered (where applicable)

The `collect*` companion functions also get exercised, which will lift the function coverage.

| Metric | Phase 2 baseline | Phase 3 result |
|---|---|---|
| Statements | ~89% | ~92% |
| Branches | ~70% | ~78% |
| Functions | ~92% | ~93% |
| Lines | ~91% | ~94% |

---

## Phase 4 — `pricing/loader.ts` Tests

**Goal:** Cover `loadPrices` and `deepMerge` directly. Currently only their callers are tested with hardcoded `PriceTable` objects.

**Estimated coverage delta:**
- Statements: +1.5% (≈7 stmts in `loadPrices` body)
- Branches: +3% (≈10 branches — try/catch, deepMerge nested loop)
- Functions: +1.8% (≈2 fns)
- Lines: +1.5%

**File created:** 1 (`test/integration/loader.test.ts`)

### 4.1 — Test file

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let originalHome: string | undefined;
let testHome: string;

beforeEach(async () => {
  originalHome = process.env["HOME"];
  testHome = await mkdtemp(join(tmpdir(), "tokenstein-loader-"));
  process.env["HOME"] = testHome;
});

afterEach(async () => {
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
  await rm(testHome, { recursive: true, force: true });
});

describe("loadPrices", () => {
  it("returns the bundled prices.json with no override", async () => {
    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    const prices = await (mod as any).loadPrices();
    expect(prices).toBeDefined();
    expect(typeof prices).toBe("object");
    // Bundled should have well-known canonical model keys
    expect(Object.keys(prices).length).toBeGreaterThan(0);
  });

  it("merges override file when present", async () => {
    const dir = join(testHome, ".claude-tokenstein");
    await mkdir(dir, { recursive: true });
    const overridePath = join(dir, "prices.json");
    await writeFile(overridePath, JSON.stringify({
      "test-model": { input: 1.0, output: 2.0, cache_write: 1.5, cache_read: 0.1 },
    }));

    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    const prices = await (mod as any).loadPrices();
    expect(prices["test-model"]).toEqual({ input: 1.0, output: 2.0, cache_write: 1.5, cache_read: 0.1 });
  });

  it("override partially overrides bundled fields", async () => {
    const dir = join(testHome, ".claude-tokenstein");
    await mkdir(dir, { recursive: true });
    const overridePath = join(dir, "prices.json");
    // Override one specific field for an existing bundled model
    await writeFile(overridePath, JSON.stringify({
      "claude-sonnet-4-6": { input: 999.0, output: 999.0, cache_write: 999.0, cache_read: 999.0 },
    }));

    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    const prices = await (mod as any).loadPrices();
    expect(prices["claude-sonnet-4-6"].input).toBe(999.0);
  });

  it("survives missing override file (ENOENT)", async () => {
    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    const prices = await (mod as any).loadPrices();
    // Should not throw even though override doesn't exist
    expect(prices).toBeDefined();
  });

  it("survives malformed override JSON", async () => {
    const dir = join(testHome, ".claude-tokenstein");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prices.json"), "{ this is not valid JSON ");

    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    // The catch block treats parse failure same as ENOENT — should not throw
    const prices = await (mod as any).loadPrices();
    expect(prices).toBeDefined();
  });

  it("deepMerge with empty override returns bundled untouched", async () => {
    const dir = join(testHome, ".claude-tokenstein");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prices.json"), "{}");

    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    const prices = await (mod as any).loadPrices();
    expect(Object.keys(prices).length).toBeGreaterThan(0);
  });
});
```

### 4.2 — Optional: test `priceFor` warning behavior

The `warnedUnknown` set in `loader.ts` is a side-effect that's hard to assert on, but we can ensure repeated calls don't crash:

```typescript
describe("priceFor", () => {
  it("returns null for unknown model and does not throw on repeat", async () => {
    const mod = await import(`../../src/pricing/loader.js?t=${Date.now()}`);
    expect((mod as any).priceFor({}, "unknown-model")).toBeNull();
    // Second call exercises the warned-set branch
    expect((mod as any).priceFor({}, "unknown-model")).toBeNull();
  });
});
```

### Phase 4 cumulative impact

| Metric | Phase 3 result | Phase 4 result |
|---|---|---|
| Statements | ~92% | ~93% |
| Branches | ~78% | ~82% |
| Functions | ~93% | ~95% |
| Lines | ~94% | ~95% |

---

## Phase 5 — `config.ts` Error Paths

**Goal:** Cover the security check (POSIX permission), JSON parse error, and schema-violation paths.

**Estimated coverage delta:**
- Statements: +1.5% (≈7 stmts)
- Branches: +3.5% (≈12 branches — multiple `if` checks)
- Functions: 0%
- Lines: +1.5%

**File modified:** `test/unit/config.test.ts` (add 4–5 new tests)

### 5.1 — New tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-cfg-test-"));
  process.env["HOME"] = tmpDir;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("loadConfig — error paths", () => {
  it.skipIf(process.platform === "win32")(
    "throws ConfigError when config file is world-readable (POSIX only)",
    async () => {
      const cfgDir = join(tmpDir, ".claude-tokenstein");
      await mkdir(cfgDir, { recursive: true });
      const cfgPath = join(cfgDir, "config.json");
      await writeFile(cfgPath, JSON.stringify({}));
      await chmod(cfgPath, 0o644); // world-readable

      const mod = await import(`../../src/config.js?t=${Date.now()}`);
      await expect((mod as any).loadConfig()).rejects.toThrow(/world-readable|chmod/);
    },
  );

  it("throws on malformed JSON", async () => {
    const cfgDir = join(tmpDir, ".claude-tokenstein");
    await mkdir(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "config.json");
    await writeFile(cfgPath, "{not valid json");
    if (process.platform !== "win32") await chmod(cfgPath, 0o600);

    const mod = await import(`../../src/config.js?t=${Date.now()}`);
    await expect((mod as any).loadConfig()).rejects.toThrow();
  });

  it("throws ConfigError on schema violation", async () => {
    const cfgDir = join(tmpDir, ".claude-tokenstein");
    await mkdir(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "config.json");
    // default_currency must be 'usd' or 'eur'
    await writeFile(cfgPath, JSON.stringify({ default_currency: "JPY" }));
    if (process.platform !== "win32") await chmod(cfgPath, 0o600);

    const mod = await import(`../../src/config.js?t=${Date.now()}`);
    await expect((mod as any).loadConfig()).rejects.toThrow();
  });

  it("throws on negative max_admin_api_lookback_days", async () => {
    const cfgDir = join(tmpDir, ".claude-tokenstein");
    await mkdir(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "config.json");
    await writeFile(cfgPath, JSON.stringify({
      ingest: { max_admin_api_lookback_days: -1 },
    }));
    if (process.platform !== "win32") await chmod(cfgPath, 0o600);

    const mod = await import(`../../src/config.js?t=${Date.now()}`);
    await expect((mod as any).loadConfig()).rejects.toThrow();
  });

  it("admin_api_key with wrong prefix is rejected by schema", async () => {
    const cfgDir = join(tmpDir, ".claude-tokenstein");
    await mkdir(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "config.json");
    await writeFile(cfgPath, JSON.stringify({
      admin_api_key: "sk-bad-prefix-123",
    }));
    if (process.platform !== "win32") await chmod(cfgPath, 0o600);

    const mod = await import(`../../src/config.js?t=${Date.now()}`);
    await expect((mod as any).loadConfig()).rejects.toThrow();
  });

  it("accepts valid admin_api_key prefix", async () => {
    const cfgDir = join(tmpDir, ".claude-tokenstein");
    await mkdir(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "config.json");
    await writeFile(cfgPath, JSON.stringify({
      admin_api_key: "sk-ant-admin-abc123",
    }));
    if (process.platform !== "win32") await chmod(cfgPath, 0o600);

    const mod = await import(`../../src/config.js?t=${Date.now()}`);
    const cfg = await (mod as any).loadConfig();
    expect(cfg.admin_api_key).toBe("sk-ant-admin-abc123");
  });
});
```

### Phase 5 cumulative impact

| Metric | Phase 4 result | Phase 5 result |
|---|---|---|
| Statements | ~93% | ~93% |
| Branches | ~82% | ~86% |
| Functions | ~95% | ~95% |
| Lines | ~95% | ~95% |

---

## Phase 6 — `html-queries.ts` Branch Coverage

**Goal:** Close the branch coverage gap in date-math helpers (`weekStart`, `monthStart`, `quarterStart`, `tomorrow`).

This phase requires a small refactor: export the helpers and let them accept an optional `now: Date` argument so we can test each branch deterministically.

**Estimated coverage delta:**
- Statements: 0%
- Branches: +6.5% (≈25 branches — Sunday wraparound, each Q boundary, each month wraparound)
- Functions: +3.6% (≈4 fns now exported)
- Lines: 0%

**Files modified:**
- `src/reports/html-queries.ts` (export helpers)
- `test/integration/html-queries.test.ts` (add helper tests)

### 6.1 — Refactor `html-queries.ts`

```typescript
// src/reports/html-queries.ts — refactored

export function weekStart(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function quarterStart(now: Date = new Date()): Date {
  const m = now.getUTCMonth();
  const qm = Math.floor(m / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), qm, 1));
}

export function tomorrow(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
```

These were previously `function` declarations — now `export function`. No behavior change.

### 6.2 — Helper unit tests

```typescript
import { describe, it, expect } from "vitest";
import { weekStart, monthStart, quarterStart, tomorrow } from "../../src/reports/html-queries.js";

describe("weekStart", () => {
  it("returns the same date when input is Monday", () => {
    const monday = new Date(Date.UTC(2026, 0, 5)); // Jan 5 2026 is a Monday
    expect(weekStart(monday).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("returns previous Monday when input is Wednesday", () => {
    const wed = new Date(Date.UTC(2026, 0, 7)); // Jan 7 2026 is Wednesday
    expect(weekStart(wed).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("returns previous Monday when input is Sunday (dow === 0 branch)", () => {
    const sun = new Date(Date.UTC(2026, 0, 11)); // Jan 11 2026 is Sunday
    expect(weekStart(sun).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("returns previous Monday when input is Saturday", () => {
    const sat = new Date(Date.UTC(2026, 0, 10)); // Jan 10 2026 is Saturday
    expect(weekStart(sat).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("strips time-of-day from the input", () => {
    const wedNoon = new Date(Date.UTC(2026, 0, 7, 12, 34, 56));
    const result = weekStart(wedNoon);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it("crosses month boundary correctly (Mar 1 Sunday → Feb 23 Mon)", () => {
    const mar1 = new Date(Date.UTC(2026, 2, 1)); // Mar 1 2026 is Sunday
    expect(weekStart(mar1).toISOString().slice(0, 10)).toBe("2026-02-23");
  });

  it("crosses year boundary correctly", () => {
    const jan1_2027 = new Date(Date.UTC(2027, 0, 1)); // Friday
    const result = weekStart(jan1_2027);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-28");
  });
});

describe("monthStart", () => {
  it("returns first of month for mid-month date", () => {
    const d = new Date(Date.UTC(2026, 4, 15));
    expect(monthStart(d).toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("returns same date when input is the 1st", () => {
    const d = new Date(Date.UTC(2026, 4, 1));
    expect(monthStart(d).toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("works for January (month=0)", () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    expect(monthStart(d).toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("works for December (month=11)", () => {
    const d = new Date(Date.UTC(2026, 11, 25));
    expect(monthStart(d).toISOString().slice(0, 10)).toBe("2026-12-01");
  });
});

describe("quarterStart", () => {
  it("returns Jan 1 for Q1 input (Feb)", () => {
    const feb = new Date(Date.UTC(2026, 1, 15));
    expect(quarterStart(feb).toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("returns Apr 1 for Q2 input (May)", () => {
    const may = new Date(Date.UTC(2026, 4, 15));
    expect(quarterStart(may).toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("returns Jul 1 for Q3 input (Aug)", () => {
    const aug = new Date(Date.UTC(2026, 7, 15));
    expect(quarterStart(aug).toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("returns Oct 1 for Q4 input (Nov)", () => {
    const nov = new Date(Date.UTC(2026, 10, 15));
    expect(quarterStart(nov).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("returns the input date when already on Q boundary", () => {
    const apr1 = new Date(Date.UTC(2026, 3, 1));
    expect(quarterStart(apr1).toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});

describe("tomorrow", () => {
  it("returns next day at UTC midnight", () => {
    const today = new Date(Date.UTC(2026, 4, 15, 14, 30));
    expect(tomorrow(today).toISOString().slice(0, 10)).toBe("2026-05-16");
  });

  it("crosses month boundary", () => {
    const lastOfMay = new Date(Date.UTC(2026, 4, 31));
    expect(tomorrow(lastOfMay).toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("crosses year boundary", () => {
    const dec31 = new Date(Date.UTC(2026, 11, 31));
    expect(tomorrow(dec31).toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("strips time-of-day", () => {
    const t = new Date(Date.UTC(2026, 4, 15, 23, 59, 59));
    const result = tomorrow(t);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });
});
```

### Phase 6 cumulative impact

| Metric | Phase 5 result | Phase 6 result |
|---|---|---|
| Statements | ~93% | ~94% |
| Branches | ~86% | ~91% |
| Functions | ~95% | ~95% |
| Lines | ~95% | ~95% |

**Branches finally crosses 90%.** The hardest target is hit.

---

## Phase 7 — Remaining Small Gaps

**Goal:** Mop up the last few uncovered lines and branches.

**Estimated coverage delta:**
- Statements: +1% (≈5 stmts)
- Branches: +1.5% (≈5 branches)
- Functions: 0%
- Lines: +1%

### 7.1 — `migrate.ts:38-39`

Read the file, identify the uncovered branch, add a targeted test.

```typescript
// test/integration/migrate.test.ts (extend existing migrations.test.ts)

it("re-applies migration on partially migrated DB", async () => {
  // Setup: create a partial state, then run migrations again
  const { conn, db } = await freshConn("migrate-partial");
  // Drop a table that should exist after migration, then re-run
  await conn.run("DROP TABLE IF EXISTS messages");
  await runMigrations(conn);
  const out = await conn.runAndReadAll("SELECT count(*) FROM messages");
  expect(out.getRowObjects().length).toBeGreaterThan(0);
  conn.closeSync(); db.closeSync();
});
```

(The exact target depends on what's at lines 38-39 — read first, write test second.)

### 7.2 — `html-data.ts:66-68` (priceFor returns null branch)

Add to existing `test/integration/html-report.test.ts`:

```typescript
it("handles unknown model with no price entry", async () => {
  const { conn, db } = await freshConn("unknown-model");
  await insertMessage(conn, {
    ts: todayUtc(), model: "totally-unknown-model",
    input: 100, output: 50, cache_read: 1000,
  });
  const outPath = join(tmpDir, "report.html");
  await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

  const html = await readFile(outPath, "utf8");
  // Should still render — cost will be $0 for unknown model
  expect(html).toContain("totally-unknown-model");
  conn.closeSync(); db.closeSync();
});
```

### 7.3 — `html-template.ts:9, 354` (small token branch and final concatenation)

Add to existing `test/integration/html-report.test.ts`:

```typescript
it("renders correctly with small token counts (<1000)", async () => {
  const { conn, db } = await freshConn("small-tokens");
  await insertMessage(conn, {
    ts: todayUtc(), model: "model-a",
    input: 5, output: 3, cache_write: 0, cache_read: 0,
  });
  const outPath = join(tmpDir, "report.html");
  await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

  const html = await readFile(outPath, "utf8");
  // 5 + 3 = 8 (no K, M, B suffix)
  expect(html).toContain("\"input\":5");
  conn.closeSync(); db.closeSync();
});
```

### 7.4 — `html-template.ts` direct unit test (no DB)

```typescript
// test/unit/html-template.test.ts (NEW)

import { describe, it, expect } from "vitest";
import { buildHtmlTemplate } from "../../src/reports/html-template.js";
import type { HtmlReportData } from "../../src/reports/html-data.js";

describe("buildHtmlTemplate", () => {
  it("renders a valid HTML document with empty data", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [
        { label: "Today", period: "today", rows: [], models: [], totalGen: 0, totalAll: 0, totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0, turns: 0 },
        { label: "This Week", period: "week", rows: [], models: [], totalGen: 0, totalAll: 0, totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0, turns: 0 },
        { label: "This Month", period: "month", rows: [], models: [], totalGen: 0, totalAll: 0, totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0, turns: 0 },
        { label: "This Quarter", period: "quarter", rows: [], models: [], totalGen: 0, totalAll: 0, totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0, turns: 0 },
        { label: "YTD", period: "ytd", rows: [], models: [], totalGen: 0, totalAll: 0, totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0, turns: 0 },
        { label: "LTD", period: "ltd", rows: [], models: [], totalGen: 0, totalAll: 0, totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0, turns: 0 },
      ],
    };

    const html = await buildHtmlTemplate(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    // Empty period should show "No data"
    expect(html).toContain("No data");
  });

  it("EUR currency renders € symbol", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "eur",
      periods: [],
    };
    const html = await buildHtmlTemplate(data);
    expect(html).toContain("€");
  });

  it("formats small token values without K/M/B suffix", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [{
        label: "Today", period: "today",
        rows: [{
          day: "2026-05-02", model: "m-a",
          input: 5, output: 3, cache_write: 0, cache_read: 0,
          total: 8, total_all: 8, turns: 1, cost: 0.001,
        }],
        models: ["m-a"], totalGen: 8, totalAll: 8,
        totalCacheRead: 0, totalCacheReadCost: 0, totalCost: 0.001, turns: 1,
      }],
    };
    const html = await buildHtmlTemplate(data);
    // Small numbers shown as raw, not formatted with K/M/B
    expect(html).toMatch(/>8</);
  });
});
```

### Phase 7 cumulative impact

| Metric | Phase 6 result | Phase 7 result |
|---|---|---|
| Statements | ~94% | ~95% |
| Branches | ~91% | ~92% |
| Functions | ~95% | ~96% |
| Lines | ~95% | ~96% |

---

## Per-Phase Coverage Estimates

Cumulative coverage projection. **Bold** = passes 90%.

| After phase | Stmts | Branches | Funcs | Lines |
|---|---|---|---|---|
| Baseline | 78.5% | 54.6% | 70.0% | 81.2% |
| + Phase 1 (pure-fn unit) | ~84% | ~60% | ~84% | ~86% |
| + Phase 2 (queries.ts) | ~89% | ~70% | ~92% | ~91% |
| + Phase 3 (render commands) | **~92%** | ~78% | **~93%** | **~94%** |
| + Phase 4 (loader.ts) | **~93%** | ~82% | **~95%** | **~95%** |
| + Phase 5 (config.ts errors) | **~93%** | ~86% | **~95%** | **~95%** |
| + Phase 6 (html-queries branches) | **~94%** | **~91%** | **~95%** | **~95%** |
| + Phase 7 (mop up) | **~95%** | **~92%** | **~96%** | **~96%** |

Statements pass 90% after Phase 3.
Lines pass 90% after Phase 3.
Functions pass 90% after Phase 2.
**Branches** — the hardest — passes 90% only after Phase 6.

If estimates are off by ±2%, all targets still cleared by end of Phase 7.

---

## Test Patterns & Conventions

### Pattern 1 — Fresh DuckDB per test

```typescript
let tmpDir: string;

async function freshConn(name: string): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
  const db = await DuckDBInstance.create(join(tmpDir, `${name}.duckdb`));
  const conn = await db.connect();
  await runMigrations(conn);
  return { db, conn };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-PHASE-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
```

Always call `conn.closeSync()` and `db.closeSync()` at the end of each test, even on failure (use try/finally if necessary). DuckDB instances leak file handles otherwise.

### Pattern 2 — `insertMessage` helper

Standardized across all integration tests:

```typescript
async function insertMessage(
  conn: DuckDBConnection,
  opts: {
    ts: string;          // "YYYY-MM-DD HH:MM:SS" or ISO8601
    model: string;
    input: number;
    output: number;
    cache_write?: number; // default 0
    cache_read?: number;  // default 0
    session_id?: string;  // default "test-session"
    project_cwd?: string; // default "/test"
  },
): Promise<void> {
  const {
    ts, model, input, output,
    cache_write = 0, cache_read = 0,
    session_id = "test-session",
    project_cwd = "/test",
  } = opts;
  await conn.run(
    `INSERT INTO messages (id, session_id, project_cwd, ts, model, source,
       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (gen_random_uuid(), ?, ?, ?::TIMESTAMP, ?, 'test', ?, ?, ?, ?)`,
    [session_id, project_cwd, ts, model, input, output, cache_write, cache_read],
  );
}
```

**Note:** if duplication grows past three test files, extract to `test/integration/_helpers.ts`.

### Pattern 3 — Module cache busting for env-dependent modules

Modules that read `process.env.HOME` or other globals at import-time cache the values. To re-import with a fresh env:

```typescript
process.env["HOME"] = newHome;
const mod = await import(`../../src/some/module.js?t=${Date.now()}`);
const result = await (mod as any).someFn();
```

The `?t=${Date.now()}` query parameter forces a fresh module instantiation.

### Pattern 4 — Error assertion

vitest's `.rejects.toThrow()` works on async functions returning promises:

```typescript
await expect(asyncFn()).rejects.toThrow(/expected message pattern/);
```

For sync errors:

```typescript
expect(() => syncFn()).toThrow();
```

### Pattern 5 — Date-sensitive tests

Avoid hardcoded dates that will go stale. Use:
- `today` / `daysAgo(n)` helpers (defined per-file)
- `new Date(Date.UTC(YYYY, MM-1, DD))` for explicit UTC dates (note: month is 0-indexed)
- For unit tests of pure date helpers: hardcoded UTC dates are fine — they don't go stale.

For tests that need "now" to be a specific time:

```typescript
import { vi } from "vitest";

vi.useFakeTimers();
vi.setSystemTime(new Date("2026-05-02T12:00:00Z"));
// ... test code that calls new Date() ...
vi.useRealTimers();
```

**Caveat:** Faking the JS clock does NOT affect `CURRENT_DATE` / `NOW()` inside DuckDB. For DuckDB-time tests, use parameterized timestamps in the SQL or insert data with explicit timestamps relative to real now.

### Pattern 6 — Cost assertion

Costs are floating-point — use `.toBeCloseTo(expected, decimals)`:

```typescript
expect(cost).toBeCloseTo(15.0, 4);
```

### Pattern 7 — Currency-formatted strings

`Intl.NumberFormat` output is locale-dependent. Don't assert exact formats; assert digits are present and currency symbol is present:

```typescript
expect(out).toMatch(/12[.,]34/);   // dot or comma decimal sep
expect(out).toMatch(/[$€]/);       // currency symbol
```

---

## Refactor Required

Only one source-code change is required for this plan: exporting helpers in `src/reports/html-queries.ts`.

### Diff

```diff
--- a/src/reports/html-queries.ts
+++ b/src/reports/html-queries.ts
@@ -5,21 +5,21 @@ export interface HtmlDayRow extends DayRow {
   turns: number;
 }
 
-function weekStart(now: Date): Date {
+export function weekStart(now: Date = new Date()): Date {
   const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
   const dow = d.getUTCDay();
   const diff = dow === 0 ? 6 : dow - 1;
   d.setUTCDate(d.getUTCDate() - diff);
   return d;
 }
 
-function monthStart(now: Date): Date {
+export function monthStart(now: Date = new Date()): Date {
   return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
 }
 
-function quarterStart(now: Date): Date {
+export function quarterStart(now: Date = new Date()): Date {
   const m = now.getUTCMonth();
   const qm = Math.floor(m / 3) * 3;
   return new Date(Date.UTC(now.getUTCFullYear(), qm, 1));
 }
 
-function tomorrow(now: Date): Date {
+export function tomorrow(now: Date = new Date()): Date {
   return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
 }
```

This is purely additive — `export` plus default parameter. All existing callers keep working unchanged because they pass `now` explicitly.

**Verification:** `npm test` after refactor → still green.

---

## Risks & Open Questions

### Risk 1 — `process.env.HOME` mutation across tests

Tests that mutate `process.env.HOME` can leak the change to other tests if they don't clean up. Mitigations:

- Always restore in `afterEach`.
- Use `vitest`'s isolated test pool: in `vitest.config.ts`, set `pool: "forks"` to give each test file its own worker process. Already the default for vitest 4.x — verify.
- If isolation fails, inline the test pattern:

```typescript
const originalHome = process.env["HOME"];
try {
  process.env["HOME"] = testHome;
  // ... test ...
} finally {
  process.env["HOME"] = originalHome;
}
```

### Risk 2 — `vitest.setSystemTime` does not affect DuckDB

DuckDB's `CURRENT_DATE` and `NOW()` use the OS wall clock, not the JS `Date.now()`. Tests that rely on `CURRENT_DATE` semantics (e.g., `queryYTD`, `queryReport`) cannot use fake timers to test "what if today is Dec 31?".

Mitigations:
- Use the integration tests' approach: insert data at explicit timestamps relative to real `new Date()` and assert the filter behavior, not the absolute date.
- For pure-JS date logic (the helpers in Phase 6), fake timers work fine.

### Risk 3 — Coverage of `src/cli.ts`

`cli.ts` uses `commander` and orchestrates many commands. It's not currently in the coverage report breakdown — likely because `vitest` doesn't import it during tests. If we want coverage on it:
- Add a test that calls `program.parseAsync(["node", "cli.js", "today"])` etc.
- Risk: the commands call `openReader()` which assumes `~/.claude-tokenstein/tokens.duckdb` exists.
- **Defer.** Coverage of CLI plumbing is low-value vs. coverage of report logic. Let it stay outside the 90% denominator.

### Risk 4 — Coverage of `src/mcp/server.ts`

Same as cli.ts — it's an orchestration shim around tested logic. Defer.

### Risk 5 — Windows-specific branches in `config.ts`

Line 28 (`if (process.platform !== "win32")`) is a branch. On a Mac/Linux test runner, the `false` arm (Windows path) is unreachable without mocking `process.platform`. Mocking it is fragile (it's a getter on a frozen object).

Mitigation: accept the single uncovered branch on POSIX runners. Document that CI on Windows would cover it.

### Risk 6 — `cli.ts` browser-open code path

The `--open` flag spawns `open` / `xdg-open` / `start` via `child_process.exec`. Cannot be cleanly tested without spawning a process. Defer; coverage is in cli.ts which is already deferred.

### Risk 7 — `paths.ts` HOME swap doesn't work because of top-level const

```typescript
const ROOT = join(homedir(), ".claude-tokenstein"); // read once at module load
```

When the tests mutate `process.env.HOME` and then `import` the module again with a cache-busting query string, vitest's module loader should treat it as a fresh module and re-execute the top-level. **Verify this works** by writing one test first and checking the assertion fires correctly. If it doesn't, fall back to:

```typescript
// In paths.ts — change to lazy:
export const dbPath = () => join(homedir(), ".claude-tokenstein", "tokens.duckdb");
```

— but only if the cache-busting trick fails. The current `const ROOT = ...` keeps things slightly faster.

### Open question 1 — Should we add a coverage threshold to CI?

Once we hit 90%, add to `vitest.config.ts`:

```typescript
test: {
  coverage: {
    thresholds: {
      lines: 90,
      branches: 90,
      functions: 90,
      statements: 90,
    },
  },
},
```

This will fail CI if coverage regresses below threshold. Recommended.

### Open question 2 — Do we want a separate "coverage" CI job?

Coverage runs are slower than plain tests. Options:
- (a) Always run with coverage (~10–20% slower).
- (b) Only run with coverage on PR / nightly.

Recommend (b) for now; flip to (a) once test suite is mature.

---

## Implementation Checklist

### Phase 1 — Pure-function unit tests
- [ ] Create `test/unit/errors.test.ts` (7 tests)
- [ ] Create `test/unit/paths.test.ts` (9 tests)
- [ ] Create `test/unit/format.test.ts` (15 tests)
- [ ] Create `test/unit/render.test.ts` (16 tests)
- [ ] Run `npm test` — verify all green
- [ ] Run `npm run coverage` — verify ≈84% statements

### Phase 2 — `queries.ts` integration tests
- [ ] Create `test/integration/queries.test.ts` (30 tests across 6 query functions)
- [ ] Run `npm test` — verify all green
- [ ] Run `npm run coverage` — verify ≈89% statements

### Phase 3 — Render command tests
- [ ] Create `test/integration/render-commands.test.ts` (25 tests across 5 render modules)
- [ ] Run `npm test` — verify all green
- [ ] Run `npm run coverage` — verify ≈92% statements

### Phase 4 — `pricing/loader.ts` tests
- [ ] Create `test/integration/loader.test.ts` (7 tests)
- [ ] Run `npm test` — verify all green
- [ ] Run `npm run coverage` — verify ≈93% statements

### Phase 5 — `config.ts` error paths
- [ ] Modify `test/unit/config.test.ts` — add 6 new tests for error paths
- [ ] Run `npm test` — verify all green
- [ ] Run `npm run coverage` — verify ≈86% branches

### Phase 6 — `html-queries.ts` branch coverage
- [ ] Modify `src/reports/html-queries.ts` — export `weekStart`, `monthStart`, `quarterStart`, `tomorrow` with default `now: Date = new Date()` parameter
- [ ] Modify `test/integration/html-queries.test.ts` — add helper unit tests (24 tests)
- [ ] Run `npm test` — verify all green (existing queryWeek/Month/Quarter tests must still pass)
- [ ] Run `npm run coverage` — **verify branches ≥ 90%**

### Phase 7 — Mop-up
- [ ] Read `src/db/migrate.ts:38-39` — write targeted test
- [ ] Add unknown-model test to `html-report.test.ts`
- [ ] Add small-token test to `html-report.test.ts`
- [ ] Create `test/unit/html-template.test.ts` — direct unit test for `buildHtmlTemplate`
- [ ] Run `npm test` — verify all green
- [ ] Run `npm run coverage` — **verify all four metrics ≥ 90%**

### Final sign-off
- [ ] `npm run coverage` → ≥ 90% on all four metrics
- [ ] `npm test` → 100% pass rate
- [ ] `npm run typecheck` → no NEW errors (pre-existing rootDir warnings OK)
- [ ] `npm run lint` → clean
- [ ] Review uncovered lines remaining → confirm they're all platform-specific or otherwise justified
- [ ] Add coverage threshold to `vitest.config.ts`
- [ ] Commit + push

---

## Out of Scope

The following are explicitly NOT part of this 90% coverage plan. They could be follow-up work but are expensive relative to coverage gain.

### Not included

1. **CLI process-spawning tests** — testing `cli.ts` end-to-end via subprocess. Would need a test harness that spawns Node, captures stdout, and asserts on output. The logic inside is already covered via direct calls to render commands.

2. **MCP stdio harness tests** — testing `src/mcp/server.ts` over an actual MCP transport. Would need a stdin/stdout pair and the MCP client SDK. Logic inside the handlers is already covered via the report commands they delegate to.

3. **Browser-side tests for HTML report** — Chart.js initialization, tab switching, responsive breakpoints. Would need Playwright or Puppeteer. Manual checklist in HTML-REPORT-PLAN.md is the existing coverage strategy.

4. **End-to-end ingest pipeline tests** — running `claude-tokenstein ingest` against a fixture transcript directory. Some ingest is covered by `test/integration/ingest-claude-code.test.ts`; deeper E2E (orchestrator + lockfile + admin API stub) is large surface for incremental gain.

5. **FX rate fetcher tests** — `src/pricing/fx.ts` hits an external service. Would need a mock HTTP server (msw or similar). Defer until we add network tests across the codebase.

6. **`bin/claude-tokenstein.js`** — a five-line bootstrap that loads tsx and calls `cli.ts`. Coverage is meaningless here.

7. **Performance / benchmark tests** — coverage is not the same as performance.

### Possibly worth following up later

- **Mutation testing** with Stryker. 90% line coverage doesn't tell you much about test quality. Mutation testing kills weak tests but takes hours to run.
- **Snapshot tests for HTML report output.** Useful but high-maintenance — every CSS tweak breaks snapshots.
- **Property-based tests** (fast-check) for the query functions — interesting because the SQL has many edge cases (timezones, leap days, ISO weeks).

---

## Estimated Effort

| Phase | Files touched | Tests added | Coding time | Coverage delta |
|---|---|---|---|---|
| 1 | 4 new | 47 | 1.5 hr | +5.5% stmts |
| 2 | 1 new | 30 | 2.0 hr | +5.0% stmts |
| 3 | 1 new | 25 | 1.5 hr | +3.0% stmts |
| 4 | 1 new | 7 | 0.5 hr | +1.5% stmts |
| 5 | 1 modified | 6 | 0.5 hr | +3.5% branches |
| 6 | 1 modified src + 1 modified test | 24 | 1.0 hr | +6.5% branches |
| 7 | 1 new + 1 modified | 5 | 0.5 hr | +1.0% stmts |
| **Total** | **9 files** | **144 tests** | **~7.5 hr** | **+16% stmts, +37% branches** |

---

## Summary

This plan moves test coverage from 78.5%/54.6%/70%/81.2% to ≥90% across all four metrics over 7 phases, ~7.5 hours of focused work, adding 144 tests across 9 files.

The branch coverage gap is the binding constraint — Phases 5 and 6 are critical for hitting 90% branches, while Phases 1–3 do most of the statement and function lift.

Only one small source-code refactor is required (exporting four date-math helpers in `html-queries.ts` with default parameters). Everything else is pure test addition.

After Phase 7 lands, add a 90% threshold to `vitest.config.ts` to prevent regressions.
