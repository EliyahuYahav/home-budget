"use client";

import { useState } from "react";

/** The invite code with a button that copies it, for pasting into a message. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access (old browser or denied): the code stays on screen to copy by hand.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="num text-2xl font-bold tracking-[0.2em]">{code}</p>
      <button type="button" onClick={copy} className="btn min-h-0 px-3.5 py-2 text-sm" aria-live="polite">
        {copied ? "הועתק" : "העתקה"}
      </button>
    </div>
  );
}
