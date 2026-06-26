import { Link } from "react-router-dom";
import { Building2, Clock, Loader2, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClientAvatar } from "./ClientAvatar";
import type { Client } from "../types";

export type OnboardingState = "running" | "completed" | "completed_with_errors" | "failed" | "not_started" | "unknown";

export const ONBOARDING_LABEL: Record<OnboardingState, string> = {
  not_started: "Not started",
  running: "Setting up…",
  completed: "Ready",
  completed_with_errors: "Setup incomplete",
  failed: "Setup failed",
  unknown: "—",
};

const ONBOARDING_VARIANT: Record<OnboardingState, "default" | "secondary" | "destructive" | "outline"> = {
  not_started: "outline",
  running: "secondary",
  completed: "default",
  completed_with_errors: "destructive",
  failed: "destructive",
  unknown: "outline",
};

function OnboardingBadge({ state }: { state: OnboardingState | string | undefined }) {
  const normalized = (state || "unknown") as OnboardingState;
  const variant = ONBOARDING_VARIANT[normalized] ?? "outline";
  const label = ONBOARDING_LABEL[normalized] ?? String(state);
  return (
    <Badge variant={variant} className="gap-1.5 font-normal">
      {normalized === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {normalized === "completed" && <CheckCircle2 className="h-3 w-3" />}
      {normalized === "completed_with_errors" && <AlertTriangle className="h-3 w-3" />}
      {normalized === "failed" && <AlertTriangle className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

interface ClientCardProps {
  client: Client;
  onboardingState: string | undefined;
  canEdit: boolean;
  onDelete: (e: React.MouseEvent) => void;
  onClick?: () => void;
}

export function ClientCard({ client, onboardingState, canEdit, onDelete, onClick }: ClientCardProps) {
  const colors = client.brand_colors?.length ? client.brand_colors : null;
  const gradient = colors ? `linear-gradient(135deg, ${colors.slice(0, 3).join(", ")})` : undefined;

  return (
    <Card className="group relative overflow-hidden p-0 gap-0 transition-shadow hover:shadow-md">
      {/* Brand color banner */}
      {gradient && (
        <div
          aria-hidden
          className="h-20 w-full"
          style={{ background: gradient }}
        />
      )}
      {!gradient && (
        <div aria-hidden className="h-20 w-full bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-teal-500/10" />
      )}

      {canEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-7 w-7 bg-background/70 backdrop-blur opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background/90"
              onClick={onDelete}
              aria-label={`Delete ${client.company_name}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete client</TooltipContent>
        </Tooltip>
      )}

      <CardContent className="p-5">
        <Link
          to={`/clients/${client.id}`}
          className="block"
          onClick={(e) => {
            // If an onClick is provided, open the drawer instead of navigating.
            // (User can still click the link to go to the full detail page.)
            if (onClick && !(e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onClick();
            }
          }}
        >
          <div className="-mt-12 mb-3">
            <div className="inline-block rounded-full ring-4 ring-card">
              <ClientAvatar client={client} />
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold leading-tight tracking-tight text-base">
              {client.company_name}
            </h3>

            {client.industry && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{client.industry}</span>
              </div>
            )}

            <div className="pt-1">
              <OnboardingBadge state={onboardingState} />
            </div>

            {colors && colors.length > 0 && (
              <div className="flex items-center gap-1 pt-1">
                {colors.slice(0, 5).map((col, i) => (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <span
                        className="h-3 w-3 rounded-full ring-1 ring-border"
                        style={{ background: col }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{col}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {client.last_extraction_at
                  ? `Last analyzed ${new Date(client.last_extraction_at).toLocaleDateString()}`
                  : "Not analyzed yet"}
              </span>
            </div>
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}
