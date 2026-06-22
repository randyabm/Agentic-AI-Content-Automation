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
import { toast } from "sonner";
import type { User } from "../types";

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

  useEffect(() => {
    api<User[]>("/team")
      .then((members) => setApprovers(members.filter((m) => m.org_role === "reviewer" || m.org_role === "org_admin")))
      .catch(() => {});
    // Default due date: 7 days from now
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setDueDate(d.toISOString().split("T")[0]);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!approverId) {
      setError("Select an approver");
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
            {error && <div className="alert alert-error">{error}</div>}

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
