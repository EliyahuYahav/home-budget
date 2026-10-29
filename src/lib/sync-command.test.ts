import { describe, expect, it } from "vitest";
import { describeLastRun, parseSyncCommand, planSyncRequest, type SyncSnapshot } from "./sync-command";

const NOW = Date.parse("2026-10-29T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const ready: SyncSnapshot = {
  agentSeenAt: minutesAgo(0.2),
  hasLogins: true,
  lastRun: { status: "done", dry_run: false, output: "", created_at: minutesAgo(600), finished_at: minutesAgo(595) },
};

describe("parseSyncCommand", () => {
  it("recognises the plain command in its common forms", () => {
    for (const text of ["סנכרן", "תסנכרן", "סנכרון", "לסנכרן", "תסנכרן!", "  סנכרן  ", "תעשה סנכרון", "סנכרן עם הבנק", "תסנכרן מהבנק בבקשה"]) {
      expect(parseSyncCommand(text), text).toEqual({ kind: "request", monthsBack: 1 });
    }
  });

  it("reads how far back to go", () => {
    expect(parseSyncCommand("סנכרן חודשיים")).toEqual({ kind: "request", monthsBack: 2 });
    expect(parseSyncCommand("תסנכרן חצי שנה אחורה")).toEqual({ kind: "request", monthsBack: 6 });
    expect(parseSyncCommand("סנכרון של 3 חודשים")).toEqual({ kind: "request", monthsBack: 3 });
    expect(parseSyncCommand("סנכרן שנה")).toEqual({ kind: "request", monthsBack: 12 });
    expect(parseSyncCommand("סנכרן חודש אחד")).toEqual({ kind: "request", monthsBack: 1 });
  });

  it("refuses a range outside 1 to 12 months", () => {
    expect(parseSyncCommand("סנכרן 13 חודשים")).toBeNull();
    expect(parseSyncCommand("סנכרן 0 חודשים")).toBeNull();
  });

  it("recognises a question about the last sync", () => {
    for (const text of ["מה עם הסנכרון", "מה עם הסנכרון?", "מצב הסנכרון", "סטטוס סנכרון", "איך הלך הסנכרון"]) {
      expect(parseSyncCommand(text), text).toEqual({ kind: "status" });
    }
  });

  it("leaves everything else to the bot", () => {
    for (const text of ["סופר 230", "בנק 50", "עמלת בנק 12", "סנכרן סופר 230", "למה הסנכרון לא עבד אתמול בלילה", "סנכרון היה אתמול", "", "הבנק"]) {
      expect(parseSyncCommand(text), text).toBeNull();
    }
  });
});

describe("planSyncRequest", () => {
  it("queues when the home computer is online and logins are saved", () => {
    const plan = planSyncRequest(ready, 6, NOW);
    expect(plan.queue).toBe(true);
    expect(plan.reply).toContain("חצי שנה");
  });

  it("does not queue without a connected home computer", () => {
    expect(planSyncRequest({ ...ready, agentSeenAt: null }, 1, NOW).queue).toBe(false);
  });

  it("does not queue when the home computer went quiet", () => {
    const plan = planSyncRequest({ ...ready, agentSeenAt: minutesAgo(30) }, 1, NOW);
    expect(plan.queue).toBe(false);
    expect(plan.reply).toContain("לפני 30 דקות");
  });

  it("does not queue without saved logins", () => {
    expect(planSyncRequest({ ...ready, hasLogins: false }, 1, NOW).queue).toBe(false);
  });

  it("does not queue a second request while one is waiting or running", () => {
    for (const status of ["queued", "running"] as const) {
      const lastRun = { ...ready.lastRun!, status, created_at: minutesAgo(2), finished_at: null };
      expect(planSyncRequest({ ...ready, lastRun }, 1, NOW).queue).toBe(false);
    }
  });

  it("queues after a failed run", () => {
    const lastRun = { ...ready.lastRun!, status: "failed" as const };
    expect(planSyncRequest({ ...ready, lastRun }, 1, NOW).queue).toBe(true);
  });
});

describe("describeLastRun", () => {
  it("says when nothing ran yet", () => {
    expect(describeLastRun({ ...ready, lastRun: null }, NOW)).toContain("עוד לא היה סנכרון");
  });

  it("reports a finished sync", () => {
    expect(describeLastRun(ready, NOW)).toContain("הסתיים בהצלחה");
  });

  it("reports a failure with the last line of the output", () => {
    const lastRun = { ...ready.lastRun!, status: "failed" as const, output: "max: reading…\n\nmax: TIMEOUT\n" };
    const text = describeLastRun({ ...ready, lastRun }, NOW);
    expect(text).toContain("נכשל");
    expect(text).toContain("max: TIMEOUT");
  });

  it("reports a running sync", () => {
    const lastRun = { ...ready.lastRun!, status: "running" as const, created_at: minutesAgo(3), finished_at: null };
    expect(describeLastRun({ ...ready, lastRun }, NOW)).toContain("לפני 3 דקות");
  });
});
