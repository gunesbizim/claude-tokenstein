import { describe, it, expect } from "vitest";
import {
  weekStart,
  monthStart,
  quarterStart,
  tomorrow,
} from "../../src/reports/html-queries.js";

describe("weekStart", () => {
  it("returns the same date when input is Monday", () => {
    const monday = new Date(Date.UTC(2026, 0, 5)); // Jan 5 2026 is Monday
    expect(weekStart(monday).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("returns previous Monday when input is Wednesday", () => {
    const wed = new Date(Date.UTC(2026, 0, 7));
    expect(weekStart(wed).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("returns previous Monday when input is Sunday (dow === 0 branch)", () => {
    const sun = new Date(Date.UTC(2026, 0, 11));
    expect(weekStart(sun).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("returns previous Monday when input is Saturday", () => {
    const sat = new Date(Date.UTC(2026, 0, 10));
    expect(weekStart(sat).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("strips time-of-day from the input", () => {
    const wedNoon = new Date(Date.UTC(2026, 0, 7, 12, 34, 56));
    const result = weekStart(wedNoon);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it("crosses month boundary correctly (Mar 1 Sunday → Feb 23 Mon)", () => {
    const mar1 = new Date(Date.UTC(2026, 2, 1)); // Sunday
    expect(weekStart(mar1).toISOString().slice(0, 10)).toBe("2026-02-23");
  });

  it("crosses year boundary correctly", () => {
    const jan1_2027 = new Date(Date.UTC(2027, 0, 1)); // Friday
    const result = weekStart(jan1_2027);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-28");
  });

  it("default argument uses current Date", () => {
    const result = weekStart();
    expect(result instanceof Date).toBe(true);
    expect(result.getUTCDay()).toBe(1); // Monday
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

  it("default argument uses current Date", () => {
    const result = monthStart();
    expect(result instanceof Date).toBe(true);
    expect(result.getUTCDate()).toBe(1);
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

  it("default argument uses current Date", () => {
    const result = quarterStart();
    expect(result instanceof Date).toBe(true);
    expect(result.getUTCDate()).toBe(1);
    expect(result.getUTCMonth() % 3).toBe(0);
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

  it("default argument uses current Date", () => {
    const result = tomorrow();
    expect(result instanceof Date).toBe(true);
    expect(result.getUTCHours()).toBe(0);
  });
});
