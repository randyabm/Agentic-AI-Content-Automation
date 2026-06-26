import { useState, useMemo } from "react";
import {
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
  format,
  startOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./PlatformIcon";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "../types";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8am - 9pm
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_BAR: Record<string, string> = {
  scheduled: "bg-amber-400",
  publishing: "bg-amber-400",
  published: "bg-emerald-500",
  failed: "bg-red-500",
};

interface CalendarWeekViewProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
  onDropPost: (postId: string, campaignId: string, date: Date) => void;
}

export function CalendarWeekView({ items, onSelectItem, onDropPost }: CalendarWeekViewProps) {
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
        <h3 className="text-lg font-semibold tracking-tight">
          {format(weekDays[0], "MMM d")} – {format(weekDays[6], "MMM d, yyyy")}
        </h3>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentWeek(new Date())}>
            This week
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm overflow-x-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[900px]">
          <div className="border-b border-border bg-muted/50" />
          {weekDays.map((day) => {
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className={cn(
                "border-b border-l border-border bg-muted/50 px-2 py-3 text-center",
                today && "bg-primary/5",
              )}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {WEEKDAYS[(day.getDay() + 6) % 7]}
                </div>
                <div className={cn(
                  "text-lg font-semibold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                  today ? "bg-primary text-primary-foreground" : "text-foreground",
                )}>
                  {format(day, "d")}
                </div>
              </div>
            );
          })}

          {HOURS.map((hour) => (
            <WeekHourRow
              key={hour}
              hour={hour}
              weekDays={weekDays}
              itemsByDayHour={itemsByDayHour}
              onSelectItem={onSelectItem}
              onDropPost={onDropPost}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekHourRow({
  hour,
  weekDays,
  itemsByDayHour,
  onSelectItem,
  onDropPost,
}: {
  hour: number;
  weekDays: Date[];
  itemsByDayHour: Map<string, CalendarItem[]>;
  onSelectItem: (item: CalendarItem) => void;
  onDropPost: (postId: string, campaignId: string, date: Date) => void;
}) {
  return (
    <>
      <div className="border-b border-border bg-muted/20 px-1 py-2 text-xs text-muted-foreground text-right font-medium tabular-nums">
        {hour > 12 ? `${hour - 12}p` : `${hour}a`}
      </div>
      {weekDays.map((day) => {
        const dayKey = format(startOfDay(day), "yyyy-MM-dd");
        const key = `${dayKey}-${hour}`;
        const hourItems = itemsByDayHour.get(key) || [];
        const dropDate = new Date(day);
        dropDate.setHours(hour, 0, 0, 0);
        return (
          <HourCell
            key={key}
            dropId={key}
            dropDate={dropDate}
            hourItems={hourItems}
            onSelectItem={onSelectItem}
            onDropPost={onDropPost}
          />
        );
      })}
    </>
  );
}

function HourCell({
  dropId,
  dropDate,
  hourItems,
  onSelectItem,
  onDropPost,
}: {
  dropId: string;
  dropDate: Date;
  hourItems: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
  onDropPost: (postId: string, campaignId: string, date: Date) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `hour-${dropId}`,
    data: { day: dropDate, type: "hour" },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-b border-l border-border min-h-[56px] p-1 hover:bg-muted/20 transition-colors",
        isOver && "bg-primary/10 ring-2 ring-primary/40 ring-inset",
      )}
    >
      {hourItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelectItem(item)}
          className={cn(
            "w-full text-left text-xs px-2 py-1.5 rounded-md mb-1",
            "bg-muted/60 hover:bg-primary/10 hover:ring-1 hover:ring-primary/20",
            "transition-all flex items-center gap-1.5 group",
          )}
        >
          <span className={cn("w-1 h-1 rounded-full shrink-0", STATUS_BAR[item.status] ?? "bg-slate-300")} />
          <PlatformIcon platform={item.platform} size={12} />
          <span className="truncate flex-1 font-medium text-foreground/80 group-hover:text-foreground">
            {item.headline || item.preview || "Untitled"}
          </span>
        </button>
      ))}
      {isOver && hourItems.length === 0 && (
        <div className="text-xs text-primary text-center py-1 font-medium">
          Drop
        </div>
      )}
    </div>
  );
}
