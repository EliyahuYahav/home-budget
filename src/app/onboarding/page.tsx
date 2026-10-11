import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForms } from "./forms";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: member } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (member) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <header>
        <h1 className="font-display text-4xl font-bold">כמעט שם</h1>
        <p className="mt-1 text-muted">
          פותחים משק בית חדש, או מצטרפים לזה שבן או בת הזוג כבר פתחו.
        </p>
      </header>
      <OnboardingForms />
    </main>
  );
}
