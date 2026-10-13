"use client";

import { useActionState } from "react";
import { removeClaudeKey, saveClaudeKey, type FormState } from "@/app/actions";

const initial: FormState = {};

/** Saves or removes the household's own Claude API key. The key is never sent back to the browser. */
export function ClaudeKeyForm({ hasKey, canSave }: { hasKey: boolean; canSave: boolean }) {
  const [saveState, saveAction, saving] = useActionState(saveClaudeKey, initial);
  const [removeState, removeAction, removing] = useActionState(removeClaudeKey, initial);
  const state = removeState.message || removeState.error ? removeState : saveState;

  return (
    <div className="space-y-3">
      <form action={saveAction} className="flex items-end gap-3">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-sm font-semibold">{hasKey ? "מפתח חדש במקום הקיים" : "מפתח API של Claude"}</span>
          <input
            className="field"
            name="apiKey"
            type="password"
            dir="ltr"
            placeholder="sk-ant-..."
            autoComplete="off"
            spellCheck={false}
            required
            disabled={!canSave}
          />
        </label>
        <button className="btn" disabled={!canSave || saving || removing}>
          {saving ? "בודק…" : "שמירה"}
        </button>
      </form>
      {hasKey && (
        <form action={removeAction}>
          <button className="text-sm font-semibold text-danger underline" disabled={saving || removing}>
            {removing ? "מסיר…" : "הסרת המפתח השמור"}
          </button>
        </form>
      )}
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-2xl bg-good-soft p-3 text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
