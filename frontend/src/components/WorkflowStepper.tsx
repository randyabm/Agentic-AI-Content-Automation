import { cn } from "@/lib/utils";

export function WorkflowStepper({ currentStep }: { currentStep: "draft" | "preview" | "approval" | "live" }) {
  const steps = [
    { key: "draft", label: "Draft", icon: "check_circle" },
    { key: "preview", label: "Preview", icon: "visibility" },
    { key: "approval", label: "Approval", icon: "lock" },
    { key: "live", label: "Live", icon: "rocket_launch" },
  ] as const;

  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
      <h3 className="text-lg font-semibold tracking-tight">Approval Workflow</h3>
      <div className="flex w-full items-center gap-0">
        {steps.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex;

          const reached = isCompleted || isCurrent;
          const icon: React.ReactNode = isCurrent ? (
            <div className="size-2 animate-pulse rounded-full bg-primary-foreground" />
          ) : (
            <span className="material-symbols-outlined text-sm" style={isCompleted ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              {isCompleted ? "check_circle" : step.icon}
            </span>
          );

          return (
            <div key={step.key} className="relative flex flex-1 flex-col items-center">
              <div
                className={cn(
                  "z-10 flex size-8 items-center justify-center rounded-full border-4 border-background",
                  reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {icon}
              </div>
              <span
                className={cn(
                  "mt-2 whitespace-nowrap text-xs",
                  reached ? "font-bold text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={cn("absolute top-4 left-1/2 h-0.5 w-full", isCompleted ? "bg-primary" : "bg-border")}
                  style={{ zIndex: 0 }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
