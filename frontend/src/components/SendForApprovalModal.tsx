import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextareaZoom } from "./TextareaZoom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { toast } from "sonner";
import type { CampaignDetail, Post, User } from "../types";

interface SendForApprovalModalProps {
  campaignId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}

export function SendForApprovalModal({ campaignId, onClose, onDone }: SendForApprovalModalProps) {
  const [approvers, setApprovers] = useState<User[]>([]);
  const [approverId, setApproverId] = useState("");
  const [scope, setScope] = useState<"full_campaign" | "individual_posts">("full_campaign");
  const [message, setMessage] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<User[]>("/team")
      .then((members) => {
        const reviewers = members.filter((m) => m.org_role === "reviewer" || m.org_role === "org_admin");
        setApprovers(reviewers);
        if (reviewers.length === 0) {
          setError("No reviewers or org admins are available to approve. Add one under Team first.");
        }
      })
      .catch(() => setError("Couldn't load the approver list. Close this dialog and try again."));
    // Load the campaign's posts so individual-post approval can pick a subset.
    api<CampaignDetail>(`/campaigns/${campaignId}`)
      .then((c) => {
        setPosts(c.posts ?? []);
        setSelected(new Set((c.posts ?? []).map((p) => p.id)));
      })
      .catch(() => {});
    // Default due date: 7 days from now
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setDueDate(d.toISOString().split("T")[0]);
  }, [campaignId]);

  function togglePost(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!approverId) {
      setError("Select an approver");
      return;
    }
    if (scope === "individual_posts" && selected.size === 0) {
      setError("Select at least one post to send for approval");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/campaigns/${campaignId}/submit-for-approval`, {
        method: "POST",
        body: {
          assigned_approver_id: approverId,
          approval_scope: scope,
          approval_due_date: dueDate || null,
          message,
          post_ids: scope === "individual_posts" ? [...selected] : [],
        },
      });
      toast.success("Campaign submitted for approval");
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  const scopes = [
    {
      key: "full_campaign" as const,
      title: "Full campaign approval",
      desc: "Approver reviews all assets and strategy docs",
    },
    {
      key: "individual_posts" as const,
      title: "Individual post approval",
      desc: "Approver reviews each specific post",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <span className="material-symbols-outlined">send_and_archive</span>
            </div>
            <h2 className="text-lg font-semibold">Send Campaign for Approval</h2>
          </div>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent"
            onClick={onClose}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 p-6">
            {error && (
              <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Approver</Label>
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  {approvers.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name} ({a.org_role === "org_admin" ? "Admin" : "Reviewer"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Approval Scope</Label>
              <div className="grid grid-cols-1 gap-2">
                {scopes.map((s) => (
                  <label
                    key={s.key}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-4 transition-all",
                      scope === s.key ? "border-primary ring-1 ring-primary" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="scope"
                      value={s.key}
                      checked={scope === s.key}
                      onChange={() => setScope(s.key)}
                      className="size-5 accent-primary"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{s.title}</span>
                      <span className="text-xs text-muted-foreground">{s.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {scope === "individual_posts" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Posts to review ({selected.size}/{posts.length})
                  </Label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={() =>
                      setSelected(selected.size === posts.length ? new Set() : new Set(posts.map((p) => p.id)))
                    }
                  >
                    {selected.size === posts.length ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                  {posts.length === 0 && (
                    <p className="px-1 py-2 text-xs text-muted-foreground">This campaign has no posts yet.</p>
                  )}
                  {posts.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md p-2 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => togglePost(p.id)}
                        className="size-4 accent-primary"
                      />
                      <PlatformIcon platform={p.platform} size={16} />
                      <span className="min-w-0 flex-1 truncate text-sm">{p.headline || platformLabel(p.platform)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <TextareaZoom
                label="Message"
                rows={3}
                value={message}
                onChange={setMessage}
                placeholder="Add a note for the approver…"
              />
            </div>

            <div className="flex items-end gap-8">
              <div className="flex-1 space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="flex items-center gap-3 pb-2.5">
                <span className="text-xs text-muted-foreground">Notify Approver</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notify}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    notify ? "bg-primary" : "bg-muted",
                  )}
                  onClick={() => setNotify((v) => !v)}
                >
                  <span
                    className={cn(
                      "inline-block size-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out",
                      notify ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border bg-accent/40 px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send Approval Request"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
