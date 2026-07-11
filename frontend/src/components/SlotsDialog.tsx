import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PostingSlot } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Manage a client's recurring posting slots and fill them with approved,
 *  unscheduled posts (Phase 2 smart scheduling). */
export function SlotsDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
  onFilled,
}: {
  clientId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFilled: () => void;
}) {
  const [slots, setSlots] = useState<PostingSlot[]>([]);
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSlots(await api<PostingSlot[]>(`/clients/${clientId}/posting-slots`));
    } catch {
      /* ignore */
    }
  }, [clientId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function addSlot() {
    const [h, m] = time.split(":").map(Number);
    setBusy(true);
    try {
      await api(`/clients/${clientId}/posting-slots`, {
        method: "POST",
        body: { weekday, hour: h, minute: m || 0, platform: "" },
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add slot");
    } finally {
      setBusy(false);
    }
  }

  async function removeSlot(id: string) {
    try {
      await api(`/posting-slots/${id}`, { method: "DELETE" });
      setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
  }

  async function fill() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setBusy(true);
    try {
      const res = await api<{ scheduled: number; skipped: number; reason: string }>(
        `/clients/${clientId}/fill-slots`,
        { method: "POST", body: { timezone: tz } },
      );
      if (res.reason) toast.info(res.reason);
      else toast.success(`Scheduled ${res.scheduled} post${res.scheduled === 1 ? "" : "s"}${res.skipped ? `, ${res.skipped} skipped` : ""}`);
      onFilled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fill slots");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Posting slots · {clientName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Recurring weekly times. "Fill slots" drops approved, unscheduled posts into the next open times.
        </p>

        <div className="space-y-1.5">
          {slots.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No slots yet.</p>
          ) : (
            slots.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{DAYS[s.weekday]} · {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}</span>
                <button onClick={() => removeSlot(s.id)} className="text-xs text-destructive hover:underline">Remove</button>
              </div>
            ))
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border pt-3">
          <label className="text-xs">
            Day
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs">
            Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm" />
          </label>
          <Button size="sm" variant="outline" onClick={addSlot} disabled={busy}>Add</Button>
        </div>

        <div className="flex justify-end border-t border-border pt-3">
          <Button onClick={fill} disabled={busy || slots.length === 0}>Fill slots with approved posts</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
