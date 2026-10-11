import {
  addRecurringIncome,
  deleteRecurringIncome,
  signOut,
  updateDisplayName,
} from "@/app/actions";
import { Card, Money, PageTitle } from "@/components/ui";
import { getMembers, getRecurringIncomes, requireContext } from "@/lib/data";
import { isClaudeConfigured } from "@/lib/env";

export default async function SettingsPage() {
  const ctx = await requireContext();
  const [incomes, members] = await Promise.all([getRecurringIncomes(ctx), getMembers(ctx)]);
  const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);

  return (
    <>
      <PageTitle>הגדרות</PageTitle>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">הכנסות קבועות</h2>
          <Money amount={totalIncome} className="text-sm" />
        </div>
        <p className="text-sm text-muted">
          משכורות וכל מה שנכנס כל חודש. הכנסה חד־פעמית (בונוס, החזר) רושמים בבוט או במסך ההוצאות.
        </p>
        {incomes.length > 0 && (
          <ul className="divide-y divide-line">
            {incomes.map((income) => (
              <li key={income.id} className="flex items-center justify-between gap-3 py-2">
                <span>{income.name}</span>
                <span className="flex items-center gap-3">
                  <Money amount={income.amount} />
                  <form action={deleteRecurringIncome}>
                    <input type="hidden" name="id" value={income.id} />
                    <button className="text-sm text-danger underline">הסרה</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form action={addRecurringIncome} className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">שם</span>
            <input className="field" name="name" placeholder="משכורת" required />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">סכום חודשי</span>
            <input className="field num" name="amount" inputMode="decimal" required />
          </label>
          <button className="btn col-span-2">הוספת הכנסה</button>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">{ctx.household.name}</h2>
        <p className="text-sm text-muted">
          חברים: {members.map((m) => m.display_name).join(", ")}
        </p>
        <div>
          <p className="text-sm text-muted">קוד הזמנה לבן או בת הזוג</p>
          <p className="num text-2xl font-bold tracking-widest">{ctx.household.invite_code}</p>
          <p className="text-sm text-muted">
            {'נרשמים באתר עם אימייל משלהם, ובמסך הפתיחה בוחרים "הצטרפות עם קוד הזמנה".'}
          </p>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">החשבון שלי</h2>
        <form action={updateDisplayName} className="flex items-end gap-3">
          <label className="flex-1 space-y-1">
            <span className="text-sm font-medium">השם שלי</span>
            <input className="field" name="displayName" defaultValue={ctx.displayName} required />
          </label>
          <button className="btn btn-quiet">שמירה</button>
        </form>
        <p className="text-sm text-muted">
          {isClaudeConfigured()
            ? "הבוט מחובר ל־Claude."
            : "הבוט פועל בזיהוי בסיסי. כדי לחבר את Claude מוסיפים ANTHROPIC_API_KEY לקובץ ‎.env.local."}
        </p>
        <form action={signOut}>
          <button className="btn btn-danger w-full">יציאה מהחשבון</button>
        </form>
      </Card>
    </>
  );
}
