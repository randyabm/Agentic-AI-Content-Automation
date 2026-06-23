import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { api } from "../api";
import type { CalendarItem, ScheduleablePost } from "../types";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { ScheduleablePostsSidebar } from "./ScheduleablePostsSidebar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ALL = { client: "all", platform: "all" } as const;

/**
 * Campaign-scoped scheduler. Reuses the global calendar's two-pane layout
 * (draggable approved posts on the left, month grid on the right) but limits
 * the data to a single campaign and highlights the campaign's date window.
 */
export function CampaignSchedulerModal({
  campaignId,
  startDate,
  endDate,
  onClose,
  onDone,
}: {
  campaignId: string;
  startDate: string | null;
  endDate: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [scheduleable, setScheduleable] = useState<ScheduleablePost[]>([]);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const minDate = useMemo(() => (startDate ? new Date(startDate) : null), [startDate]);
  const maxDate = useMemo(() => (endDate ? new Date(endDate) : null), [endDate]);

  const load = useCallback(async () => {
    try {
      const [calendarData, scheduleableData] = await Promise.all([
        api<CalendarItem[]>("/calendar"),
        api<ScheduleablePost[]>("/scheduleable-posts?include_blocked=1"),
      ]);
      setItems(calendarData.filter((i) => i.campaign_id === campaignId));
      setScheduleable(scheduleableData.filter((p) => p.campaign_id === campaignId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load scheduler");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDropPost(postId: string, campId: string, date: Date) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const when = new Date(date);
    if (when.getHours() === 0 && when.getMinutes() === 0) {
      when.setHours(9, 0, 0, 0);
    }
    if (when <= new Date()) {
      toast.error("Can't schedule in the past — pick a future date");
      return;
    }
    try {
      await api(`/campaigns/${campId}/posts/${postId}/schedule`, {
        method: "POST",
        body: { scheduled_at: when.toISOString(), timezone: tz },
      });
      toast.success(
        `Scheduled for ${when.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })} at ${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`,
      );
      await load();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scheduling failed");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    if (!activeId.startsWith("sched-")) return;
    const postId = activeId.replace("sched-", "");
    const post = scheduleable.find((p) => p.post_id === postId);
    if (!post) return;
    const overData = over.data.current;
    if (!overData || !overData.day) return;
    await handleDropPost(postId, post.campaign_id, overData.day as Date);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays size={18} /> Schedule posts
          </DialogTitle>
          <DialogDescription>
            Drag an approved post onto a day to schedule it (9:00 AM).
            {minDate || maxDate
              ? " The campaign window is highlighted — days outside it are disabled."
              : " Set a campaign date range to limit scheduling to a window."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw size={20} className="animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading…</span>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex-1 flex overflow-hidden border-t border-border">
              <ScheduleablePostsSidebar posts={scheduleable} filters={ALL} />
              <div className="flex-1 overflow-auto p-6">
                <CalendarMonthGrid
                  items={items}
                  onSelectItem={() => {}}
                  onDropPost={handleDropPost}
                  minDate={minDate}
                  maxDate={maxDate}
                  initialMonth={minDate}
                />
              </div>
            </div>
          </DndContext>
        )}
      </DialogContent>
    </Dialog>
  );
}
