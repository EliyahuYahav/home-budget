"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

const DONE_KEY = "tour-done";
const STEP_KEY = "tour-step";

interface Step {
  /** The screen the step is on. */
  path: string;
  /** The element to light up: the one marked data-tour="<target>". */
  target: string;
  title: string;
  text: string;
  /** The user presses the lit element itself, which opens the next step's screen. */
  press?: boolean;
  /** Not on every screen (a list that can be empty): passed over quickly when it is missing. */
  optional?: boolean;
}

// The walk goes screen by screen. Each screen ends with a `press` step that sends the user,
// by their own tap, to the next one.
const STEPS: Step[] = [
  {
    path: "/",
    target: "today",
    title: "מותר להוציא היום",
    text: "המספר שלפיו פועלים: מה שנשאר החודש אחרי חיסכון וחשבונות קבועים, מחולק לימים שנותרו. העמודות למטה מראות כמה יצא בכל יום.",
  },
  {
    path: "/",
    target: "quick-add",
    title: "רישום מהיר",
    text: "כותבים מה הוצאתם, למשל \"סופר 230\" או \"דלק 180 אתמול\", והבוט רושם ומשייך לקטגוריה.",
  },
  { path: "/", target: "numbers", title: "החודש במבט אחד", text: "כמה נכנס, כמה יצא וכמה נשאר עד עכשיו." },
  {
    path: "/",
    target: "nav-transactions",
    title: "עכשיו לחצו על \"הוצאות\"",
    text: "שם נמצא כל מה שנרשם. לחצו על הכפתור המואר, וההדרכה תמשיך במסך שייפתח.",
    press: true,
  },

  {
    path: "/transactions",
    target: "month-nav",
    title: "מעבר בין חודשים",
    text: "החיצים מעבירים לחודש הקודם או הבא. אותו סרגל מופיע גם בתקציב ובמגמות.",
  },
  {
    path: "/transactions",
    target: "tx-add",
    title: "הוספה ידנית",
    text: "להוסיף הוצאה או הכנסה חד־פעמית בלי הבוט: סכום, קטגוריה, תאריך ותיאור.",
  },
  {
    path: "/transactions",
    target: "tx-filter",
    title: "חיפוש וסינון",
    text: "מחפשים לפי תיאור או סכום, או מציגים רק קטגוריה אחת, רק הכנסות, או רק מה שעוד בלי קטגוריה.",
  },
  {
    path: "/transactions",
    target: "tx-list",
    title: "הרשימה",
    text: "ההוצאות מקובצות לפי ימים. לחיצה על שורה פותחת אותה לעריכה: סכום, קטגוריה, תאריך, \"שולם במזומן\" ומחיקה.",
    optional: true,
  },
  {
    path: "/transactions",
    target: "nav-chat",
    title: "לחצו על הבוט",
    text: "הכפתור העגול באמצע הוא הדרך המהירה לרשום. לחצו עליו כדי להמשיך.",
    press: true,
  },

  {
    path: "/chat",
    target: "chat-input",
    title: "כותבים כאן",
    text: "אפשר כמה הוצאות בהודעה אחת (\"פיצה 60, קפה 14\"), הכנסה (\"קיבלתי בונוס 1500\"), או שאלה (\"כמה נשאר לנו החודש?\"). אם הבוט טעה, מופיע \"ביטול הרישום\".",
  },
  {
    path: "/chat",
    target: "chat-examples",
    title: "דוגמאות",
    text: "לחיצה על דוגמה ממלאת את השורה בלי לשלוח, כדי שלא תירשם הוצאה בטעות.",
  },
  {
    path: "/chat",
    target: "nav-budget",
    title: "לחצו על \"תקציב\"",
    text: "שם קובעים כמה מתוכנן לכל קטגוריה. לחצו כדי להמשיך.",
    press: true,
  },

  {
    path: "/budget",
    target: "budget-summary",
    title: "הכנסות מול תקציב",
    text: "כמה נכנס החודש, כמה תכננתם בסך הכול, וכמה כסף עוד לא קיבל תפקיד.",
  },
  {
    path: "/budget",
    target: "budget-group",
    title: "הקטגוריות",
    text: "שלוש קבוצות: חיסכון, חשבונות קבועים והוצאות משתנות. בכל שורה רואים כמה יצא מתוך מה שתוכנן, ולחיצה עליה פותחת עריכה של השם, הסכום והסוג.",
  },
  {
    path: "/budget",
    target: "budget-add",
    title: "קטגוריה חדשה",
    text: "מוסיפים קטגוריה משלכם, למשל \"מזומן\" או \"חיות מחמד\", עם סכום חודשי.",
  },
  {
    path: "/budget",
    target: "nav-trends",
    title: "לחצו על \"מגמות\"",
    text: "שם רואים את התמונה לאורך זמן. לחצו כדי להמשיך.",
    press: true,
  },

  {
    path: "/trends",
    target: "trends-summary",
    title: "סיכום החודש",
    text: "כמה נכנס, יצא ונחסך, השינוי מהחודש הקודם, ותחזית לסוף החודש בקצב הנוכחי.",
    optional: true,
  },
  {
    path: "/trends",
    target: "trends-chart",
    title: "חצי שנה אחורה",
    text: "עמודה לכל חודש. ככל שיצטברו חודשים יופיעו כאן גם השוואה לחודש רגיל ובתי העסק שאליהם הלך הכי הרבה.",
  },
  {
    path: "/trends",
    target: "nav-home",
    title: "חזרה לבית",
    text: "לחצו על \"בית\". נשאר רק מסך אחד.",
    press: true,
  },

  {
    path: "/",
    target: "settings",
    title: "ועכשיו ההגדרות",
    text: "לחצו על \"הגדרות\" כדי לראות מה מגדירים שם.",
    press: true,
  },
  {
    path: "/settings",
    target: "settings-incomes",
    title: "הכנסות קבועות",
    text: "משכורות וכל מה שנכנס כל חודש. מי שמסנכרן מהבנק לא צריך למלא: ההכנסות נקראות משם.",
  },
  {
    path: "/settings",
    target: "settings-invite",
    title: "קוד הזמנה",
    text: "בן או בת הזוג נרשמים עם מייל משלהם ומצטרפים עם הקוד הזה, ואז שניכם רואים ורושמים באותו תקציב.",
  },
  {
    path: "/settings",
    target: "settings-claude",
    title: "מפתח לבוט",
    text: "עם מפתח Claude משלכם הבוט מבין ניסוח חופשי ושאלות. בלי מפתח הוא מבין הודעות פשוטות כמו \"סופר 230\".",
  },
  {
    path: "/settings",
    target: "settings-help",
    title: "הסבר והדרכה",
    text: "כאן יש הסבר מפורט, צעד אחר צעד, וגם כפתור שמציג את ההדרכה הזו שוב. זהו, אפשר להתחיל.",
  },
];

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function isDone() {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    // Without storage the tour could never be dismissed for good, so it is not shown.
    return true;
  }
}

function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to remember it in.
  }
}

function setDone(done: boolean) {
  remember(DONE_KEY, done ? "1" : null);
  remember(STEP_KEY, null);
  // The storage event only reaches other tabs; this one is told directly.
  window.dispatchEvent(new Event("storage"));
}

function savedStep() {
  try {
    const saved = Number(localStorage.getItem(STEP_KEY));
    return Number.isInteger(saved) && saved >= 0 && saved < STEPS.length ? saved : 0;
  } catch {
    return 0;
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The element's own corner rounding, so the lit area has the same shape as what it lights. */
  radius: number;
}

const PADDING = 6;
/** Catches taps around the lit element, so nothing else is pressed by accident. */
const BLOCK = "pointer-events-auto absolute";

/**
 * A first-visit walk through the app: the screen dims and one element at a time stays lit,
 * with a short explanation beside it. To move between screens the user presses the lit
 * button itself, and the walk carries on in the screen that opens. Shown once per device.
 */
export function Tour() {
  const done = useSyncExternalStore(subscribe, isDone, () => true);
  // Mounted only while it runs, so showing it again starts from the first step.
  return done ? null : <TourSteps />;
}

function TourSteps() {
  const pathname = usePathname();
  const router = useRouter();
  const [index, setIndex] = useState(savedStep);
  const [box, setBox] = useState<{ target: string; rect: Box } | null>(null);

  function go(to: number) {
    if (to >= STEPS.length) {
      setDone(true);
      return;
    }
    remember(STEP_KEY, String(to));
    setIndex(to);
  }

  // A `press` step is finished by the user's own tap, which changes the screen. Once the
  // screen showing is the next step's and no longer this one's, the walk has moved on.
  const next = STEPS[index + 1];
  if (STEPS[index].press && next && STEPS[index].path !== pathname && next.path === pathname) {
    go(index + 1);
  }

  const step = STEPS[index];
  const here = step.path === pathname;

  useEffect(() => {
    if (!here) return;
    // Timers, not animation frames: a tab in the background gets no frames at all, and the
    // walk would silently stop there.
    let timer = 0;
    let tries = 0;
    let scrolled = false;
    const measure = () => {
      // Screens visited earlier stay in the page, hidden, with their own marked elements;
      // the one wanted is the one that is actually laid out.
      const element = [...document.querySelectorAll(`[data-tour="${step.target}"]`)].find(
        (candidate) => candidate.getClientRects().length > 0,
      );
      if (!element) {
        // The screen may still be loading. An optional element gets a moment, the rest get longer.
        tries += 1;
        clearTimeout(timer);
        if (tries < (step.optional ? 5 : 25)) timer = window.setTimeout(measure, 200);
        else go(index + 1);
        return;
      }
      if (!scrolled) {
        scrolled = true;
        element.scrollIntoView({ block: "center" });
        // Measured a moment later, once the scroll has moved the element.
        clearTimeout(timer);
        timer = window.setTimeout(measure, 60);
        return;
      }
      let { top, left, right, bottom } = element.getBoundingClientRect();
      if (step.press) {
        // A button's parts can stick out of its own box (the round bot button rises above
        // the bar), and a lit area that cuts through them looks broken.
        for (const part of element.querySelectorAll("*")) {
          const r = part.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          top = Math.min(top, r.top);
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          bottom = Math.max(bottom, r.bottom);
        }
      }
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 14;
      setBox({ target: step.target, rect: { top, left, width: right - left, height: bottom - top, radius } });
    };
    timer = window.setTimeout(measure, 0);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
    };
  }, [here, index, step.target, step.optional, step.press]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDone(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counter = (
    <p className="text-sm font-semibold text-muted">
      <span className="num">{index + 1}</span> מתוך <span className="num">{STEPS.length}</span>
    </p>
  );
  const skip = (
    <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => setDone(true)}>
      דילוג
    </button>
  );
  const card =
    "pointer-events-auto mx-auto max-w-sm space-y-3 rounded-3xl border border-card-line bg-bg p-4 text-ink shadow-card";

  // The user wandered to another screen: offer the way back instead of pointing at nothing.
  if (!here) {
    return (
      <div className="pointer-events-none fixed inset-x-4 bottom-28 z-50" role="dialog" aria-label="הדרכה באפליקציה">
        <div className={card}>
          {counter}
          <p>ההדרכה ממשיכה במסך אחר.</p>
          <div className="flex items-center gap-3">
            {skip}
            <span className="flex-1" />
            <button type="button" className="btn min-h-0 px-4 py-2 text-sm" onClick={() => router.push(step.path)}>
              להמשיך בהדרכה
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not measured yet (the screen is still loading), or still showing the previous step's place.
  if (!box || box.target !== step.target) return null;

  const { rect } = box;
  const hole = {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
  // The same rounding as the element, grown by the padding, and never more than a full pill.
  const lit = {
    ...hole,
    borderRadius: Math.min(rect.radius + PADDING, Math.min(hole.width, hole.height) / 2),
  };
  const last = index === STEPS.length - 1;
  // The explanation goes on whichever side of the element has more room.
  const below = rect.top + rect.height / 2 < window.innerHeight / 2;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="הדרכה באפליקציה"
    >
      {/* The lit area is a hole with the element's own rounded shape; its enormous shadow is
          what dims the rest of the screen, so the dark edge follows the same curve. */}
      <div
        aria-hidden="true"
        className="absolute shadow-[0_0_0_200vmax_rgb(16_14_40_/_0.72)] transition-all duration-200 motion-reduce:transition-none"
        style={lit}
      />
      <div
        aria-hidden="true"
        className={`absolute border-2 border-white/85 transition-all duration-200 motion-reduce:transition-none ${
          step.press ? "animate-pulse" : ""
        }`}
        style={lit}
      />
      {/* Four invisible panels around the element catch taps. */}
      <div className={`inset-x-0 top-0 ${BLOCK}`} style={{ height: Math.max(hole.top, 0) }} />
      <div className={`inset-x-0 bottom-0 ${BLOCK}`} style={{ top: hole.top + hole.height }} />
      <div className={`left-0 ${BLOCK}`} style={{ top: hole.top, height: hole.height, width: Math.max(hole.left, 0) }} />
      <div className={`right-0 ${BLOCK}`} style={{ top: hole.top, height: hole.height, left: hole.left + hole.width }} />
      {/* Only a `press` step lets the tap through to the element. */}
      {!step.press && <div className={BLOCK} style={hole} />}

      <div
        className="absolute inset-x-4"
        style={below ? { top: hole.top + hole.height + 14 } : { bottom: window.innerHeight - hole.top + 14 }}
      >
        <div className={card}>
          <div aria-live="polite" className="space-y-1">
            {counter}
            <h2 className="text-lg font-bold">{step.title}</h2>
            <p className="leading-relaxed">{step.text}</p>
            {step.press && <p className="pt-1 font-bold text-accent">ההדרכה מחכה ללחיצה שלכם על הכפתור המואר.</p>}
          </div>
          <div className="flex items-center gap-3">
            {skip}
            <span className="flex-1" />
            {index > 0 && !STEPS[index - 1].press && (
              <button type="button" className="btn btn-quiet min-h-0 px-3.5 py-2 text-sm" onClick={() => go(index - 1)}>
                הקודם
              </button>
            )}
            {!step.press && (
              <button type="button" className="btn min-h-0 px-4 py-2 text-sm" onClick={() => go(index + 1)}>
                {last ? "סיום" : "הבא"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shows the tour again from the start. */
export function ReplayTourButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-quiet w-full"
      onClick={() => {
        setDone(false);
        router.push("/");
      }}
    >
      להציג שוב את ההדרכה על המסכים
    </button>
  );
}
