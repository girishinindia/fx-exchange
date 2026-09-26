"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { Button, Field, Icon, LinkButton, Note, SelectField } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { SubmitButton } from "@/components/forms";
import {
  createCompanyAction, createUserAction, deleteCompanyAction, platformLoginAction,
  platformPasswordAction, resetUserPasswordAction, setCompanyStatusAction, setUserStatusAction,
  type ConsoleState,
} from "@/app/actions/platform";

/** The console's forms. Separate from the desk's, because they talk to a different world. */

function Message({ state }: { state: ConsoleState }) {
  if (state.error) return <Note tone="rose" icon="fa-circle-exclamation">{state.error}</Note>;
  if (state.ok && state.message) return <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>;
  return null;
}

/**
 * A temporary password, shown once. It is never stored anywhere readable and cannot be shown
 * again — if it is lost, reset it, which is one click and leaves a record.
 */
function OneTimePassword({ state }: { state: ConsoleState }) {
  if (!state.password) return null;
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
        Give this to {state.forEmail} — it is shown once
      </div>
      <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-amber-900 select-all">{state.password}</div>
      <div className="mt-2 text-xs text-amber-800">
        They must change it the moment they sign in. Send it by a different route from the email address itself.
      </div>
    </div>
  );
}

export function PlatformLoginForm() {
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(platformLoginAction, {});
  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Message state={state} />
      <Field label="Email or mobile number" name="login" icon="fa-user" autoComplete="username" required autoFocus />
      <Field label="Password" name="password" type="password" icon="fa-lock" autoComplete="current-password" required />
      <SubmitButton pending={pending} icon="fa-right-to-bracket" className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">
        This is the Genius ITens console. A company signs in at the desk&apos;s own address.
      </p>
    </form>
  );
}

export function PlatformPasswordForm() {
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(platformPasswordAction, {});
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <Message state={state} />
      <Field label="New password" name="password" type="password" icon="fa-lock" autoComplete="new-password" required autoFocus
             hint="At least 10 characters. Use something you are not using anywhere else." />
      <Field label="New password again" name="confirm" type="password" icon="fa-lock" autoComplete="new-password" required />
      <SubmitButton pending={pending} icon="fa-check" className="w-full">
        {pending ? "Saving…" : "Save and continue"}
      </SubmitButton>
    </form>
  );
}

export function NewCompanyForm() {
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(createCompanyAction, {});
  const done = Boolean(state.ok && state.password);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Message state={state} />
      <OneTimePassword state={state} />
      {done ? (
        <div className="flex gap-2">
          <LinkButton href="/platform" icon="fa-list">Back to the companies</LinkButton>
        </div>
      ) : (
        <>
          <Field label="Registered name" name="legalName" required autoFocus
                 placeholder="Acme Forex Private Limited"
                 hint="The Administrator can correct this when they set the company up." />
          <p className="-mt-1 text-xs text-slate-500">
            <Icon name="fa-hashtag" className="mr-1.5 text-slate-400" />
            The company code is assigned when you save — C001, C002, and so on. It labels the
            company on every screen and report and can never be changed, so it is deliberately
            not the name: the Administrator renames the company during setup, and a code that
            had their old name in it would be wrong from that day on.
          </p>
          <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Its first Administrator</div>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Name" name="adminName" required placeholder="Anil Mehta" />
              <Field label="Email" name="adminEmail" type="email" required placeholder="anil@acme.co.in"
                     hint="This is what they sign in with." />
              <Field label="Mobile" name="adminPhone" inputMode="tel" placeholder="9825011111"
                     hint="Optional. If you give it, they can sign in with it instead of the email." />
            </div>
          </div>
          <Note tone="slate" icon="fa-circle-info">
            You are opening the account, not setting the desk up. The Administrator chooses the
            currency the desk deals in — and everything else about the company — the first time
            they sign in. After that the currency can never be changed.
          </Note>
          <SubmitButton pending={pending} icon="fa-building-circle-check">
            {pending ? "Opening…" : "Open the account"}
          </SubmitButton>
        </>
      )}
    </form>
  );
}

export function AddPersonButton({ companyId, companyCode }: { companyId: string; companyCode: string }) {
  const [open, setOpen] = useState(false);
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(createUserAction, {});
  return (
    <>
      <Button icon="fa-user-plus" onClick={() => setOpen(true)}>Add a person</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add somebody to ${companyCode}`}>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="companyId" value={companyId} />
          <Message state={state} />
          <OneTimePassword state={state} />
          {state.ok ? (
            <Button icon="fa-check" onClick={() => { setOpen(false); location.reload(); }}>Done</Button>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Name" name="fullName" required autoFocus />
                <Field label="Email" name="email" type="email" required />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Mobile" name="phone" inputMode="tel" hint="Optional — a second way for them to sign in" />
                <SelectField label="What they may do" name="userType" required defaultValue="USER"
                  options={[
                    { value: "USER", label: "Desk user — enters the day's work" },
                    { value: "ADMIN", label: "Administrator — runs the company" },
                  ]} />
              </div>
              <p className="text-xs text-slate-500">
                A company may have as many Administrators as it likes. They still cannot add
                anybody themselves — that only happens here.
              </p>
              <SubmitButton pending={pending} icon="fa-user-plus">
                {pending ? "Adding…" : "Add them"}
              </SubmitButton>
            </>
          )}
        </form>
      </Modal>
    </>
  );
}

export function PersonActions({ companyId, user }: {
  companyId: string;
  user: { id: string; full_name: string; status: string };
}) {
  const [which, setWhich] = useState<"block" | "reset" | null>(null);
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(
    which === "reset" ? resetUserPasswordAction : setUserStatusAction, {});
  const blocked = user.status === "INACTIVE";

  return (
    <>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" icon="fa-key" onClick={() => setWhich("reset")}>Reset password</Button>
        <Button variant={blocked ? "ghost" : "danger"} icon={blocked ? "fa-unlock" : "fa-ban"} onClick={() => setWhich("block")}>
          {blocked ? "Let back in" : "Block"}
        </Button>
      </div>
      <Modal open={which !== null} onClose={() => setWhich(null)}
             title={which === "reset" ? `Reset ${user.full_name}'s password` : blocked ? `Let ${user.full_name} back in` : `Block ${user.full_name}`}>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="status" value={blocked ? "ACTIVE" : "INACTIVE"} />
          <Message state={state} />
          <OneTimePassword state={state} />
          {state.ok ? (
            <Button icon="fa-check" onClick={() => { setWhich(null); location.reload(); }}>Done</Button>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {which === "reset"
                  ? "They will be given a new password to use once, and asked to change it straight away. Every device they are signed in on will be signed out."
                  : blocked
                    ? "They will be able to sign in again with the password they already have."
                    : "They will not be able to sign in. Everything they entered stays in the books with their name on it — nothing is removed."}
              </p>
              <SubmitButton pending={pending} icon={which === "reset" ? "fa-key" : blocked ? "fa-unlock" : "fa-ban"}>
                {pending ? "Working…" : which === "reset" ? "Yes, reset it" : blocked ? "Yes, let them back in" : "Yes, block them"}
              </SubmitButton>
            </>
          )}
        </form>
      </Modal>
    </>
  );
}

export function CompanyStatusButton({ company }: { company: { id: string; code: string; status: string } }) {
  const [open, setOpen] = useState(false);
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(setCompanyStatusAction, {});
  const blocked = company.status !== "ACTIVE";

  return (
    <>
      <Button variant={blocked ? "primary" : "danger"} icon={blocked ? "fa-unlock" : "fa-ban"} onClick={() => setOpen(true)}>
        {blocked ? "Let the company back in" : "Block the company"}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)}
             title={blocked ? `Let ${company.code} back in` : `Block ${company.code}`}>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="status" value={blocked ? "ACTIVE" : "SUSPENDED"} />
          <Message state={state} />
          {state.ok ? (
            <Button icon="fa-check" onClick={() => { setOpen(false); location.reload(); }}>Done</Button>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {blocked
                  ? "Everybody there will be able to sign in again. Their books are exactly as they left them."
                  : "Nobody at this company will be able to sign in. Their books are untouched and come back the moment the account is let back in."}
              </p>
              {!blocked && (
                <Field label="Why" name="reason" required autoFocus maxLength={300}
                       placeholder="The subscription has lapsed" hint="This stays on the record." />
              )}
              <SubmitButton pending={pending} icon={blocked ? "fa-unlock" : "fa-ban"}>
                {pending ? "Working…" : blocked ? `Yes, let ${company.code} back in` : `Yes, block ${company.code}`}
              </SubmitButton>
            </>
          )}
        </form>
      </Modal>
    </>
  );
}

/**
 * Erasing an account.
 *
 * Offered whether or not the company is blocked: a running one is blocked and deleted in the
 * same act, and the panel says so before it is pressed. The speed bump that does the work is
 * the company's own code typed out, not a button — a person who cannot produce the code is a
 * person who is not sure which company they are looking at. Blocking first is still the
 * honest order of events, and the database records it as its own line on the trail.
 */
export function DeleteCompanyPanel(
  { company, people }: {
    company: { id: string; code: string; name: string; status: string };
    /** how many people work there — the console may see that, and nothing of their trade */
    people: number;
  },
) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, onSubmit, pending] = useFormAction<ConsoleState>(deleteCompanyAction, {});
  const blocked = company.status !== "ACTIVE";
  const matches = typed.trim().toUpperCase() === company.code.toUpperCase();

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5">
      <div className="flex items-start gap-3">
        <Icon name="fa-triangle-exclamation" className="mt-0.5 text-rose-500" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-rose-900">Delete this account</h3>
          <p className="mt-1 text-sm text-slate-600">
            Erases {company.code} and everything in it — every voucher, party, account and
            person. <b>It cannot be undone and there is no copy.</b> This console cannot tell
            you how much is in there, because it cannot read a company&apos;s trade at all. If
            anybody may ever need those books, have the company take its own backup first.
          </p>
          <div className="mt-3">
            <Button variant="danger" icon="fa-trash" onClick={() => setOpen(true)}>
              {blocked ? `Delete ${company.code} permanently` : `Block and delete ${company.code}…`}
            </Button>
            {!blocked && (
              <p className="mt-2 text-xs text-slate-500">
                <Icon name="fa-circle-info" className="mr-1.5 text-slate-400" />
                {company.code} is still running. Deleting blocks it first — both in one go, and
                you will be asked to type the code.
              </p>
            )}
          </div>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Delete ${company.code}`}>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="companyId" value={company.id} />
          {!blocked && <input type="hidden" name="blockFirst" value="1" />}
          <Message state={state} />
          <Note tone="rose" icon="fa-triangle-exclamation">
            This erases <b>{company.name}</b> and everything it owns — {people}{" "}
            {people === 1 ? "person" : "people"}, and every voucher, party, account and ledger
            entry behind them. Nothing here can be brought back.
          </Note>
          {!blocked && (
            <Note tone="amber" icon="fa-ban">
              {company.code} is still running, so this will <b>block it and then delete it</b>.
              Anybody signed in there is thrown out either way.
            </Note>
          )}
          <Field label={`Type ${company.code} to confirm`} name="confirmCode" required autoFocus
                 autoComplete="off" spellCheck={false} className="[&_input]:uppercase [&_input]:tracking-widest"
                 value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Field label="Why" name="reason" required maxLength={300}
                 placeholder="Acceptance testing signed off; test company removed"
                 hint="Kept on the trail after the company itself is gone." />
          <SubmitButton pending={pending} icon="fa-trash" variant="danger" disabled={!matches}>
            {pending ? "Deleting…" : matches ? `Yes, delete ${company.code} for good` : "Type the code above"}
          </SubmitButton>
        </form>
      </Modal>
    </div>
  );
}
