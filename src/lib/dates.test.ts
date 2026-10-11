import { describe, expect, it } from "vitest";
import {
  daysLeftInMonth,
  isValidDate,
  isValidMonth,
  monthRange,
  shiftDate,
  shiftMonth,
  todayISO,
} from "./dates";

describe("dates", () => {
  it("uses Israel time for today", () => {
    // 22:30 UTC on the 10th is already the 11th in Israel.
    expect(todayISO(new Date("2026-10-10T22:30:00Z"))).toBe("2026-10-11");
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
  });

  it("shifts days across month boundaries", () => {
    expect(shiftDate("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("counts days left including today", () => {
    expect(daysLeftInMonth("2026-10", "2026-10-31")).toBe(1);
    expect(daysLeftInMonth("2026-10", "2026-10-01")).toBe(31);
    expect(daysLeftInMonth("2026-09", "2026-10-11")).toBe(0);
    expect(daysLeftInMonth("2026-11", "2026-10-11")).toBe(30);
  });

  it("validates months and dates", () => {
    expect(isValidMonth("2026-10")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth(undefined)).toBe(false);
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("yesterday")).toBe(false);
  });
});
