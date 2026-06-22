import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="modal-overlay" onClick={onClose} style={{ background: "rgba(20, 27, 43, 0.4)", backdropFilter: "blur(2px)" }}>
      <div
        className="w-full max-w-[560px] rounded-xl shadow-xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.8)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-xl py-lg border-b border-[#ccc3d7] flex items-center justify-between">
          <div className="flex items-center gap-md">
            <div className="w-10 h-10 bg-[#ebddff] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#5300b7]">send_and_archive</span>
            </div>
            <h2 className="font-headline-md text-headline-md" style={{ fontSize: "1.2rem", fontWeight: 600 }}>Send Campaign for Approval</h2>
          </div>
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#e1e8fd] transition-colors" onClick={onClose}>
            <span className="material-symbols-outlined text-[#4a4455]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-xl space-y-lg">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="space-y-sm">
              <label className="font-label-md text-label-md text-[#4a4455] block uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Approver</label>
              <div className="relative">
                <select
                  className="w-full h-12 pl-md pr-xl bg-white border border-[#ccc3d7] rounded-lg text-body-md focus:ring-2 focus:ring-[#6d28d9] focus:outline-none appearance-none cursor-pointer"
                  value={approverId}
                  onChange={(e) => setApproverId(e.target.value)}
                >
                  <option value="">Select Team Member</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name} ({a.org_role === "org_admin" ? "Admin" : "Reviewer"})
                    </option>
                  ))}
                </select>
                <div className="absolute right-md top-1/2 -translate-y-1/2 pointer-events-none">
                  <span className="material-symbols-outlined text-[#7b7486]">expand_more</span>
                </div>
              </div>
            </div>

            <div className="space-y-sm">
              <label className="font-label-md text-label-md text-[#4a4455] block uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Approval Scope</label>
              <div className="grid grid-cols-1 gap-sm">
                <label className={`flex items-center gap-md p-md bg-white border rounded-lg cursor-pointer transition-all ${scope === "full_campaign" ? "border-[#6d28d9]" : "border-[#ccc3d7]"}`}>
                  <input
                    type="radio"
                    name="scope"
                    value="full_campaign"
                    checked={scope === "full_campaign"}
                    onChange={() => setScope("full_campaign")}
                    className="w-5 h-5 text-[#6d28d9] border-[#ccc3d7] focus:ring-[#6d28d9]"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-body-md" style={{ fontSize: "0.9rem" }}>Full campaign approval</span>
                    <span className="text-label-sm text-[#4a4455]" style={{ fontSize: "0.75rem" }}>Approver reviews all assets and strategy docs</span>
                  </div>
                </label>
                <label className={`flex items-center gap-md p-md bg-white border rounded-lg cursor-pointer transition-all ${scope === "individual_posts" ? "border-[#6d28d9]" : "border-[#ccc3d7]"}`}>
                  <input
                    type="radio"
                    name="scope"
                    value="individual_posts"
                    checked={scope === "individual_posts"}
                    onChange={() => setScope("individual_posts")}
                    className="w-5 h-5 text-[#6d28d9] border-[#ccc3d7] focus:ring-[#6d28d9]"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-body-md" style={{ fontSize: "0.9rem" }}>Individual post approval</span>
                    <span className="text-label-sm text-[#4a4455]" style={{ fontSize: "0.75rem" }}>Approver reviews each specific post</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-sm">
              <label className="font-label-md text-label-md text-[#4a4455] block uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Message</label>
              <textarea
                className="w-full p-md bg-white border border-[#ccc3d7] rounded-lg text-body-md focus:ring-2 focus:ring-[#6d28d9] focus:outline-none"
                placeholder="Add a note for the approver..."
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-xl">
              <div className="flex-1 space-y-sm">
                <label className="font-label-md text-label-md text-[#4a4455] block uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Due Date</label>
                <input
                  type="date"
                  className="w-full h-12 pl-md pr-md bg-white border border-[#ccc3d7] rounded-lg text-body-md focus:ring-2 focus:ring-[#6d28d9] focus:outline-none"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-md pt-6">
                <span className="text-label-md text-[#4a4455]" style={{ fontSize: "0.75rem" }}>Notify Approver</span>
                <button
                  type="button"
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#6d28d9] focus:ring-offset-2 ${notify ? "bg-[#6d28d9]" : "bg-[#dce2f7]"}`}
                  onClick={() => setNotify((v) => !v)}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out ${notify ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="px-xl py-lg bg-[#f1f3ff] border-t border-[#ccc3d7] flex items-center justify-end gap-md">
            <button
              type="button"
              className="px-6 py-2.5 rounded-lg font-semibold text-[#4a4455] hover:bg-[#e1e8fd] transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
            <Button type="submit" disabled={busy} style={{ padding: "0.625rem 2rem" }}>
              {busy ? "Sending..." : "Send Approval Request"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
