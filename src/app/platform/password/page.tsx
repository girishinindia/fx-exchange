import type { Metadata } from "next";
import { Icon, Note } from "@/components/ui";
import { PlatformPasswordForm } from "@/components/platform-forms";
import { requirePlatformSession } from "@/lib/platform-session";

export const metadata: Metadata = { title: "Set your password" };

/** First sign-in, and after a reset. Nothing else in the console opens until this is done. */
export default async function PlatformPasswordPage() {
  const s = await requirePlatformSession({ allowPasswordChange: true });
  return (
    <div className="min-h-dvh grid place-items-center bg-slate-50 p-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-800 text-white grid place-items-center"><Icon name="fa-shield-halved" /></div>
          <div className="font-bold text-slate-800">Genius ITens</div>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Set your own password</h1>
        <p className="mt-1 text-sm text-slate-500">Signed in as {s.email}.</p>
        {s.mustChangePassword && (
          <div className="mt-4">
            <Note tone="amber" icon="fa-triangle-exclamation">
              The password you were given is known to somebody else. Choose your own before going any further.
            </Note>
          </div>
        )}
        <PlatformPasswordForm />
      </div>
    </div>
  );
}
