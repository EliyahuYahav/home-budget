"use client";

import { useActionState } from "react";
import { createHousehold, joinHousehold, type FormState } from "../actions";

const initial: FormState = {};

function ErrorNote({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
      {state.error}
    </p>
  );
}

export function OnboardingForms() {
  const [createState, createAction, creating] = useActionState(createHousehold, initial);
  const [joinState, joinAction, joining] = useActionState(joinHousehold, initial);

  return (
    <div className="space-y-4">
      <form action={createAction} className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">משק בית חדש</h2>
        <label className="block space-y-1">
          <span className="text-sm font-medium">השם שלך</span>
          <input className="field" name="displayName" autoComplete="given-name" required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">שם למשק הבית</span>
          <input className="field" name="householdName" placeholder="הבית שלנו" />
        </label>
        <p className="text-sm text-muted">
          התקציב ייפתח עם הקטגוריות והסכומים מטבלת ההוצאות החודשית שלכם, ואפשר לשנות אותם בכל רגע.
        </p>
        <ErrorNote state={createState} />
        <button className="btn w-full" disabled={creating || joining}>
          פתיחת משק בית
        </button>
      </form>

      <form action={joinAction} className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">הצטרפות עם קוד הזמנה</h2>
        <label className="block space-y-1">
          <span className="text-sm font-medium">השם שלך</span>
          <input className="field" name="displayName" autoComplete="given-name" required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">קוד הזמנה</span>
          <input className="field num" name="inviteCode" autoCapitalize="characters" required />
        </label>
        <p className="text-sm text-muted">הקוד מופיע במסך ההגדרות אצל מי שפתח את משק הבית.</p>
        <ErrorNote state={joinState} />
        <button className="btn btn-quiet w-full" disabled={creating || joining}>
          הצטרפות
        </button>
      </form>
    </div>
  );
}
