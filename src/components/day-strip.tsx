import { formatILS } from "@/lib/budget";

/**
 * The month as one bar per day: how much went on day-to-day spending each day.
 * Days above the planned daily amount are tinted; days still ahead are dots.
 * Drawn for the hero panel, so it uses the hero's ink colour.
 */
export function DayStrip({
  days,
  todayIndex,
  plannedPerDay,
}: {
  days: number[];
  /** Index of today in `days`, or -1 when the month shown is not the current one. */
  todayIndex: number;
  plannedPerDay: number;
}) {
  const scale = Math.max(plannedPerDay * 1.6, ...days, 1);
  const lastPast = todayIndex === -1 ? days.length - 1 : todayIndex;
  const spentDays = days.slice(0, lastPast + 1);
  const overDays = spentDays.filter((d) => plannedPerDay > 0 && d > plannedPerDay).length;
  const summary =
    `הוצאות יומיות החודש: ${spentDays.filter((d) => d > 0).length} ימים עם הוצאה, ` +
    `${overDays} מהם מעל ${formatILS(plannedPerDay)} ליום.`;

  return (
    <div>
      <div role="img" aria-label={summary} className="flex h-14 items-end gap-[3px]">
        {days.map((amount, i) => {
          const future = i > lastPast;
          const over = plannedPerDay > 0 && amount > plannedPerDay;
          const height = future || amount === 0 ? 4 : Math.max(8, Math.round((amount / scale) * 100));
          return (
            <span
              key={i}
              className={`flex-1 rounded-full ${
                future
                  ? "bg-hero-ink/25"
                  : amount === 0
                    ? "bg-hero-ink/45"
                    : over
                      ? "bg-[#ffc978]"
                      : "bg-hero-ink"
              } ${i === todayIndex ? "outline outline-2 outline-offset-2 outline-hero-ink/70" : ""}`}
              style={{ height: future || amount === 0 ? "4px" : `${height}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-hero-ink/70">
        <span className="num">1</span>
        <span>{overDays > 0 ? "בכתום: ימים מעל הסכום היומי" : "הוצאות יום־יום, לפי ימים"}</span>
        <span className="num">{days.length}</span>
      </div>
    </div>
  );
}
