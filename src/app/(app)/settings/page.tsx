import Link from "next/link";
import {
  addNextMonthPayer,
  addRecurringIncome,
  deleteRecurringIncome,
  removeNextMonthPayer,
  signOut,
  updateDisplayName,
} from "@/app/actions";
import { CopyCode } from "@/components/copy-code";
import { ChevronEnd } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { VersionRow } from "@/components/version-row";
import { Card, Money, PageTitle, SectionTitle } from "@/components/ui";
import { getMembers, getNextMonthPayers, getRecentBankPayers, getRecurringIncomes, requireContext } from "@/lib/data";
import { shiftDate, todayISO } from "@/lib/dates";
import { ClaudeKeyForm } from "@/components/claude-key-form";
import { resolveClaudeKey } from "@/lib/claude-key";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import packageInfo from "../../../../package.json";

export default async function SettingsPage() {
  const ctx = await requireContext();
  const [incomes, members, claudeKey, nextMonthPayers, recentPayers] = await Promise.all([
    getRecurringIncomes(ctx),
    getMembers(ctx),
    resolveClaudeKey(ctx),
    getNextMonthPayers(ctx),
    getRecentBankPayers(ctx, shiftDate(todayISO(), -120)),
  ]);
  const payerSuggestions = recentPayers.filter(
    (name) => !nextMonthPayers.some((payer) => name.toLowerCase().includes(payer.toLowerCase())),
  );
  const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);

  return (
    <>
      <PageTitle>הגדרות</PageTitle>

      <Card tour="settings-incomes" className="space-y-3">
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
        <SectionTitle>משכורת שנכנסת בסוף החודש</SectionTitle>
        <p className="text-sm text-muted">
          יש משכורות שנכנסות לפעמים ב־31 ולפעמים ב־1, והן הכסף של החודש שמתחיל. כשמסמנים כאן ממי המשכורת,
          הסנכרון מהבנק רושם אותה על ה־1 בחודש הבא אם היא נכנסה בשלושת הימים האחרונים של החודש. הכנסות
          ממקורות אחרים נשארות בתאריך שלהן.
        </p>
        {nextMonthPayers.length > 0 && (
          <ul className="divide-y divide-line">
            {nextMonthPayers.map((payer) => (
              <li key={payer} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate">{payer}</span>
                <form action={removeNextMonthPayer}>
                  <input type="hidden" name="payer" value={payer} />
                  <SubmitButton className="text-sm font-semibold text-danger underline" pendingLabel="מסיר…">
                    הסרה
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {payerSuggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">מי שהכניס כסף לחשבון לאחרונה. לחיצה מסמנת:</p>
            <div className="flex flex-wrap gap-2">
              {payerSuggestions.map((name) => (
                <form key={name} action={addNextMonthPayer}>
                  <input type="hidden" name="payer" value={name} />
                  <SubmitButton
                    className="max-w-full truncate rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold"
                    pendingLabel="מסמן…"
                  >
                    + {name}
                  </SubmitButton>
                </form>
              ))}
            </div>
          </div>
        )}
        <form action={addNextMonthPayer} className="flex items-end gap-3">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-sm font-semibold">או חלק מהתיאור, כפי שהוא מופיע בבנק</span>
            <input className="field" name="payer" placeholder="למשל: משרד הביטחון" minLength={2} maxLength={100} required />
          </label>
          <SubmitButton className="btn btn-quiet" pendingLabel="מוסיף…">
            הוספה
          </SubmitButton>
        </form>
        <p className="text-sm text-muted">
          משכורות שכבר נרשמו יעברו לחודש הנכון בסנכרון הבא שקורא אותן. אם הסוכן רץ, הוא ייקח את השינוי
          בריצה הבאה.
        </p>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>{ctx.household.name}</SectionTitle>
        <p className="text-muted">חברים: {members.map((m) => m.display_name).join(", ")}</p>
        <div className="space-y-2 rounded-2xl bg-accent-soft p-4" data-tour="settings-invite">
          <p className="text-sm font-semibold">קוד הזמנה לבן או בת הזוג</p>
          <CopyCode code={ctx.household.invite_code} />
          <p className="text-sm text-muted">
            {'נרשמים באתר עם אימייל משלהם, ובמסך הפתיחה בוחרים "הצטרפות עם קוד הזמנה".'}
          </p>
        </div>
      </Card>

      <Card tour="settings-claude" className="space-y-3">
        <SectionTitle>הבוט ו־Claude</SectionTitle>
        <p className="text-muted">
          {claudeKey.apiKey ? (
            <>
              הבוט עובד עם המפתח שלכם (מסתיים ב־<span className="num">{claudeKey.hint}</span>), והשימוש מחויב
              בחשבון ה־Anthropic שלכם.
            </>
          ) : (
            "הבוט פועל בזיהוי בסיסי: הוא מבין הודעות פשוטות כמו \"סופר 230\", אבל לא שאלות או ניסוחים חופשיים. כדי שיבין הכול, מוסיפים מפתח Claude משלכם."
          )}
        </p>
        {claudeKey.unreadable && (
          <p className="rounded-2xl bg-warn-soft p-3 text-sm">
            שמור אצלכם מפתח (מסתיים ב־<span className="num">{claudeKey.hint}</span>), אבל האתר לא מצליח לפתוח
            אותו. שמרו אותו מחדש.
          </p>
        )}
        <ClaudeKeyForm hasKey={claudeKey.hint !== null} canSave={isSecretBoxConfigured()} />
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

      <Link href="/help" data-tour="settings-help" className="panel flex items-center justify-between p-4 font-bold">
        <span>הסבר והדרכה</span>
        <ChevronEnd className="text-muted" />
      </Link>

      <VersionRow version={packageInfo.version} />
    </>
  );
}
