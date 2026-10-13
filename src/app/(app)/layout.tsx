import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Tour } from "@/components/tour";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="mx-auto max-w-lg space-y-4 p-4 pb-32">{children}</main>
      <BottomNav />
      <Tour />
    </>
  );
}
