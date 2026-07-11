import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";

interface PublicMedia {
  type: "image" | "video";
  url: string;
}

interface PublicPost {
  platform: string;
  headline: string;
  copy: string;
  cta: string;
  hashtags: string[];
  media: PublicMedia[];
}

interface PublicView {
  campaign_name: string;
  client_name: string;
  approval_status: string;
  approval_message: string;
  can_act: boolean;
  posts: PublicPost[];
}

/** Unauthenticated external approval page (Phase 2 public links). Reached at
 *  /approve/:token — preview + Approve / Request Changes, no account. */
export default function PublicApproval() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api<PublicView>(`/public/approval/${token}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "This link is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function approve() {
    setBusy("approve");
    try {
      setView(await api<PublicView>(`/public/approval/${token}/approve`, { method: "POST" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setBusy("");
    }
  }

  async function requestChanges() {
    if (!note.trim()) return;
    setBusy("changes");
    try {
      setView(await api<PublicView>(`/public/approval/${token}/request-changes`, {
        method: "POST",
        body: { note },
      }));
      setShowNote(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error && !view ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : view ? (
        <>
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{view.client_name}</p>
            <h1 className="text-2xl font-bold tracking-tight">{view.campaign_name}</h1>
            <StatusLine status={view.approval_status} />
            {view.approval_message && (
              <p className="mt-2 rounded-md border-l-2 border-primary bg-accent/40 px-3 py-2 text-sm">{view.approval_message}</p>
            )}
          </div>

          <div className="space-y-3">
            {view.posts.map((p, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{p.platform}</p>
                {p.media && p.media.length > 0 && (
                  <div className={`mb-3 grid gap-2 ${p.media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {p.media.map((m, mi) =>
                      m.type === "video" ? (
                        <video key={mi} src={m.url} controls className="w-full rounded-lg border border-border" />
                      ) : (
                        <img key={mi} src={m.url} alt="" loading="lazy" className="w-full rounded-lg border border-border object-cover" />
                      ),
                    )}
                  </div>
                )}
                {p.headline && <p className="text-sm font-semibold">{p.headline}</p>}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.copy}</p>
                {p.cta && <p className="mt-1 text-sm font-medium">{p.cta}</p>}
                {p.hashtags.length > 0 && (
                  <p className="mt-1 text-xs text-primary">{p.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
                )}
              </div>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          {view.can_act ? (
            <div className="sticky bottom-0 mt-6 rounded-xl border border-border bg-card p-4 shadow-lg">
              {showNote ? (
                <div className="space-y-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What needs to change?"
                    rows={3}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button onClick={requestChanges} disabled={!note.trim() || busy === "changes"} variant="destructive">
                      Send request
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowNote(false); setNote(""); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={approve} disabled={!!busy}>
                    Approve
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setShowNote(true)} disabled={!!busy}>
                    Request changes
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              This campaign is no longer awaiting your decision.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function StatusLine({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending_review: { label: "Awaiting your approval", cls: "text-amber-600" },
    approved: { label: "Approved", cls: "text-emerald-600" },
    changes_requested: { label: "Changes requested", cls: "text-amber-600" },
    rejected: { label: "Rejected", cls: "text-red-600" },
    draft: { label: "Draft", cls: "text-muted-foreground" },
  };
  const s = map[status] ?? map.draft;
  return <p className={`mt-1 text-sm font-medium ${s.cls}`}>{s.label}</p>;
}
