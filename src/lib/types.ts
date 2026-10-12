export type CategoryKind = "expense" | "saving";
export type TransactionType = "expense" | "income";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  is_fixed: boolean;
  monthly_budget: number;
  sort_order: number;
  archived: boolean;
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
}
