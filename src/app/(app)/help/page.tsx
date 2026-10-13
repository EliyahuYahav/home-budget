import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import { PageTitle } from "@/components/ui";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

function Guide({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <details id={id} className="panel scroll-mt-4" open>
      <summary className="flex cursor-pointer items-center gap-3 p-4">
        <span className="flex-1">
          <span className="block text-lg font-bold">{title}</span>
          <span className="block text-sm text-muted">{intro}</span>
        </span>
        <ChevronDown className="chevron shrink-0 text-muted" />
      </summary>
      <div className="space-y-4 px-4 pb-4 leading-relaxed">{children}</div>
    </details>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-3 ps-5 marker:font-bold marker:text-accent">{children}</ol>;
}

/** Something to type or paste, always left to right. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code dir="ltr" className="num whitespace-nowrap rounded-md bg-accent-soft px-1.5 py-0.5 text-[0.9em]">
      {children}
    </code>
  );
}

function Block({ children }: { children: string }) {
  return (
    <pre
      dir="ltr"
      className="overflow-x-auto rounded-2xl bg-[#1d1b33] p-3 text-start font-mono text-[0.8rem] leading-relaxed text-[#e9e7f7]"
    >
      {children}
    </pre>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-warn-soft p-3 text-[0.95rem]">{children}</p>;
}

export default function HelpPage() {
  return (
    <>
      <PageTitle>הסבר והדרכה</PageTitle>
      <p className="text-muted">
        שני דברים שמגדירים פעם אחת: מפתח ל־Claude, כדי שהבוט יבין ניסוח חופשי, וסוכן במחשב בבית, למי שרוצה
        שההוצאות ייקראו לבד מהבנק. האפליקציה עובדת גם בלי שניהם.
      </p>

      <Guide
        id="claude-key"
        title="מפתח Claude לבוט"
        intro="כעשר דקות. עולה בערך אלפית שקל להודעה, על החשבון שלכם."
      >
        <p>
          הבוט מבין הודעות כמו &quot;קניתי אתמול ירקות בשוק ב־80 במזומן&quot; בעזרת Claude, מודל שפה של
          חברת Anthropic. כדי להשתמש בו צריך מפתח אישי, שמזהה את החשבון שמשלם על השימוש. בלי מפתח הבוט
          מבין רק הודעות פשוטות כמו &quot;סופר 230&quot;.
        </p>
        <Steps>
          <li>
            נכנסים ל־<Code>platform.claude.com</Code> ופותחים חשבון עם כתובת המייל שלכם.
          </li>
          <li>
            בעמוד החיוב (Billing) מוסיפים אמצעי תשלום וקונים יתרה. חמישה דולר מספיקים לזמן רב. בלי יתרה
            המפתח קיים אבל הבקשות נדחות.
          </li>
          <li>
            באותו אזור, תחת Limits, קובעים תקרת הוצאה חודשית. כך גם אם המפתח יגיע למישהו אחר, הנזק מוגבל.
          </li>
          <li>
            בעמוד API keys לוחצים Create key, נותנים לו שם (למשל &quot;תקציב הבית&quot;), ומעתיקים את
            המפתח. הוא מתחיל ב־<Code>sk-ant-</Code> ומוצג פעם אחת בלבד.
          </li>
          <li>
            באפליקציה: <Link href="/settings" className="font-semibold text-accent underline">הגדרות</Link>,
            בכרטיס &quot;הבוט ו־Claude&quot; מדביקים את המפתח ולוחצים שמירה. המפתח נבדק מול Anthropic,
            ואם הוא תקין מופיע &quot;המפתח נבדק ונשמר&quot;.
          </li>
        </Steps>
        <Note>
          שמות העמודים באתר של Anthropic עשויים להשתנות מעט. מה שמחפשים: חיוב, תקרת הוצאה, ויצירת מפתח API.
        </Note>
        <p className="text-sm text-muted">
          המפתח נשמר מוצפן ולא מוצג שוב באפליקציה. מי שמפעיל את האתר יכול טכנית לפתוח אותו, ולכן תקרת
          ההוצאה חשובה. אם חשדתם שהמפתח דלף, מוחקים אותו באתר של Anthropic ויוצרים חדש.
        </p>
      </Guide>

      <Guide
        id="agent"
        title="הסוכן במחשב: סנכרון מהבנק"
        intro="כחצי שעה בפעם הראשונה. רשות: אפשר להמשיך לרשום בבוט בלי זה."
      >
        <p>
          הסוכן הוא תוכנה קטנה שרצה במחשב שלכם בבית. כשמבקשים סנכרון מהאפליקציה, הוא נכנס לאתר הבנק
          ולאתרי חברות האשראי עם הפרטים שלכם, קורא את התנועות, ורושם את החדשות. פרטי הכניסה מוצפנים
          בדפדפן ונפתחים רק במחשב הזה; האתר והמסד לא יכולים לקרוא אותם.
        </p>
        <Note>
          לפני שמתחילים: כניסה אוטומטית עם הסיסמה בדרך כלל לא מותרת לפי תנאי השימוש של הבנק, וההחלטה
          להשתמש בזה היא שלכם. המחשב צריך להיות דולק כשמסנכרנים, ובנק שדורש קוד ב־SMS בכל כניסה לא
          יעבוד דרך האפליקציה.
        </Note>

        <h3 className="font-bold">מה צריך</h3>
        <ul className="list-disc space-y-1 ps-5">
          <li>מחשב עם Windows או Mac, ועליו הדפדפן Chrome.</li>
          <li>
            Node.js בגרסה 22.22 ומעלה, מהאתר <Code>nodejs.org</Code> (הגרסה שמסומנת LTS).
          </li>
          <li>
            התיקייה <Code>sync</Code>, שמקבלים ממי שמפעיל את האתר. שמים אותה במקום קבוע, למשל במסמכים.
          </li>
        </ul>

        <h3 className="font-bold">הקמה, פעם אחת</h3>
        <Steps>
          <li>
            פותחים שורת פקודה בתוך התיקייה <Code>sync</Code>. ב־Windows: בסייר הקבצים נכנסים לתיקייה,
            מקלידים <Code>cmd</Code> בשורת הכתובת ולוחצים Enter.
          </li>
          <li>
            מתקינים את מה שהסוכן צריך. זה לוקח כמה דקות:
            <Block>npm install</Block>
          </li>
          <li>
            בתיקייה יש קובץ <Code>.env.example</Code>. מעתיקים אותו לקובץ חדש בשם <Code>.env</Code> וממלאים
            בו את המייל והסיסמה של האפליקציה, ואת שתי השורות של האתר הזה:
            <Block>{`APP_EMAIL=המייל שלכם באפליקציה
APP_PASSWORD=הסיסמה שלכם באפליקציה
NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseAnonKey}`}</Block>
            אם יש לכם מפתח Claude, מוסיפים גם <Code>ANTHROPIC_API_KEY=</Code> ואחריו המפתח, כדי
            שלהוצאות מהבנק תשויך קטגוריה. את פרטי הבנק לא כותבים בקובץ הזה.
          </li>
          <li>
            מפעילים את הסוכן ומשאירים את החלון פתוח:
            <Block>npm run agent</Block>
            הוא מדפיס &quot;The agent is running&quot; וקוד מפתח קצר, למשל <Code>1cc8-32d6-b2f8-85d2</Code>.
          </li>
          <li>
            באפליקציה: <Link href="/settings" className="font-semibold text-accent underline">הגדרות</Link>,
            ושבע לחיצות על שורת הגרסה בתחתית. נפתח המסך &quot;אפשרויות מפתחים&quot;, ובו &quot;המחשב
            בבית&quot; אמור להראות &quot;מחובר&quot;.
          </li>
          <li>
            פותחים &quot;פרטי כניסה&quot; ומוודאים שקוד המפתח שבמסך זהה לזה שהסוכן הדפיס. ה־+ ליד שם הבנק
            או חברת האשראי מוסיף כרטיסייה; ממלאים בה את פרטי הכניסה לאתר שלהם ושומרים.
          </li>
          <li>
            לוחצים &quot;ריצת ניסיון&quot;. היא מציגה מה היה נרשם, בלי לכתוב כלום. אם הרשימה נראית נכונה,
            &quot;סנכרון&quot; רושם בפועל.
          </li>
        </Steps>

        <h3 className="font-bold">בשימוש שוטף</h3>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            כשהסוכן רץ, הוא מסנכרן לבד פעם ביום, אחרי שסנכרון אמיתי ראשון הצליח. אפשר גם לבקש סנכרון
            מהאפליקציה בכל רגע.
          </li>
          <li>אחרי הפעלה מחדש של המחשב מריצים שוב <Code>npm run agent</Code>.</li>
          <li>הוצאה שכבר רשמתם בבוט, באותו סכום ועד יומיים הפרש, לא נרשמת פעמיים.</li>
        </ul>

        <h3 className="font-bold">כשמשהו לא עובד</h3>
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">באפליקציה כתוב &quot;לא מחובר&quot;</dt>
            <dd className="text-muted">
              הסוכן לא רץ, או שאין למחשב אינטרנט. בודקים שהחלון שלו פתוח ושלא מופיעה בו שגיאה.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">
              בפלט מופיע <Code>TIMEOUT</Code>
            </dt>
            <dd className="text-muted">
              אתר הבנק לא ענה בזמן, לרוב בגלל אינטרנט איטי; הסוכן מנסה שלוש פעמים. אם זה חוזר, מוסיפים
              לקובץ <Code>.env</Code> את השורה <Code>SHOW_BROWSER=on</Code>, מפעילים מחדש את הסוכן, ורואים
              בחלון הדפדפן שנפתח איפה הכניסה נעצרת.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">
              בפלט מופיע <Code>cannot be opened with this computer&apos;s key</Code>
            </dt>
            <dd className="text-muted">
              הפרטים נשמרו עם מפתח של מחשב אחר, או שהקובץ <Code>agent-key.json</Code> נמחק. שומרים את
              פרטי הכניסה מחדש במסך המפתחים.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">הסוכן נעצר עם &quot;Could not sign in&quot;</dt>
            <dd className="text-muted">
              המייל או הסיסמה בקובץ <Code>.env</Code> לא תואמים לאלה של האפליקציה.
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted">
          שני קבצים בתיקייה <Code>sync</Code> לא נותנים לאף אחד: <Code>.env</Code>, שמכיל את סיסמת
          האפליקציה, ו־<Code>agent-key.json</Code>, שפותח את פרטי הבנק.
        </p>
      </Guide>
    </>
  );
}
