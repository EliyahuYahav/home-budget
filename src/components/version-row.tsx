"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const TAPS_TO_UNLOCK = 7;
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

/**
 * The app version. Tapping it seven times opens the developer options and leaves a link to
 * them on this device, the way a phone's build number does.
 */
export function VersionRow({ version }: { version: string }) {
  const router = useRouter();
  const [taps, setTaps] = useState(0);
  const unlocked = useSyncExternalStore(subscribe, isUnlocked, () => false);
  const left = TAPS_TO_UNLOCK - taps;

  function onTap() {
    if (unlocked) return;
    if (left > 1) {
      setTaps(taps + 1);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Without storage the screen still opens; it just needs the taps again next time.
    }
    router.push("/developer");
  }

  return (
    <div className="space-y-1 pb-2 text-center text-sm text-muted">
      <button type="button" onClick={onTap} className="num px-3 py-1">
        גרסה {version}
      </button>
      <p aria-live="polite">
        {unlocked ? (
          <Link href="/developer" className="font-semibold text-accent">
            אפשרויות מפתחים
          </Link>
        ) : (
          taps >= 3 && `עוד ${left} לחיצות לאפשרויות מפתחים`
        )}
      </p>
    </div>
  );
}
