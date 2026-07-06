import { useEffect, useMemo, useState } from "react";
import { X, Rocket, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PublishAllResponse, PublishCandidate, PublishPreviewResponse } from "../types";

export function PublishAllDialog({
  campaignId,
  onClose,
  onDone,
}: {
  campaignId: string;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<PublishCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PublishAllResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api<PublishPreviewResponse>(`/campaigns/${campaignId}/publish-preview`)
      .then((r) => {
        if (!alive) return;
        setCandidates(r.candidates);
        setSelected(new Set(r.candidates.filter((c) => c.publishable).map((c) => c.post_id)));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load posts"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [campaignId]);

  const publishable = useMemo(() => candidates.filter((c) => c.publishable), [candidates]);
  const blocked = useMemo(() => candidates.filter((c) => !c.publishable), [candidates]);

  function toggle(postId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  }

  async function publish() {
    if (selected.size === 0) return;
    setPublishing(true);
    setError("");
    try {
      const res = await api<PublishAllResponse>(`/campaigns/${campaignId}/publish`, {
        method: "POST",
        body: { post_ids: Array.from(selected) },
      });
      setResults(res);
      if (res.failed === 0) toast.success(`Published ${res.published} post${res.published === 1 ? "" : "s"}`);
      else toast.warning(`Published ${res.published}, ${res.failed} failed`);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-3.5">
          <h2 className="m-0 text-lg font-semibold">Publish to all platforms</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={16} /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <p className="text-sm text-muted-foreground">Loading posts…</p>}
          {error && (
            <div className="mb-3 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}

          {!loading && !results && (
            <>
              {publishable.length > 0 ? (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    These posts will be published immediately to their connected channels. Uncheck any you want to skip.
                  </p>
                  <div className="mb-4 flex flex-col gap-1.5">
                    {publishable.map((c) => (
                      <label key={c.post_id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                        <input type="checkbox" checked={selected.has(c.post_id)} onChange={() => toggle(c.post_id)} className="size-4 accent-primary" />
                        <PlatformIcon platform={c.platform} size={16} />
                        <span className="font-medium">{platformLabel(c.platform)}</span>
                        {c.headline && <span className="truncate text-muted-foreground">· {c.headline}</span>}
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mb-3 text-sm text-muted-foreground">No posts are ready to publish right now.</p>
              )}

              {blocked.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Won't be published ({blocked.length})</p>
                  <div className="flex flex-col gap-1.5">
                    {blocked.map((c) => (
                      <div key={c.post_id} className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                        <PlatformIcon platform={c.platform} size={16} />
                        <span className="font-medium">{platformLabel(c.platform)}</span>
                        <span className="ml-auto text-xs">{c.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {results && (
            <div className="flex flex-col gap-1.5">
              <p className="mb-1 text-sm">
                <strong>{results.published}</strong> published
                {results.failed > 0 && <> · <strong className="text-red-600">{results.failed}</strong> failed</>}
                {results.skipped > 0 && <> · {results.skipped} skipped</>}
              </p>
              {results.results.map((r) => (
                <div key={r.post_id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm">
                  {r.status === "published"
                    ? <CheckCircle2 size={16} className="text-emerald-600" />
                    : <AlertTriangle size={16} className={r.status === "failed" ? "text-red-600" : "text-amber-500"} />}
                  <PlatformIcon platform={r.platform} size={16} />
                  <span className="font-medium">{platformLabel(r.platform)}</span>
                  <span className={cn("ml-auto text-xs", r.status === "failed" ? "text-red-600" : "text-muted-foreground")}>
                    {r.status === "published" ? "Published" : r.status === "failed" ? (r.error || "Failed") : (r.error || "Skipped")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-3.5">
          {results ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={publishing}>Cancel</Button>
              <Button onClick={publish} disabled={publishing || selected.size === 0}>
                <Rocket size={14} /> {publishing ? "Publishing…" : `Publish ${selected.size} post${selected.size === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
