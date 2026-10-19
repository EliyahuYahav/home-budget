import { moveMisfiledCash } from "@/app/actions";
import type { CashWallet } from "@/lib/budget";
import { SubmitButton } from "./submit-button";
import { Card, Money, SectionTitle } from "./ui";

/** Where the month's cash withdrawals went. Cash is a wallet, not a line of the budget. */
export function CashCard({ wallet }: { wallet: CashWallet }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>ארנק מזומן</SectionTitle>
        <p>
          <span className="text-sm text-muted">נמשך החודש</span> <Money amount={wallet.withdrawn} className="font-bold" />
        </p>
      </div>
      <ul className="divide-y divide-line">
        {wallet.bills.map((bill) => (
          <li key={bill.categoryId} className="flex justify-between gap-2 py-1.5">
            <span>
              {bill.name} <span className="text-sm text-muted">(משולם במזומן)</span>
            </span>
            <Money amount={bill.amount} className="font-bold" />
          </li>
        ))}
        {wallet.purchases > 0 && (
          <li className="flex justify-between gap-2 py-1.5">
            <span>קניות שנרשמו במזומן</span>
            <Money amount={wallet.purchases} className="font-bold" />
          </li>
        )}
        <li className={`flex justify-between gap-2 py-1.5 ${wallet.undocumented > 0 ? "text-warn" : ""}`}>
          <span>לא מפורט</span>
          <Money amount={wallet.undocumented} className="font-bold" />
        </li>
      </ul>
      {(wallet.misfiled.count > 0 || wallet.stray.count > 0) && (
        <div className="space-y-2 rounded-2xl bg-warn-soft p-3 text-sm">
          {wallet.misfiled.count > 0 && (
            <p>
              <Money amount={wallet.misfiled.amount} className="font-bold" /> כאן הם לא משיכות מכספומט, למשל &quot;
              {wallet.misfiled.example}&quot;. הם נרשמו כמזומן בטעות ומנפחים את &quot;לא מפורט&quot;.
            </p>
          )}
          {wallet.stray.count > 0 && (
            <p>
              <Money amount={wallet.stray.amount} className="font-bold" /> של משיכות מכספומט נרשמו בקטגוריה אחרת, ולכן
              לא נספרים בארנק.
            </p>
          )}
          <form action={moveMisfiledCash}>
            <SubmitButton className="btn btn-quiet min-h-0 px-3 py-1.5 text-sm" pendingLabel="מסדר…">
              לסדר את זה בכל החודשים
            </SubmitButton>
          </form>
          <p className="text-muted">
            מה שאינו משיכה עובר ל&quot;ללא קטגוריה&quot;, ומשם אפשר לשייך אותו במסך ההוצאות. משיכות עוברות לארנק.
          </p>
        </div>
      )}
      <p className="text-sm text-muted">
        משיכה היא לא הוצאה: ההוצאה נספרת בקטגוריה של מה שקניתם. מה שלא מפורט נספר בינתיים כהוצאה, כדי
        שלא ייעלם מהחשבון. כדי לפרט, מסמנים &quot;שולם במזומן&quot; בהוצאה, או &quot;משולם במזומן&quot; בחשבון
        קבוע כמו שכירות.
      </p>
    </Card>
  );
}
