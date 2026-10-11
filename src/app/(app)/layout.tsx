import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="mx-auto max-w-2xl space-y-4 p-4 pb-24">{children}</main>
      <BottomNav />
    </>
  );
}
