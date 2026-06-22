import { useState, useMemo } from "react";
import {
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  isToday,
  format,
  startOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./PlatformIcon";
import type { CalendarItem } from "../types";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8am - 9pm
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-amber-500",
  publishing: "bg-amber-500",
  published: "bg-green-500",
  partial: "bg-amber-500",
  failed: "bg-red-500",
  draft: "bg-gray-400",
};

interface CalendarWeekViewProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
}

export function CalendarWeekView({ items, onSelectItem }: CalendarWeekViewProps) {
  const [currentWeek, setCurrentWeek] = useState(new Date());

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentWeek]);

  const itemsByDayHour = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      if (!item.scheduled_at) continue;
      const day = new Date(item.scheduled_at);
      const dayKey = format(startOfDay(day), "yyyy-MM-dd");
      const hourKey = day.getHours();
      const key = `${dayKey}-${hourKey}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {format(weekDays[0], "MMM d")} – {format(weekDays[6], "MMM d, yyyy")}
        </h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentWeek(new Date())}>
            This week
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px bg-border min-w-[800px]">
          {/* Header row */}
          <div className="bg-muted" />
          {weekDays.map((day) => {
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className={`bg-muted px-2 py-1.5 text-center ${today ? "ring-2 ring-primary ring-inset" : ""}`}>
                <div className="text-xs text-muted-foreground">{WEEKDAYS[(day.getDay() + 6) % 7]}</div>
                <div className={`text-sm font-medium ${today ? "text-primary" : ""}`}>{format(day, "d")}</div>
              </div>
            );
          })}

          {/* Hour rows */}
          {HOURS.map((hour) => (
            <DayHourRow
              key={hour}
              hour={hour}
              weekDays={weekDays}
              itemsByDayHour={itemsByDayHour}
              onSelectItem={onSelectItem}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayHourRow({
  hour,
  weekDays,
  itemsByDayHour,
  onSelectItem,
}: {
  hour: number;
  weekDays: Date[];
  itemsByDayHour: Map<string, CalendarItem[]>;
  onSelectItem: (item: CalendarItem) => void;
}) {
  return (
    <>
      <div className="bg-muted/30 px-1 py-2 text-xs text-muted-foreground text-right">
        {hour > 12 ? `${hour - 12}p` : `${hour}a`}
      </div>
      {weekDays.map((day) => {
        const dayKey = format(startOfDay(day), "yyyy-MM-dd");
        const key = `${dayKey}-${hour}`;
        const hourItems = itemsByDayHour.get(key) || [];
        return (
          <div key={key} className="bg-background min-h-[48px] p-1">
            {hourItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectItem(item)}
                className="w-full text-left text-xs px-1.5 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1 mb-1"
              >
                <PlatformIcon platform={item.platform} size={12} />
                <span className="truncate flex-1">{item.headline || item.preview || ""}</span>
                <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[item.status] ?? "bg-gray-400"}`} />
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
