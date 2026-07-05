import { cn } from "@/lib/utils";

/** Shared List / Cards view switch used by the Clients and Campaigns lists. */
export function ViewToggle({ value, onChange }: { value: "list" | "cards"; onChange: (v: "list" | "cards") => void }) {
  return (
    <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border">
      <button
        type="button"
        onClick={() => onChange("list")}
        title="List view"
        aria-label="List view"
        aria-pressed={value === "list"}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
          value === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
        )}
      >
        <span className="material-symbols-outlined text-base">list</span> List
      </button>
      <button
        type="button"
        onClick={() => onChange("cards")}
        title="Card view"
        aria-label="Card view"
        aria-pressed={value === "cards"}
        className={cn(
          "flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-sm transition-colors",
          value === "cards" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
        )}
      >
        <span className="material-symbols-outlined text-base">grid_view</span> Cards
      </button>
    </div>
  );
}
