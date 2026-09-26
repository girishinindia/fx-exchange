"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { ActionState } from "@/lib/action";
import { Icon, Note } from "@/components/ui";
import { useCloseModal } from "@/components/ModalButton";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Generic form bound to a server action: shows the result message, disables while saving,
 * optionally resets the fields and calls onSuccess (e.g. to close a modal).
 */
export function ActionForm({
  action,
  children,
  submit = "Save",
  icon = "fa-check",
  className = "space-y-4",
  resetOnSuccess = false,
  onSuccess,
  closeOnSuccess = false,
  footer,
  submitVariant = "primary",
}: {
  action: Action;
  children: ReactNode;
  submit?: string;
  icon?: string;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (s: ActionState) => void;
  closeOnSuccess?: boolean;
  footer?: ReactNode;
  submitVariant?: "primary" | "danger";
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const last = useRef<ActionState>(state);
  const close = useCloseModal();

  useEffect(() => {
    if (state !== last.current) {
      last.current = state;
      if (state.ok) {
        if (resetOnSuccess) ref.current?.reset();
        onSuccess?.(state);
        if (closeOnSuccess) close();
      }
    }
  }, [state, resetOnSuccess, onSuccess, closeOnSuccess, close]);

  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      {state.error && (
        <Note tone="rose" icon="fa-circle-exclamation">
          {state.error}
        </Note>
      )}
      {state.ok && state.message && (
        <Note tone="emerald" icon="fa-circle-check">
          {state.message}
        </Note>
      )}
      {children}
      {state.fieldErrors && Object.keys(state.fieldErrors).length > 0 && (
        <ul className="text-xs text-rose-600 list-disc pl-5">
          {Object.entries(state.fieldErrors).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {footer}
        <button
          type="submit"
          disabled={pending}
          className={
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-60 " +
            (submitVariant === "danger" ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-sky-600 hover:bg-sky-700 text-white")
          }
        >
          <Icon name={pending ? "fa-spinner fa-spin" : icon} />
          {submit}
        </button>
      </div>
    </form>
  );
}

