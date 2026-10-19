export type CategoryKind = "expense" | "saving" | "fund";
export type TransactionType = "expense" | "income";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  is_fixed: boolean;
  monthly_budget: number;
  sort_order: number;
  archived: boolean;
  /** A bill paid in cash (rent): its amount comes off the month's cash withdrawals by itself. See settleCash. */
  paid_in_cash?: boolean;
  /** For a fund: the first day of the month it began (YYYY-MM-DD). */
  fund_start?: string | null;
  /** For a fund: what was already in it when it began. For a savings goal: what was saved before the app. */
  fund_opening?: number;
  /** For a savings line with a goal: how much is wanted. */
  goal_amount?: number | null;
  /** For a savings goal: the first day of the month it is wanted by (YYYY-MM-DD). */
  goal_due?: string | null;
}

export interface Transaction {
  id: string;
  user_id: string | null;
  type: TransactionType;
  amount: number;
  category_id: string | null;
  description: string;
  occurred_on: string; // YYYY-MM-DD
  source: "manual" | "chat" | "bank";
  /** The id the bank sync gave the row: "<company>:<account>:<the bank's own id>". */
  external_id?: string | null;
  /** Paid with cash already counted at withdrawal. See settleCash in budget.ts. */
  paid_in_cash?: boolean;
  created_at: string;
}

export interface RecurringIncome {
  id: string;
  name: string;
  amount: number;
}

export interface ChatMessage {
  id: string;
  user_id: string | null;
  role: "user" | "bot";
  content: string;
  created_at: string;
}

export interface Member {
  user_id: string;
  display_name: string;
}

/** One parsed line from a chat message, before it is saved as a transaction. */
export interface ParsedEntry {
  type: TransactionType;
  amount: number;
  /** Exact name of one of the household's categories, or null when unsure. */
  category: string | null;
  description: string;
  date: string; // YYYY-MM-DD
  /** Paid with cash, as opposed to a card or a transfer. */
  cash: boolean;
}
