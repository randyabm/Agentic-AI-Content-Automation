import { Check, Circle, CircleDashed, FileText, Globe, Lightbulb, Loader2, Palette, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OnboardingStep, OnboardingStepStatus } from "../types";

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  /** When the whole job is done, all steps are forced to "done" even if some
   *  were "error" (so the connector reaches the final "Ready" node). */
  jobComplete?: boolean;
  /** Compact = vertical list (used in the ClientDrawer where horizontal
   *  space is limited). Default = horizontal grid (used on the setup page). */
  compact?: boolean;
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

function StepIcon({ stepKey, tone }: { stepKey: string; tone: string }) {
  const Icon = STEP_ICON[stepKey] ?? CircleDashed;
  if (tone === "running") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (tone === "done") return <Check className="h-4 w-4" />;
  if (tone === "error") return <Circle className="h-4 w-4 fill-current" />;
  return <Icon className="h-4 w-4" />;
}

export function OnboardingStepper({ steps, jobComplete = false, compact = false }: OnboardingStepperProps) {
  if (compact) {
    return (
      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const tone = statusTone(step.status, jobComplete);
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm",
                tone === "done" && "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
                tone === "running" && "border-primary/30 bg-primary/5 text-primary",
                tone === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
                tone === "skipped" && "border-border bg-muted/40 text-muted-foreground",
                tone === "pending" && "border-border bg-muted/20 text-muted-foreground",
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <StepIcon stepKey={step.key} tone={tone} />
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1 min-w-0 truncate text-foreground font-normal">
                    {step.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{step.label}</TooltipContent>
              </Tooltip>
              <span className="text-[10px] opacity-60 tabular-nums">{i + 1}/{steps.length}</span>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {steps.map((step, i) => {
        const tone = statusTone(step.status, jobComplete);
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
                <StepIcon stepKey={step.key} tone={tone} />
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
