import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";

// Shown only while the Supabase keys are missing from .env.local.
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">נשאר לחבר את מסד הנתונים</h1>
      <Card className="space-y-3 leading-relaxed">
        <ol className="list-decimal space-y-2 ps-5">
          <li>פותחים פרויקט חינמי ב־Supabase.</li>
          <li>
            ב־SQL Editor מריצים את הקובץ <code className="num">supabase/schema.sql</code>.
          </li>
          <li>
            מעתיקים את <code className="num">.env.example</code> ל־<code className="num">.env.local</code>{" "}
            וממלאים את כתובת הפרויקט ואת המפתח.
          </li>
          <li>מפעילים מחדש את השרת.</li>
        </ol>
        <p className="text-sm text-muted">ההסבר המלא נמצא בקובץ README.md.</p>
      </Card>
    </main>
  );
}
