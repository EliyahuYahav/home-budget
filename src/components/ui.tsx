import Link from "next/link";
import type { ReactNode } from "react";
import { formatILS } from "@/lib/budget";
import { monthLabel, shiftMonth } from "@/lib/dates";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-4 ${className}`}>{children}</section>
  );
}

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={`num ${className}`}>{formatILS(amount)}</span>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-bold">{children}</h1>;
}

const BAR_COLORS = { ok: "bg-accent", warning: "bg-warn", over: "bg-danger" };

export function ProgressBar({
  ratio,
  status = "ok",
  label,
}: {
  ratio: number;
  status?: keyof typeof BAR_COLORS;
  label: string;
}) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 overflow-hidden rounded-full bg-line"
    >
      <div className={`h-full rounded-full ${BAR_COLORS[status]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Previous / next month links around the current month's name. */
export function MonthNav({ month, basePath }: { month: string; basePath: string }) {
  const link = "rounded-lg border border-line px-3 py-1.5 text-sm";
  return (
    <nav aria-label="בחירת חודש" className="flex items-center justify-between gap-2">
      <Link className={link} href={`${basePath}?m=${shiftMonth(month, -1)}`}>
        החודש הקודם
      </Link>
      <span className="font-semibold">{monthLabel(month)}</span>
      <Link className={link} href={`${basePath}?m=${shiftMonth(month, 1)}`}>
        החודש הבא
      </Link>
    </nav>
  );
}
