import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** Omit `to` for the current (last) page — it renders as plain text. */
  to?: string;
}

/**
 * Consistent page breadcrumb used across every detail page (client, campaign,
 * setup, preview…). Links use `text-primary`; the current page is
 * `text-foreground`. Rendered with real `<Link>`/`<span>` so it isn't affected
 * by the browser's native `<button>` chrome (preflight is off in this project).
 */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-3 flex items-center gap-1.5 text-sm", className)}>
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/50" aria-hidden />}
          {c.to ? (
            <Link to={c.to} className="font-medium text-primary hover:underline">{c.label}</Link>
          ) : (
            <span className="font-medium text-foreground" aria-current="page">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
