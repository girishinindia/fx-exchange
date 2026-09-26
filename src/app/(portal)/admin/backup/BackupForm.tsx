"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui";

/** Plain form POST (the browser downloads the streamed ZIP); refreshes the history list afterwards. */
export function BackupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="post"
      action="/api/backup"
      onSubmit={() => {
        setBusy(true);
        setTimeout(() => { setBusy(false); router.refresh(); }, 6000);
      }}
      className="space-y-4"
    >
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="include_audit" value="1" className="mt-1 h-4 w-4 accent-sky-600" />
        <span>
          <span className="font-medium">Include the audit log</span>
          <span className="block text-slate-500">Every change ever made, with old and new values. Makes the file much larger.</span>
        </span>
      </label>
      <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">
        <Icon name={busy ? "fa-spinner fa-spin" : "fa-download"} />
        {busy ? "Preparing download…" : "Download backup (.zip)"}
      </button>
    </form>
  );
}
