"use client";

import { useActionState, useTransition, type FormEvent } from "react";

/**
 * Like useActionState, but submits via onSubmit so React does NOT reset the form
 * after the action — typed values stay in place when the server returns an error.
 * The clicked submit button's name/value is included (e.g. name="next").
 */
export function useFormAction<S>(action: (prev: Awaited<S>, fd: FormData) => Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  const [, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(fd));
  };
  return [state, onSubmit, pending] as const;
}
