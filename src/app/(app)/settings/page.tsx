import Link from "next/link";
import {
  addRecurringIncome,
  deleteRecurringIncome,
  signOut,
  updateDisplayName,
} from "@/app/actions";
import { CopyCode } from "@/components/copy-code";
import { ChevronEnd } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { VersionRow } from "@/components/version-row";
import { Card, Money, PageTitle, SectionTitle } from "@/components/ui";
import { getMembers, getRecurringIncomes, requireContext } from "@/lib/data";
import { ClaudeKeyForm } from "@/components/claude-key-form";
import { resolveClaudeKey } from "@/lib/claude-key";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import packageInfo from "../../../../package.json";

export default async function SettingsPage() {
  const ctx = await requireContext();
  const [incomes, members, claudeKey] = await Promise.all([
    getRecurringIncomes(ctx),
    getMembers(ctx),
    resolveClaudeKey(ctx),
  ]);
  const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);

  return (
    <>
      <PageTitle>הגדרות</PageTitle>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <SectionTitle>הכנסות קבועות</SectionTitle>
          <Money amount={totalIncome} className="font-bold" />
        </div>
        <p className="text-sm text-muted">
          משכורות וכל מה שנכנס כל חודש. הכנסה חד־פעמית (בונוס, החזר) רושמים בבוט או במסך ההוצאות.
        </p>
        {incomes.length > 0 && (
          <ul className="divide-y divide-line">
            {incomes.map((income) => (
              <li key={income.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>{income.name}</span>
                <span className="flex items-center gap-3">
                  <Money amount={income.amount} className="font-bold" />
                  <form action={deleteRecurringIncome}>
                    <input type="hidden" name="id" value={income.id} />
                    <SubmitButton className="text-sm font-semibold text-danger underline" pendingLabel="מסיר…">
                      הסרה
                    </SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form action={addRecurringIncome} className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-semibold">שם</span>
            <input className="field" name="name" placeholder="משכורת" required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">סכום חודשי</span>
            <input className="field num" name="amount" inputMode="decimal" required />
          </label>
          <SubmitButton className="btn col-span-2" pendingLabel="מוסיף…">
            הוספת הכנסה
          </SubmitButton>
        </form>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>{ctx.household.name}</SectionTitle>
        <p className="text-muted">חברים: {members.map((m) => m.display_name).join(", ")}</p>
        <div className="space-y-2 rounded-2xl bg-accent-soft p-4">
          <p className="text-sm font-semibold">קוד הזמנה לבן או בת הזוג</p>
          <CopyCode code={ctx.household.invite_code} />
          <p className="text-sm text-muted">
            {'נרשמים באתר עם אימייל משלהם, ובמסך הפתיחה בוחרים "הצטרפות עם קוד הזמנה".'}
          </p>
        </div>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>הבוט ו־Claude</SectionTitle>
        <p className="text-muted">
          {claudeKey.source === "household" ? (
            <>
              הבוט עובד עם המפתח שלכם (מסתיים ב־<span className="num">{claudeKey.hint}</span>), והשימוש מחויב
              בחשבון ה־Anthropic שלכם.
            </>
          ) : claudeKey.source === "shared" ? (
            "הבוט עובד עם המפתח של מי שמפעיל את האתר, עד 150 הודעות ביום. עם מפתח משלכם אין הגבלה."
          ) : (
            "הבוט פועל בזיהוי בסיסי, בלי Claude: הוא מבין הודעות פשוטות כמו \"סופר 230\", אבל לא שאלות או ניסוחים חופשיים."
          )}
        </p>
        {claudeKey.unreadable && (
          <p className="rounded-2xl bg-warn-soft p-3 text-sm">
            שמור אצלכם מפתח (מסתיים ב־<span className="num">{claudeKey.hint}</span>), אבל האתר לא מצליח לפתוח
            אותו. שמרו אותו מחדש.
          </p>
        )}
        <ClaudeKeyForm hasKey={claudeKey.source === "household" || claudeKey.unreadable} canSave={isSecretBoxConfigured()} />
        <p className="text-sm text-muted">
          <Link href="/help#claude-key" className="font-semibold text-accent underline">
            איך משיגים מפתח, צעד אחר צעד
          </Link>
          . המפתח נשמר מוצפן ולא מוצג שוב. הודעה לבוט עולה בערך אלפית שקל.
          {!isSecretBoxConfigured() && " שמירת מפתחות עוד לא הוגדרה באתר הזה."}
        </p>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>החשבון שלי</SectionTitle>
        <form action={updateDisplayName} className="flex items-end gap-3">
          <label className="flex-1 space-y-1">
            <span className="text-sm font-semibold">השם שלי</span>
            <input className="field" name="displayName" defaultValue={ctx.displayName} required />
          </label>
          <SubmitButton className="btn btn-quiet">שמירה</SubmitButton>
        </form>
        <form action={signOut}>
          <SubmitButton className="btn btn-danger w-full" pendingLabel="יוצא…">
            יציאה מהחשבון
          </SubmitButton>
        </form>
      </Card>

      <Link href="/help" className="panel flex items-center justify-between p-4 font-bold">
        <span>הסבר והדרכה</span>
        <ChevronEnd className="text-muted" />
      </Link>

      <VersionRow version={packageInfo.version} />
    </>
  );
}
