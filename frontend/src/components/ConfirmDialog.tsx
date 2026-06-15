import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
        </div>

        <div className="confirm-body">{children}</div>

        {confirmWord && (
          <label className="confirm-type">
            Type <strong>{confirmWord}</strong> to confirm
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) onConfirm();
              }}
              placeholder={confirmWord}
              autoComplete="off"
            />
          </label>
        )}

        <div className="form-actions">
          <button
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
