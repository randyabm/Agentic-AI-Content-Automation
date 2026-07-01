import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FAMILY_ACCENT_BORDER,
  STYLE_FAMILY_LABEL,
  STYLE_FAMILY_TINT,
} from "@/lib/styleFamilies";

export interface StyleAlternative {
  style_family: string;
  style_name: string;
  novelty_reason: string;
  visual_keywords: string[];
  colour_mood: string;
  image_prompt_without_text: string;
  negative_prompt: string;
  avoid: string[];
}


export function StyleAlternativesDialog({
  open,
  onOpenChange,
  campaignId,
  imageId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  campaignId: string;
  imageId: string;
  onApplied: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<StyleAlternative[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setPicked(null);
    setLoading(true);
    try {
      const res = await api<{
        alternatives: StyleAlternative[];
        excluded_families: string[];
      }>(`/campaigns/${campaignId}/images/${imageId}/style-alternatives`, {
        method: "POST",
      });
      setAlternatives(res.alternatives);
      setExcluded(res.excluded_families);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load style alternatives");
    } finally {
      setLoading(false);
    }
  }

  async function apply(alt: StyleAlternative) {
    setApplying(alt.style_family);
    setPicked(alt.style_family);
    try {
      await api(`/campaigns/${campaignId}/images/${imageId}/style-alternatives/apply`, {
        method: "POST",
        body: { alternative: alt, persist_prompt: true },
      });
      toast.success(`Style set to ${STYLE_FAMILY_LABEL[alt.style_family] ?? alt.style_family}. Regenerate to see it.`);
      onApplied();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply style");
    } finally {
      setApplying(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) void load();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={18} className="text-primary" />
            Try a different style
          </DialogTitle>
          <DialogDescription>
            {loading
              ? "Asking the Visual Agent for 3 fresh takes…"
              : alternatives.length === 0
                ? "Couldn't load alternatives right now."
                : excluded.length > 0
                  ? `Pick a different visual direction. We skipped ${excluded.length} style${excluded.length === 1 ? "" : "s"} you've used most recently.`
                  : "Pick a different visual direction."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border-l-[3px] border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Generating alternatives…
          </div>
        ) : alternatives.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {error
              ? "Try again in a moment, or hit Regenerate to keep the current style."
              : "Hit Regenerate to keep the current style, or tweak the prompt below to nudge the agent in a new direction."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {alternatives.map((alt) => {
              const tint = STYLE_FAMILY_TINT[alt.style_family] ?? "from-slate-400 to-slate-600";
              const ringClass = picked === alt.style_family ? `ring-2 ${FAMILY_ACCENT_BORDER[alt.style_family] ?? "ring-primary"}` : "";
              return (
                <button
                  type="button"
                  key={alt.style_family}
                  disabled={applying !== null}
                  onClick={() => void apply(alt)}
                  className={cn(
                    "group flex flex-col items-stretch overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md disabled:opacity-60 disabled:hover:translate-y-0",
                    ringClass,
                  )}
                >
                  <div className={cn("h-20 bg-gradient-to-br", tint)} />
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        {STYLE_FAMILY_LABEL[alt.style_family] ?? alt.style_family}
                      </span>
                      {applying === alt.style_family ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <Sparkles size={12} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </div>
                    {alt.style_name && alt.style_name !== alt.style_family && (
                      <p className="text-xs font-medium italic text-muted-foreground">{alt.style_name}</p>
                    )}
                    {alt.colour_mood && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/70">Mood:</span> {alt.colour_mood}
                      </p>
                    )}
                    {alt.visual_keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {alt.visual_keywords.slice(0, 4).map((kw) => (
                          <span
                            key={kw}
                            className="rounded-full border border-border bg-surface-alt/60 px-1.5 py-px text-[10px] text-muted-foreground"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                    {alt.novelty_reason && (
                      <p className="mt-auto line-clamp-3 text-xs text-muted-foreground/90">
                        {alt.novelty_reason}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {excluded.length > 0 && !loading && alternatives.length > 0 && (
          <p className="text-center text-[11px] text-muted-foreground/70">
            Skipped (you've seen them recently): {excluded
              .map((f) => STYLE_FAMILY_LABEL[f] ?? f)
              .join(", ")}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying !== null}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
