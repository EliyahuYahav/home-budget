"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type FormState } from "../actions";

const initial: FormState = {};

export default function LoginPage() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [signInState, signInAction, signingIn] = useActionState(signIn, initial);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, initial);

  const isSignIn = mode === "signIn";
  const state = isSignIn ? signInState : signUpState;
  const pending = signingIn || signingUp;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <header className="hero p-6">
        <p className="font-display text-8xl font-bold leading-none" aria-hidden="true">
          ₪
        </p>
        <h1 className="mt-3 font-display text-6xl font-bold leading-none">תקציב הבית</h1>
        <p className="mt-1 text-hero-ink/80">כותבים מה הוצאתם, והשאר מסתדר לבד.</p>
      </header>

      <form action={isSignIn ? signInAction : signUpAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">אימייל</span>
          <input className="field" name="email" type="email" autoComplete="email" dir="ltr" required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">סיסמה</span>
          <input
            className="field"
            name="password"
            type="password"
            autoComplete={isSignIn ? "current-password" : "new-password"}
            minLength={isSignIn ? undefined : 8}
            dir="ltr"
            required
          />
          {!isSignIn && <span className="block text-sm text-muted">8 תווים לפחות.</span>}
        </label>

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

        <button className="btn w-full" disabled={pending}>
          {pending ? (isSignIn ? "נכנס…" : "נרשם…") : isSignIn ? "כניסה" : "הרשמה"}
        </button>
      </form>

      <button
        type="button"
        className="font-semibold text-accent"
        onClick={() => setMode(isSignIn ? "signUp" : "signIn")}
      >
        {isSignIn ? "אין לך חשבון? להרשמה" : "יש לך חשבון? לכניסה"}
      </button>
    </main>
  );
}
