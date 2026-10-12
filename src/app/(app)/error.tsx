"use client";

import { useEffect } from "react";

// Shown in place of a screen whose data could not be loaded or saved.
export default function ScreenError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="space-y-4 panel p-6 text-center">
      <h1 className="font-display text-5xl leading-none font-bold">המסך לא נטען</h1>
      <p className="text-muted">
        משהו השתבש בטעינה. אם זו בעיית חיבור רגעית, ניסיון נוסף אמור לעזור.
      </p>
      <button className="btn w-full" onClick={() => retry()}>
        לנסות שוב
      </button>
    </div>
  );
}
