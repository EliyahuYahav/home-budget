import Link from "next/link";
import type { ReactNode } from "react";
import { formatILS } from "@/lib/budget";
import { monthLabel, shiftMonth } from "@/lib/dates";
import { ChevronEnd, ChevronStart } from "./icons";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 ${className}`}>{children}</section>
  );
}

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={`num ${className}`}>{formatILS(amount)}</span>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <header className="space-y-2">
      <h1 className="font-display text-5xl font-bold leading-none">{children}</h1>
      <div className="dots text-accent" aria-hidden="true" />
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-bold">{children}</h2>;
}

const BAR_COLORS = { ok: "bg-accent", good: "bg-good", warning: "bg-warn", over: "bg-danger" };

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
      className="h-1.5 overflow-hidden rounded-full bg-line"
    >
      <div className={`h-full rounded-full ${BAR_COLORS[status]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Previous / next month arrows around the current month's name. */
export function MonthNav({ month, basePath }: { month: string; basePath: string }) {
  const link = "panel flex size-11 items-center justify-center rounded-full";
  return (
    <nav aria-label="בחירת חודש" className="flex items-center justify-between gap-2">
      <Link className={link} href={`${basePath}?m=${shiftMonth(month, -1)}`} aria-label="החודש הקודם">
        <ChevronStart />
      </Link>
      <span className="font-display text-3xl font-bold">{monthLabel(month)}</span>
      <Link className={link} href={`${basePath}?m=${shiftMonth(month, 1)}`} aria-label="החודש הבא">
        <ChevronEnd />
      </Link>
    </nav>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-3xl border border-dashed border-line p-5 text-center text-muted">
      {children}
    </p>
  );
}
