import { setUiModeAction } from "@/app/actions/ui-mode";
import { Icon } from "@/components/ui";

/** One button: Simple ⇄ Full. Server-rendered, so it works before any JavaScript loads. */
export function ModeSwitch({ current, onDark = false }: { current: "simple" | "full"; onDark?: boolean }) {
  const toFull = current === "simple";
  return (
    <form action={setUiModeAction}>
      <input type="hidden" name="mode" value={toFull ? "full" : "simple"} />
      <button type="submit"
        title={toFull ? "The full portal — every menu, for the accountant" : "The simple portal — Entry · Home · Money · People · Reports"}
        className={onDark
          ? "flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/30 px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/15"
          : "flex items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"}>
        <Icon name={toFull ? "fa-table-columns" : "fa-wand-magic-sparkles"} className="text-[11px]" />
        {toFull ? "Full portal" : "Simple portal"}
      </button>
    </form>
  );
}
