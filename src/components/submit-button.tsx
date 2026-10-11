"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submit button that disables itself and says so while its form's action runs. */
export function SubmitButton({
  children,
  pendingLabel = "שומר…",
  className = "btn",
  ...rest
}: {
  children: ReactNode;
  pendingLabel?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} className={className} disabled={pending || rest.disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}
