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
