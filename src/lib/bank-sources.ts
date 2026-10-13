export interface BankSource {
  /** The company's name in the sync; sync/run-sync.mjs lists the same companies and fields. */
  company: string;
  label: string;
  fields: { key: string; label: string; secret?: boolean }[];
}

const FIELD_LABELS: Record<string, string> = {
  username: "שם משתמש",
  userCode: "קוד משתמש",
  id: "תעודת זהות",
  nationalID: "תעודת זהות",
  num: "קוד מזהה",
  card6Digits: "6 הספרות האחרונות של הכרטיס",
  password: "סיסמה",
};

function source(company: string, label: string, keys: string[]): BankSource {
  return {
    company,
    label,
    fields: keys.map((key) => ({ key, label: FIELD_LABELS[key], ...(key === "password" ? { secret: true } : {}) })),
  };
}

// Only Discount and Max have been run against a real account. The others use the same
// library and are listed with the login fields it documents.
export const BANKS: BankSource[] = [
  source("discount", "דיסקונט", ["id", "password", "num"]),
  source("hapoalim", "הפועלים", ["userCode", "password"]),
  source("leumi", "לאומי", ["username", "password"]),
  source("mizrahi", "מזרחי־טפחות", ["username", "password"]),
  source("beinleumi", "הבינלאומי", ["username", "password"]),
  source("mercantile", "מרכנתיל", ["id", "password", "num"]),
  source("otsarHahayal", "אוצר החייל", ["username", "password"]),
  source("massad", "מסד", ["username", "password"]),
  source("yahav", "יהב", ["username", "nationalID", "password"]),
  source("pagi", "פאגי", ["username", "password"]),
];

export const CARDS: BankSource[] = [
  source("max", "מקס", ["username", "password"]),
  source("visaCal", "כאל", ["username", "password"]),
  source("isracard", "ישראכרט", ["id", "card6Digits", "password"]),
  source("amex", "אמריקן אקספרס", ["id", "card6Digits", "password"]),
  source("beyahadBishvilha", "ביחד בשבילך", ["id", "password"]),
  source("behatsdaa", "בהצדעה", ["id", "password"]),
];
