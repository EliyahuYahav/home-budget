"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BudgetIcon, ChatIcon, HomeIcon, ListIcon, TrendsIcon } from "./icons";

const TABS = [
  { href: "/", label: "בית", Icon: HomeIcon },
  { href: "/transactions", label: "הוצאות", Icon: ListIcon },
  { href: "/chat", label: "בוט", Icon: ChatIcon, primary: true },
  { href: "/budget", label: "תקציב", Icon: BudgetIcon },
  { href: "/trends", label: "מגמות", Icon: TrendsIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg items-end px-1">
        {TABS.map(({ href, label, Icon, primary }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-xs ${
                  active ? "font-bold text-accent" : "text-muted"
                }`}
              >
                {primary ? (
                  // The bot is how most expenses get in, so it stands above the bar.
                  <span className="-mt-6 flex size-13 items-center justify-center rounded-full bg-accent text-accent-ink ring-4 ring-bg">
                    <Icon />
                  </span>
                ) : (
                  <Icon />
                )}
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
