"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "בית" },
  { href: "/chat", label: "בוט" },
  { href: "/transactions", label: "הוצאות" },
  { href: "/budget", label: "תקציב" },
  { href: "/settings", label: "הגדרות" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`block py-3 text-center text-sm ${
                  active ? "font-bold text-accent" : "text-muted"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
