import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, RefreshCw } from "lucide-react";
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
import { ScheduleablePostsSidebar, SchedulePostOverlayCard } from "./ScheduleablePostsSidebar";
import { PlatformIcon } from "./PlatformIcon";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PendingDrop {
  post: ScheduleablePost;
  when: Date;
}

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
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [saving, setSaving] = useState(false);

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

  // Drop just picks the day — open a dialog to confirm the exact time (default 9:00 AM).
  function handleDropPost(postId: string, _campId: string, date: Date) {
    const post = scheduleable.find((p) => p.post_id === postId);
    if (!post) return;
    const when = new Date(date);
    if (when.getHours() === 0 && when.getMinutes() === 0) {
      when.setHours(9, 0, 0, 0);
    }
    setPending({ post, when });
  }

  async function confirmSchedule() {
    if (!pending) return;
    const { post, when } = pending;
    if (when <= new Date()) {
      toast.error("Can't schedule in the past — pick a future date and time");
      return;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setSaving(true);
    try {
      await api(`/campaigns/${post.campaign_id}/posts/${post.post_id}/schedule`, {
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
      setPending(null);
      await load();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scheduling failed");
    } finally {
      setSaving(false);
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
    <>
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays size={18} /> Schedule posts
          </DialogTitle>
          <DialogDescription>
            Drag a post onto a day to plan it, then pick a time. Drafts and posts without a
            connected channel can still be placed — they won't auto-publish until they're
            approved and a channel is connected.
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
            {createPortal(
              <DragOverlay dropAnimation={null}>
                {activePost ? <SchedulePostOverlayCard post={activePost} /> : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        )}
      </DialogContent>
    </Dialog>

    {/* Time picker for the dropped post */}
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pick a time</DialogTitle>
          <DialogDescription>
            Choose when this post should publish. Defaults to 9:00 AM on the day you dropped it.
          </DialogDescription>
        </DialogHeader>

        {pending && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-border p-3">
              <PlatformIcon platform={pending.post.platform} size={16} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{pending.post.client_name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {pending.post.headline || pending.post.preview || "(no copy)"}
                </p>
              </div>
            </div>
            <DateTimePicker
              value={pending.when}
              onChange={(d) => setPending((prev) => (prev && d ? { ...prev, when: d } : prev))}
            />
            {pending.post.blocked_reason && (
              <p className="text-xs text-amber-700">
                {pending.post.blocked_reason} — this will be planned only and won't auto-publish until a channel is connected.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirmSchedule} disabled={saving}>
            {saving ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
