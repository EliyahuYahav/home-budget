"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "tour-done";

// Each step lights up the element marked data-tour="<target>". All of them are on the home
// screen or in the navigation bar, so the tour runs there.
const STEPS = [
  {
    target: "today",
    title: "מותר להוציא היום",
    text: "המספר שלפיו פועלים: מה שנשאר החודש אחרי חיסכון וחשבונות קבועים, מחולק לימים שנותרו. העמודות למטה מראות כמה יצא בכל יום.",
  },
  {
    target: "quick-add",
    title: "רישום מהיר",
    text: "כותבים מה הוצאתם, למשל \"סופר 230\" או \"דלק 180 אתמול\", והבוט רושם ומשייך לקטגוריה.",
  },
  {
    target: "numbers",
    title: "החודש במבט אחד",
    text: "כמה נכנס, כמה יצא וכמה נשאר עד עכשיו.",
  },
  {
    target: "nav-transactions",
    title: "הוצאות",
    text: "כל מה שנרשם, לפי ימים. כאן מחפשים, מתקנים קטגוריה, עורכים ומוחקים.",
  },
  {
    target: "nav-chat",
    title: "הבוט",
    text: "השיחה המלאה: כמה הוצאות בהודעה אחת, ושאלות כמו \"כמה נשאר לנו החודש?\".",
  },
  {
    target: "nav-budget",
    title: "תקציב",
    text: "כמה תכננתם לכל קטגוריה מול מה שיצא בפועל. כאן גם משנים סכומים ומוסיפים קטגוריות.",
  },
  {
    target: "nav-trends",
    title: "מגמות",
    text: "סיכום החודש, השוואה לחודשים קודמים, ולאן הלך הכי הרבה כסף.",
  },
  {
    target: "settings",
    title: "הגדרות",
    text: "הכנסות קבועות, קוד הזמנה לבן או בת הזוג, מפתח לבוט, ודף הסבר מפורט. את ההדרכה הזו אפשר להציג שוב משם.",
  },
];

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function isDone() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Without storage the tour could never be dismissed for good, so it is not shown.
    return true;
  }
}

function setDone(done: boolean) {
  try {
    if (done) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remember it in.
  }
  // The storage event only reaches other tabs; this one is told directly.
  window.dispatchEvent(new Event("storage"));
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;

/**
 * A first-visit walk through the app: the screen dims and one element at a time stays lit,
 * with a short explanation beside it. Shown once per device, on the home screen.
 */
export function Tour() {
  const pathname = usePathname();
  const done = useSyncExternalStore(subscribe, isDone, () => true);
  // Mounted only while it runs, so showing it again starts from the first step.
  return !done && pathname === "/" ? <TourSteps /> : null;
}

function TourSteps() {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = STEPS[index];

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const element = document.querySelector(`[data-tour="${step.target}"]`);
      if (!element) {
        // The element is not on this screen (a card that is only shown sometimes): move on.
        if (index < STEPS.length - 1) setIndex(index + 1);
        else setDone(true);
        return;
      }
      const rect = element.getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    const start = () => {
      document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView({ block: "center" });
      // Measured on the next frame, once the scroll has moved the element.
      frame = requestAnimationFrame(measure);
    };
    const first = requestAnimationFrame(start);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [index, step.target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDone(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!box) return null;

  const last = index === STEPS.length - 1;
  // The explanation goes on whichever side of the element has more room.
  const below = box.top + box.height / 2 < window.innerHeight / 2;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="הדרכה באפליקציה">
      {/* Catches taps, so nothing underneath is pressed by accident during the tour. */}
      <div className="absolute inset-0" />
      {/* The lit area: a hole whose enormous shadow is what dims the rest of the screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-3xl shadow-[0_0_0_9999px_rgb(16_14_40_/_0.72)] ring-2 ring-white/80 transition-all duration-200 motion-reduce:transition-none"
        style={{
          top: box.top - PADDING,
          left: box.left - PADDING,
          width: box.width + PADDING * 2,
          height: box.height + PADDING * 2,
        }}
      />
      <div
        className="absolute inset-x-4 mx-auto max-w-sm space-y-3 rounded-3xl border border-card-line bg-bg p-4 text-ink shadow-card"
        style={below ? { top: box.top + box.height + PADDING + 14 } : { bottom: window.innerHeight - box.top + PADDING + 14 }}
      >
        <div aria-live="polite" className="space-y-1">
          <p className="text-sm font-semibold text-muted">
            <span className="num">{index + 1}</span> מתוך <span className="num">{STEPS.length}</span>
          </p>
          <h2 className="text-lg font-bold">{step.title}</h2>
          <p className="leading-relaxed">{step.text}</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => setDone(true)}>
            דילוג
          </button>
          <span className="flex-1" />
          {index > 0 && (
            <button type="button" className="btn btn-quiet min-h-0 px-3.5 py-2 text-sm" onClick={() => setIndex(index - 1)}>
              הקודם
            </button>
          )}
          <button
            type="button"
            className="btn min-h-0 px-4 py-2 text-sm"
            autoFocus
            onClick={() => (last ? setDone(true) : setIndex(index + 1))}
          >
            {last ? "סיום" : "הבא"}
          </button>
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
