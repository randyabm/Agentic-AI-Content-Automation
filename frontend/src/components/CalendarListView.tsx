import { Link } from "react-router-dom";
import { Clock, ExternalLink } from "lucide-react";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import type { CalendarItem } from "../types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "outline",
  publishing: "outline",
  published: "default",
  partial: "destructive",
  failed: "destructive",
};

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
  // Group by day
  const groups: { day: string; rows: CalendarItem[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.scheduled_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(item);
    else groups.push({ day, rows: [item] });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="text-muted-foreground">
          Nothing scheduled yet. Approve a post in a campaign and use <em>Schedule…</em> to plan it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const hasOverdue = g.rows.some(
          (r) => r.status === "scheduled" && r.scheduled_at && isPast(new Date(r.scheduled_at)),
        );
        return (
          <div key={g.day} className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 flex items-center justify-between">
              <h4 className="text-sm font-medium">{g.day}</h4>
              <span className="text-xs text-muted-foreground">
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
                    className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-center gap-4"
                  >
                    <div className="flex items-center gap-2 w-20 shrink-0">
                      <Clock size={14} className="text-muted-foreground" />
                      <span className={`text-sm ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                        {item.scheduled_at
                          ? new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
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
                    <Badge variant={STATUS_VARIANT[item.status] ?? "default"} className="shrink-0">
                      {item.status}
                    </Badge>
                    {item.published_url && (
                      <ExternalLink size={14} className="text-muted-foreground shrink-0" />
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
