import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { getSyncState } from "./actions";
import { SyncPanel } from "./sync-panel";

// Reached by tapping the version line in the settings seven times. The hiding is only to keep
// it out of the way: what protects it is the sign-in, like every other screen.
export default async function DeveloperPage() {
  const state = await getSyncState();
  return (
    <>
      <PageTitle>אפשרויות מפתחים</PageTitle>
      <SyncPanel initialState={state} />
      <Link href="/settings" className="block text-center font-semibold text-accent">
        חזרה להגדרות
      </Link>
    </>
  );
}
