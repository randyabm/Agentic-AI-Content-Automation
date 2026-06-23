import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw, GripVertical, Lock } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { api } from "../api";
import type { CalendarItem, ScheduleablePost } from "../types";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { ScheduleablePostsSidebar } from "./ScheduleablePostsSidebar";
import { PlatformIcon } from "./PlatformIcon";
import { cn } from "@/lib/utils";
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
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const activePost = activeId
    ? scheduleable.find((p) => `sched-${p.post_id}` === activeId) ?? null
    : null;

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

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const dragId = active.id as string;
    if (!dragId.startsWith("sched-")) return;
    const postId = dragId.replace("sched-", "");
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
            Drag an approved post onto a day to schedule it (9:00 AM). Posts without a
            connected channel can still be planned — they won't auto-publish until you
            connect a channel.
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
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
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
            <DragOverlay dropAnimation={null}>
              {activePost ? (
                <div
                  className={cn(
                    "w-60 rounded-lg border bg-card p-2.5 shadow-lg",
                    activePost.blocked_reason ? "border-amber-300 bg-amber-50/90" : "border-primary/30",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {activePost.blocked_reason ? (
                      <Lock size={14} className="text-amber-500/70 mt-0.5 shrink-0" />
                    ) : (
                      <GripVertical size={14} className="text-muted-foreground/40 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <PlatformIcon platform={activePost.platform} size={12} />
                        <span className="text-xs font-medium truncate">{activePost.client_name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {activePost.headline || activePost.preview || "(no copy)"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </DialogContent>
    </Dialog>
  );
}
