// The calendar helpers must give the person's own calendar days, also across the night the clocks change.
import { afterEach, describe, expect, it } from "vitest";
import { localDayAfter, startOfLocalDay } from "./dates";

const originalTimeZone = process.env.TZ;

// Node reads TZ again when it is assigned, so a test can pick the time zone it needs.
function useTimeZone(timeZone: string): void {
  process.env.TZ = timeZone;
}

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe("localDayAfter", () => {
  it("adds calendar days", () => {
    useTimeZone("America/New_York");

    expect(localDayAfter(new Date(2026, 9, 31, 10, 0), 7)).toBe("2026-11-07");
  });

  it("is not thrown off by clocks going forward (a 23-hour day)", () => {
    useTimeZone("America/New_York");
    const lateOnSaturday = new Date(2026, 2, 7, 23, 30); // the clocks go forward on Sunday 8 March

    expect(localDayAfter(lateOnSaturday, 1)).toBe("2026-03-08");
  });

  it("is not thrown off by clocks going back (a 25-hour day)", () => {
    useTimeZone("America/New_York");
    const justAfterMidnight = new Date(2026, 10, 1, 0, 30); // the clocks go back on Sunday 1 November

    expect(localDayAfter(justAfterMidnight, 1)).toBe("2026-11-02");
  });
});

describe("startOfLocalDay", () => {
  it("is local midnight, written as a UTC timestamp", () => {
    useTimeZone("America/New_York");

    expect(startOfLocalDay(new Date(2026, 9, 31, 15, 45))).toBe("2026-10-31T04:00:00.000Z");
  });
});
