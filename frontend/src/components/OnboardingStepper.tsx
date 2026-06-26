import { Check, Circle, CircleDashed, FileText, Globe, Lightbulb, Loader2, Palette, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingStep, OnboardingStepStatus } from "../types";

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  /** When the whole job is done, all steps are forced to "done" even if some
   *  were "error" (so the connector reaches the final "Ready" node). */
  jobComplete?: boolean;
}

const STEP_ICON: Record<string, LucideIcon> = {
  profile: Globe,
  branding: FileText,
  brand_memory: Palette,
  competitors: Search,
  articles: Lightbulb,
};

function statusTone(status: OnboardingStepStatus, jobComplete: boolean) {
  if (jobComplete) return "done" as const;
  switch (status) {
    case "ok": return "done" as const;
    case "running": return "running" as const;
    case "error": return "error" as const;
    case "skipped": return "skipped" as const;
    case "pending":
    default:
      return "pending" as const;
  }
}

export function OnboardingStepper({ steps, jobComplete = false }: OnboardingStepperProps) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {steps.map((step, i) => {
        const tone = statusTone(step.status, jobComplete);
        const Icon = STEP_ICON[step.key] ?? CircleDashed;
        return (
          <li
            key={step.key}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-sm transition-colors",
              tone === "done" && "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
              tone === "running" && "border-primary/30 bg-primary/5 text-primary",
              tone === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
              tone === "skipped" && "border-border bg-muted/40 text-muted-foreground",
              tone === "pending" && "border-border bg-muted/20 text-muted-foreground",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {tone === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : tone === "done" ? (
                  <Check className="h-4 w-4" />
                ) : tone === "error" ? (
                  <Circle className="h-4 w-4 fill-current" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </span>
              <span className="font-medium leading-tight text-foreground line-clamp-2">
                {step.label}
              </span>
            </div>
            <div className="mt-1 pl-8 text-xs opacity-80">
              {i + 1} of {steps.length}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
