"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Icon, cn } from "@/components/ui";
import { Modal } from "@/components/ui/client";

const CloseCtx = createContext<() => void>(() => {});
/** Inside a ModalButton: call to close the modal (e.g. after a successful save). */
export const useCloseModal = () => useContext(CloseCtx);

const styles = {
  primary: "bg-sky-600 hover:bg-sky-700 text-white shadow-sm",
  secondary: "bg-white hover:bg-sky-50 text-slate-700 border border-sky-200",
  ghost: "hover:bg-sky-50 text-sky-700",
  icon: "h-8 w-8 justify-center !px-0 text-slate-500 hover:bg-sky-50",
} as const;

export function ModalButton({
  label,
  icon,
  title,
  children,
  variant = "primary",
  width,
  tooltip,
}: {
  label?: string;
  icon?: string;
  title: string;
  children: ReactNode;
  variant?: keyof typeof styles;
  width?: string;
  tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <button
        type="button"
        title={tooltip}
        onClick={() => {
          setN((x) => x + 1);
          setOpen(true);
        }}
        className={cn("inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium", styles[variant])}
      >
        {icon && <Icon name={icon} />}
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} width={width}>
        <CloseCtx.Provider value={() => setOpen(false)}>{open && <div key={n}>{children}</div>}</CloseCtx.Provider>
      </Modal>
    </>
  );
}

