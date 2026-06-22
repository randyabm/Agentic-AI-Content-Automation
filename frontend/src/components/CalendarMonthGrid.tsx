import { useState, useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PlatformIcon } from "./PlatformIcon";
import type { CalendarItem } from "../types";

const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-amber-500",
  publishing: "bg-amber-500",
  published: "bg-green-500",
  partial: "bg-amber-500",
  failed: "bg-red-500",
  draft: "bg-gray-400",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarMonthGridProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
}

export function CalendarMonthGrid({ items, onSelectItem }: CalendarMonthGridProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      if (!item.scheduled_at) continue;
      const day = new Date(item.scheduled_at);
      const key = format(day, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const unscheduled = useMemo(() => items.filter((i) => !i.scheduled_at), [items]);

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CalendarDays size={18} />
          {format(currentMonth, "MMMM yyyy")}
        </h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
        {/* Weekday headers */}
        {WEEKDAYS.map((day) => (
          <div key={day} className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {day}
          </div>
        ))}
        {/* Days */}
        {days.map((day) => {
          const dayItems = itemsByDay.get(format(day, "yyyy-MM-dd")) || [];
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const today = isToday(day);

          return (
            <div
              key={day.toISOString()}
              className={`bg-background min-h-[100px] p-1.5 ${!isCurrentMonth ? "opacity-40" : ""}`}
            >
              <div className={`text-xs mb-1 ${today ? "font-bold text-primary" : "text-muted-foreground"}`}>
                {format(day, "d")}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onSelectItem(item)}
                    className="w-full text-left text-xs px-1.5 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1"
                  >
                    <PlatformIcon platform={item.platform} size={12} />
                    <span className="truncate flex-1">
                      {item.scheduled_at && new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      {" "}
                      {item.headline || item.preview || ""}
                    </span>
                    <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[item.status] ?? "bg-gray-400"}`} />
                  </button>
                ))}
                {dayItems.length > 3 && (
                  <p className="text-xs text-muted-foreground px-1.5">+{dayItems.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unscheduled posts */}
      {unscheduled.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h4 className="text-sm font-medium mb-2">Unscheduled ({unscheduled.length})</h4>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectItem(item)}
                className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1"
              >
                <PlatformIcon platform={item.platform} size={12} />
                <span className="truncate">{item.headline || item.preview || "Untitled"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
