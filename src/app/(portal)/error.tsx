"use client";

import { Button, EmptyState } from "@/components/ui";

/** Friendly error screen for the portal. Details stay in the server logs. */
export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-sky-100 shadow-card">
      <EmptyState
        icon="fa-triangle-exclamation"
        title="Something went wrong"
        text="Please try again. If it keeps happening, tell your administrator."
        action={
          <Button onClick={reset} variant="secondary" icon="fa-rotate-right">
            Try again
          </Button>
        }
      />
    </div>
  );
}
