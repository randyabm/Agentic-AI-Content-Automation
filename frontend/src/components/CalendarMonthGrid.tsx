import { useState, useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  isBefore,
  startOfDay,
  addMonths,
  subMonths,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./PlatformIcon";
import { cn } from "@/lib/utils";
import { statusBar } from "@/lib/publishStatus";
import type { CalendarItem } from "../types";

const STATUS_BAR: Record<string, string> = {
  scheduled: "bg-amber-400",
  publishing: "bg-amber-400",
  published: "bg-emerald-500",
  failed: "bg-red-500",
  retrying: "bg-orange-500",
  throttled: "bg-orange-300",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarMonthGridProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
  onDropPost: (postId: string, campaignId: string, date: Date) => void;
  /** Optional campaign window — days inside [minDate, maxDate] are highlighted
   *  and droppable; days outside are dimmed and reject drops. When omitted,
   *  every (non-past) day is droppable (the global calendar behaviour). */
  minDate?: Date | null;
  maxDate?: Date | null;
  /** Month to open on (defaults to the current month). */
  initialMonth?: Date | null;
}

export function CalendarMonthGrid({
  items,
  onSelectItem,
  onDropPost,
  minDate,
  maxDate,
  initialMonth,
}: CalendarMonthGridProps) {
  const [currentMonth, setCurrentMonth] = useState(initialMonth ?? new Date());

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
      const key = format(new Date(item.scheduled_at), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight">
          {format(currentMonth, "MMMM yyyy")}
        </h3>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
        <div className="grid grid-cols-7 border-b border-border bg-muted/50">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const hasWindow = !!(minDate || maxDate);
            const today0 = startOfDay(new Date());
            const isPast = isBefore(startOfDay(day), today0);
            const beforeWindow = minDate ? isBefore(startOfDay(day), startOfDay(minDate)) : false;
            const afterWindow = maxDate ? isBefore(startOfDay(maxDate), startOfDay(day)) : false;
            const inWindow = hasWindow && !beforeWindow && !afterWindow;
            // Droppable when not past and (no window, or inside the window).
            const droppable = !isPast && (!hasWindow || inWindow);
            return (
              <DayCell
                key={day.toISOString()}
                day={day}
                index={i}
                inMonth={isSameMonth(day, currentMonth)}
                today={isToday(day)}
                highlighted={hasWindow && inWindow}
                droppable={droppable}
                dayItems={itemsByDay.get(format(day, "yyyy-MM-dd")) || []}
                onSelectItem={onSelectItem}
                onDropPost={onDropPost}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayCell({
  day,
  index,
  inMonth,
  today,
  highlighted,
  droppable,
  dayItems,
  onSelectItem,
  onDropPost,
}: {
  day: Date;
  index: number;
  inMonth: boolean;
  today: boolean;
  highlighted: boolean;
  droppable: boolean;
  dayItems: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
  onDropPost: (postId: string, campaignId: string, date: Date) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${format(day, "yyyy-MM-dd")}`,
    data: { day, type: "day" },
    disabled: !droppable,
  });
  const isWeekend = index % 7 >= 5;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[110px] p-2 border-r border-b border-border last:border-r-0 transition-colors",
        !inMonth && "bg-muted/20",
        isWeekend && inMonth && "bg-muted/10",
        highlighted && "bg-primary/5",
        !droppable && "opacity-40",
        today && "ring-2 ring-primary ring-inset z-10",
        isOver && droppable && "bg-primary/10 ring-2 ring-primary/40 ring-inset",
      )}
    >
      <div className={cn(
        "text-xs mb-1.5 inline-flex items-center justify-center w-6 h-6 rounded-full font-medium",
        today ? "bg-primary text-primary-foreground" : "text-muted-foreground",
      )}>
        {format(day, "d")}
      </div>
      <div className="space-y-1">
        {dayItems.slice(0, 3).map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectItem(item)}
            className={cn(
              "w-full text-left text-xs px-2 py-1.5 rounded-md",
              "bg-muted/60 hover:bg-primary/10 hover:ring-1 hover:ring-primary/20",
              "transition-all duration-150 flex items-center gap-1.5 group",
            )}
          >
            <span className={cn("w-1 h-1 rounded-full shrink-0", STATUS_BAR[item.status] ?? "bg-slate-300")} />
            <PlatformIcon platform={item.platform} size={12} />
            {!item.channel_id && (
              <Lock
                size={11}
                className="shrink-0 text-amber-500"
                aria-label="Planned — no connected channel; won't auto-publish"
              />
            )}
            <span className="truncate flex-1 font-medium text-foreground/80 group-hover:text-foreground">
              {item.scheduled_at && new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              {" "}
              {item.headline || item.preview || "Untitled"}
            </span>
          </button>
        ))}
        {dayItems.length > 3 && (
          <button
            onClick={() => onSelectItem(dayItems[3])}
            className="text-xs text-muted-foreground hover:text-primary px-2 py-0.5 transition-colors font-medium"
          >
            +{dayItems.length - 3} more
          </button>
        )}
        {isOver && dayItems.length === 0 && (
          <div className="text-xs text-primary text-center py-2 font-medium">
            Drop to schedule
          </div>
        )}
      </div>
    </div>
  );
}
