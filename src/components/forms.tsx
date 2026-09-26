"use client";

import { useFormAction } from "@/components/useFormAction";
import { changePassword, login, type FormState } from "@/app/actions/auth";
import { Field, Icon, Note } from "@/components/ui";

export function FormMessage({ state }: { state: FormState }) {
  if (state.error) return <Note tone="rose" icon="fa-circle-exclamation">{state.error}</Note>;
  if (state.ok && state.message) return <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>;
  return null;
}

export function SubmitButton(
  { pending, icon, children, className = "", variant = "primary", disabled = false }:
  { pending: boolean; icon: string; children: React.ReactNode; className?: string;
    variant?: "primary" | "danger"; disabled?: boolean },
) {
  const tone = variant === "danger"
    ? "bg-rose-600 hover:bg-rose-700"
    : "bg-sky-600 hover:bg-sky-700";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg ${tone} text-white px-4 py-2.5 text-sm font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      <Icon name={pending ? "fa-spinner fa-spin" : icon} />
      {children}
    </button>
  );
}

export function LoginForm() {
  const [state, onSubmit, pending] = useFormAction<FormState>(login, {});
  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <FormMessage state={state} />
      <Field label="Email or mobile number" name="login" icon="fa-user" autoComplete="username"
             hint="Whichever you were given. The desk knows which company you work for." required autoFocus />
      <Field label="Password" name="password" type="password" icon="fa-lock" autoComplete="current-password" required />
      <SubmitButton pending={pending} icon="fa-right-to-bracket" className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </SubmitButton>
    </form>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-rose-600">{msg}</p> : null;
}

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, onSubmit, pending] = useFormAction<FormState>(changePassword, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormMessage state={state} />
      <div>
        <Field label={forced ? "Temporary password" : "Current password"} name="current" type="password" icon="fa-lock" autoComplete="current-password" required />
        <FieldError msg={fe.current} />
      </div>
      <div>
        <Field label="New password" name="next" type="password" icon="fa-key" autoComplete="new-password" hint="At least 10 characters, with a letter and a number" required />
        <FieldError msg={fe.next} />
      </div>
      <div>
        <Field label="Confirm new password" name="confirm" type="password" icon="fa-key" autoComplete="new-password" required />
        <FieldError msg={fe.confirm} />
      </div>
      <SubmitButton pending={pending} icon="fa-check" className={forced ? "w-full" : ""}>
        {forced ? "Save and continue" : "Change password"}
      </SubmitButton>
    </form>
  );
}
