import { Clock, ExternalLink, AlertCircle } from "lucide-react";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { cn } from "@/lib/utils";
import { statusLabel, statusVariant } from "@/lib/publishStatus";
import type { CalendarItem } from "../types";

function dayLabel(iso: string | null): string {
  if (!iso) return "Unscheduled";
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEEE, MMM d, yyyy");
}

interface CalendarListViewProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
}

export function CalendarListView({ items, onSelectItem }: CalendarListViewProps) {
  const groups: { day: string; rows: CalendarItem[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.scheduled_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(item);
    else groups.push({ day, rows: [item] });
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
          <Clock size={28} className="text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium">Nothing scheduled yet</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Approve a post in a campaign and use Schedule to plan it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const hasOverdue = g.rows.some(
          (r) => r.status === "scheduled" && r.scheduled_at && isPast(new Date(r.scheduled_at)),
        );
        return (
          <div key={g.day} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                {g.day}
                {hasOverdue && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertCircle size={10} className="mr-1" /> Overdue
                  </Badge>
                )}
              </h4>
              <span className="text-xs text-muted-foreground font-medium">
                {g.rows.length} post{g.rows.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="divide-y divide-border">
              {g.rows.map((item) => {
                const overdue = item.status === "scheduled" && item.scheduled_at && isPast(new Date(item.scheduled_at));
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectItem(item)}
                    className="w-full text-left px-5 py-3.5 hover:bg-muted/30 transition-colors flex items-center gap-4 group"
                  >
                    <div className="flex items-center gap-2 w-20 shrink-0">
                      <Clock size={14} className="text-muted-foreground" />
                      <span className={cn(
                        "text-sm tabular-nums font-medium",
                        overdue ? "text-destructive" : "text-muted-foreground",
                      )}>
                        {item.scheduled_at
                          ? new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <PlatformIcon platform={item.platform} size={16} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {item.channel_name || platformLabel(item.platform)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.client_name} · {item.preview || item.headline || "(no copy)"}
                        </p>
                      </div>
                    </div>
                    <Badge variant={statusVariant(item.status)} className="shrink-0">
                      {statusLabel(item.status)}
                    </Badge>
                    {item.published_url && (
                      <ExternalLink size={14} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
