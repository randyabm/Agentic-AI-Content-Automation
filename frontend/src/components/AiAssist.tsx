import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Field = "headline" | "copy" | "cta" | "hashtags";

const ACTIONS_BY_FIELD: Record<Field, { key: string; label: string }[]> = {
  hashtags: [{ key: "hashtags", label: "Suggest hashtags" }],
  headline: commonActions(),
  copy: commonActions(),
  cta: commonActions(),
};

function commonActions() {
  return [
    { key: "improve", label: "Improve" },
    { key: "shorten", label: "Shorten" },
    { key: "punchy", label: "More punchy" },
    { key: "grammar", label: "Fix grammar" },
    { key: "professional", label: "More professional" },
    { key: "casual", label: "More casual" },
  ];
}

/**
 * Inline "improve with AI" control: a sparkle button that opens a popover of
 * quick-action chips. Picking one asks the backend to revise the field's
 * current text and shows the suggestion for the user to apply or discard
 * (nothing is saved until they hit the form's Save).
 */
export function AiAssist({
  campaignId,
  postId,
  field,
  value,
  onApply,
  disabled,
  className,
  label,
}: {
  campaignId: string;
  postId: string;
  field: Field;
  value: string;
  onApply: (text: string) => void;
  disabled?: boolean;
  className?: string;
  /** When set, render a labelled button (icon + text) instead of icon-only. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState("");

  function reset() {
    setSuggestion(null);
    setBusy("");
    setLastAction("");
  }

  async function run(action: string) {
    if (!value.trim()) {
      toast.error("Write some text first, then improve it.");
      return;
    }
    setBusy(action);
    setLastAction(action);
    setSuggestion(null);
    try {
      const res = await api<{ suggestion: string }>(
        `/campaigns/${campaignId}/posts/${postId}/improve`,
        { method: "POST", body: { field, text: value, action } },
      );
      setSuggestion(res.suggestion);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not improve the text");
    } finally {
      setBusy("");
    }
  }

  const actions = ACTIONS_BY_FIELD[field];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        {label ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            title="Improve with AI"
            className={cn("gap-1.5 text-primary", className)}
          >
            <Sparkles size={14} /> {label}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            // Stop the click from reaching the field underneath (e.g. opening the
            // TextareaZoom editor on the Copy field).
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            title="Improve with AI"
            aria-label="Improve with AI"
            className={cn("size-7 text-primary hover:bg-primary/10", className)}
          >
            <Sparkles size={15} />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles size={14} className="text-primary" /> Improve with AI
          </div>

          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <Button
                key={a.key}
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => run(a.key)}
                className={busy === a.key ? "opacity-70" : ""}
              >
                {busy === a.key ? "Working…" : a.label}
              </Button>
            ))}
          </div>

          {suggestion !== null && (
            <div className="flex flex-col gap-2">
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-sm whitespace-pre-wrap">
                {suggestion || <span className="text-muted-foreground">(empty)</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onApply(suggestion);
                    toast.success("Applied — remember to Save");
                    setOpen(false);
                    reset();
                  }}
                >
                  <Check size={14} /> Replace
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSuggestion(null)}>
                  <X size={14} /> Discard
                </Button>
                <button
                  type="button"
                  className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => run(lastAction)}
                  disabled={!!busy}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
