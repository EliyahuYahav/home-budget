export interface BankSource {
  /** The company's id in the sync (sync/run-sync.mjs lists the same companies and fields). */
  company: string;
  label: string;
  fields: { key: string; label: string; secret?: boolean }[];
}

export const BANKS: BankSource[] = [
  {
    company: "discount",
    label: "דיסקונט",
    fields: [
      { key: "id", label: "תעודת זהות" },
      { key: "password", label: "סיסמה", secret: true },
      { key: "num", label: "קוד מזהה" },
    ],
  },
  {
    company: "mizrahi",
    label: "מזרחי־טפחות",
    fields: [
      { key: "username", label: "שם משתמש" },
      { key: "password", label: "סיסמה", secret: true },
    ],
  },
];

export const CARDS: BankSource[] = [
  {
    company: "max",
    label: "מקס",
    fields: [
      { key: "username", label: "שם משתמש" },
      { key: "password", label: "סיסמה", secret: true },
    ],
  },
];
