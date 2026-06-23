import { useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import type { AutopilotPreview } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Convert an ISO instant to a Date for the picker. */
function toDate(iso: string): Date {
  return new Date(iso);
}

export function AutopilotModal({
  campaignId,
  onClose,
  onDone,
}: {
  campaignId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [preview, setPreview] = useState<AutopilotPreview | null>(null);
  const [times, setTimes] = useState<Record<string, Date>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function loadPreview() {
    setBusy(true);
    try {
      const p = await api<AutopilotPreview>(`/campaigns/${campaignId}/autopilot/preview`, {
        method: "POST",
        body: { timezone: tz, per_day: 2 },
      });
      setPreview(p);
      const t: Record<string, Date> = {};
      for (const prop of p.proposals) t[prop.post_id] = toDate(prop.suggested_at);
      setTimes(t);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function commit() {
    if (!preview || preview.proposals.length === 0) return;
    setBusy(true);
    try {
      const items = preview.proposals.map((p) => ({
        post_id: p.post_id,
        scheduled_at: (times[p.post_id] ?? toDate(p.suggested_at)).toISOString(),
      }));
      const created = await api<unknown[]>(`/campaigns/${campaignId}/autopilot/commit`, {
        method: "POST",
        body: { timezone: tz, items },
      });
      toast.success(`Scheduled ${created.length} post${created.length === 1 ? "" : "s"}`);
      setDone(true);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scheduling failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} /> AI auto-schedule
          </DialogTitle>
          <DialogDescription>
            The AI proposes an optimal time for each post ({tz}). Adjust any time, then confirm.
            Approved posts with a connected channel publish automatically at their slot; drafts or
            posts without a channel are planned only and won't auto-publish until they're ready.
          </DialogDescription>
        </DialogHeader>

        {busy && !preview && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw size={20} className="animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Proposing the best times…</span>
          </div>
        )}

        {preview && !done && (
          <>
            {preview.proposals.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">
                This campaign has no posts to schedule yet.
              </p>
            ) : (
              <div className="space-y-3">
                {preview.proposals.map((p) => (
                  <div
                    key={p.post_id}
                    className="flex flex-col gap-2 p-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={p.platform} size={16} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {p.channel_name || platformLabel(p.platform)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.preview || p.headline || "(no copy)"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <DateTimePicker
                        value={times[p.post_id] ?? null}
                        onChange={(d) => setTimes((prev) => ({ ...prev, [p.post_id]: d ?? toDate(p.suggested_at) }))}
                        className="flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {p.local_label}
                      </Badge>
                      {p.blocked_reason && (
                        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                          Plan only — {p.blocked_reason}
                        </Badge>
                      )}
                      <p className="text-xs text-muted-foreground">{p.rationale}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preview.skipped.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium mb-1">Skipped ({preview.skipped.length})</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {preview.skipped.map((s) => (
                    <li key={s.post_id}>
                      {platformLabel(s.platform)} — {s.headline || "post"}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {done && (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Posts scheduled successfully. They'll publish automatically at their times.
            </p>
          </div>
        )}

        <DialogFooter>
          {!done && preview && preview.proposals.length > 0 && (
            <>
              <Button variant="outline" onClick={loadPreview} disabled={busy}>
                <RefreshCw size={14} /> Re-propose
              </Button>
              <Button onClick={commit} disabled={busy}>
                {busy ? "Scheduling…" : `Schedule ${preview.proposals.length} post${preview.proposals.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
          {done && <Button onClick={onClose}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
