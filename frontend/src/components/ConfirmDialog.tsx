import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Reusable confirmation modal: centered card over a blurred backdrop. Optionally
 * requires the user to type a phrase (e.g. "delete") before the confirm button
 * enables, for destructive actions. Replaces native window.confirm().
 */
export function ConfirmDialog({
  title,
  children,
  confirmWord,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  /** If set, the user must type this exact word (case-insensitive) to enable confirm. */
  confirmWord?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = !confirmWord || typed.trim().toLowerCase() === confirmWord.toLowerCase();
  const canConfirm = matches && !busy;

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-[460px] rounded-xl bg-surface p-6 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="m-0 text-xl font-semibold">{title}</h2>
        </div>

        <div className="mt-2 mb-1 text-foreground">{children}</div>

        {confirmWord && (
          <label className="mt-4 mb-1 flex flex-col gap-1 text-sm">
            Type <strong className="font-bold text-red-600">{confirmWord}</strong> to confirm
            <Input
              ref={inputRef}
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setInvalid(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (canConfirm) onConfirm();
                  else if (typed.trim()) setInvalid(true);
                }
              }}
              placeholder={confirmWord}
              autoComplete="off"
              className={cn(invalid && "border-red-600 ring-[3px] ring-red-600/20")}
            />
            {invalid && (
              <span className="mt-0.5 text-xs text-red-600">
                That's not correct — type <strong>{confirmWord}</strong> to confirm.
              </span>
            )}
          </label>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            variant={danger ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Deleting…" : confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
