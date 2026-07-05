import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Consistent page title block. Preflight is off in this project, so a bare
 * <h1> would inherit the browser's default sizing — this standardizes every
 * page to the same title style, with an optional description and right-aligned
 * action slot.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
