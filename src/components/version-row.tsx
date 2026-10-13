"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const TAPS = 7;
const STORAGE_KEY = "developer-options";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function isUnlocked() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setUnlocked(unlocked: boolean) {
  try {
    if (unlocked) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the screen still opens; it just needs the taps again next time.
  }
  // The storage event only reaches other tabs; this one is told directly.
  window.dispatchEvent(new Event("storage"));
}

/**
 * The app version. Tapping it seven times opens the developer options and leaves a link to
 * them on this device, the way a phone's build number does. Seven more taps hide the link again.
 */
export function VersionRow({ version }: { version: string }) {
  const router = useRouter();
  const [taps, setTaps] = useState(0);
  const unlocked = useSyncExternalStore(subscribe, isUnlocked, () => false);
  const left = TAPS - taps;

  function onTap() {
    if (left > 1) {
      setTaps(taps + 1);
      return;
    }
    setTaps(0);
    if (unlocked) {
      setUnlocked(false);
    } else {
      setUnlocked(true);
      router.push("/developer");
    }
  }

  return (
    <div className="space-y-1 pb-2 text-center text-sm text-muted">
      <button type="button" onClick={onTap} className="num px-3 py-1">
        גרסה {version}
      </button>
      {unlocked && (
        <p>
          <Link href="/developer" className="font-semibold text-accent">
            אפשרויות מפתחים
          </Link>
        </p>
      )}
      <p aria-live="polite">
        {taps >= 3 && `עוד ${left} לחיצות ${unlocked ? "להסתרת" : "לפתיחת"} אפשרויות המפתחים`}
      </p>
    </div>
  );
}
