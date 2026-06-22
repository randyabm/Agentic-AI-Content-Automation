export function WorkflowStepper({ currentStep }: { currentStep: "draft" | "preview" | "approval" | "live" }) {
  const steps = [
    { key: "draft", label: "Draft", icon: "check_circle" },
    { key: "preview", label: "Preview", icon: "visibility" },
    { key: "approval", label: "Approval", icon: "lock" },
    { key: "live", label: "Live", icon: "rocket_launch" },
  ] as const;

  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="tonal-card rounded-xl p-lg space-y-md">
      <h3 className="font-headline-md text-headline-md" style={{ fontSize: "1.1rem", fontWeight: 600 }}>Approval Workflow</h3>
      <div className="flex items-center gap-0 w-full">
        {steps.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isUpcoming = i > currentIndex;

          let circleClass = "bg-surface-container-high text-on-surface-variant";
          let lineClass = "bg-outline-variant";
          let labelClass = "text-on-surface-variant";
          let icon: React.ReactNode = <span className="material-symbols-outlined text-sm">{step.icon}</span>;

          if (isCompleted) {
            circleClass = "bg-[#6d28d9] text-white";
            lineClass = "bg-[#6d28d9]";
            labelClass = "font-bold text-[#5300b7]";
            icon = <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>;
          }
          if (isCurrent) {
            circleClass = "bg-[#6d28d9] text-white";
            lineClass = "bg-outline-variant";
            labelClass = "font-bold text-[#5300b7]";
            icon = <div className="w-2 h-2 rounded-full bg-white animate-pulse" />;
          }

          return (
            <div key={step.key} className="flex flex-col items-center flex-1 relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 border-4 border-[#f9fafb] ${circleClass}`}>
                {icon}
              </div>
              <span className={`text-label-md mt-2 ${labelClass}`} style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>{step.label}</span>
              {i < steps.length - 1 && (
                <div className={`absolute top-4 left-1/2 w-full h-[2px] ${lineClass}`} style={{ zIndex: 0 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
