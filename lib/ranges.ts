/**
 * Date range handling, shared by the history screen and the exports.
 * Pure functions with no server dependencies, so both sides can use them.
 */

export type RangePreset = "today" | "week" | "month" | "last-month" | "all" | "custom";

export interface Range {
  from: string; // inclusive, ISO
  to: string;   // inclusive, ISO
  label: string;
}

const iso = (d: Date) => d.toISOString();

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

export function resolveRange(
  preset: RangePreset,
  customFrom?: string,
  customTo?: string
): Range {
  const now = new Date();

  switch (preset) {
    case "today":
      return { from: iso(startOfDay(now)), to: iso(endOfDay(now)), label: "Today" };

    case "week": {
      const from = startOfDay(new Date(now));
      from.setDate(from.getDate() - 6);
      return { from: iso(from), to: iso(endOfDay(now)), label: "Last 7 days" };
    }

    case "month": {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      return { from: iso(from), to: iso(endOfDay(now)), label: "This month" };
    }

    case "last-month": {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return {
        from: iso(from),
        to: iso(to),
        label: from.toLocaleDateString("en-NG", { month: "long", year: "numeric" }),
      };
    }

    case "custom": {
      const from = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(now);
      const to = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
      return {
        from: iso(from),
        to: iso(to),
        label: `${from.toLocaleDateString("en-NG")} to ${to.toLocaleDateString("en-NG")}`,
      };
    }

    case "all":
    default:
      return {
        from: iso(new Date("2020-01-01")),
        to: iso(endOfDay(now)),
        label: "All time",
      };
  }
}

export const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "all", label: "All time" },
];
