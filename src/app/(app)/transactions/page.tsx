import { MonthNav, PageTitle } from "@/components/ui";
import { getCategories, getMembers, getTransactions, requireContext } from "@/lib/data";
import { settleCash } from "@/lib/budget";
import { isValidMonth, monthOf, todayISO } from "@/lib/dates";
import { TransactionList } from "./transaction-list";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const ctx = await requireContext();
  const today = todayISO();
  const requested = (await searchParams).m;
  const month = isValidMonth(requested) ? requested : monthOf(today);

  const [transactions, categories, members] = await Promise.all([
    getTransactions(ctx, month),
    getCategories(ctx),
    getMembers(ctx),
  ]);

  return (
    <>
      <PageTitle>הוצאות והכנסות</PageTitle>
      <MonthNav month={month} basePath="/transactions" />
      <TransactionList
        // Reset filters and open rows when the month changes.
        key={month}
        transactions={transactions}
        categories={categories}
        memberNames={Object.fromEntries(members.map((m) => [m.user_id, m.display_name]))}
        cashCovered={Object.fromEntries(settleCash(transactions, categories).covered)}
        today={today}
        defaultDate={monthOf(today) === month ? today : `${month}-01`}
      />
    </>
  );
}
