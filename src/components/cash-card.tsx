import type { CashWallet } from "@/lib/budget";
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
      <p className="text-sm text-muted">
        משיכה היא לא הוצאה: ההוצאה נספרת בקטגוריה של מה שקניתם. מה שלא מפורט נספר בינתיים כהוצאה, כדי
        שלא ייעלם מהחשבון. כדי לפרט, מסמנים &quot;שולם במזומן&quot; בהוצאה, או &quot;משולם במזומן&quot; בחשבון
        קבוע כמו שכירות.
      </p>
    </Card>
  );
}
