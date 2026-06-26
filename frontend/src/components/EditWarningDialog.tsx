interface EditWarningDialogProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function EditWarningDialog({ visible, onCancel, onConfirm }: EditWarningDialogProps) {
  if (!visible) return null;
  return (
    <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-3 text-red-800">
        <span className="material-symbols-outlined text-red-500">warning</span>
        <p className="text-sm font-semibold">Editing will void approval and require a re-review.</p>
      </div>
      <div className="flex gap-2">
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-800 transition-colors hover:bg-red-100"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-600"
          onClick={onConfirm}
        >
          Confirm Edit
        </button>
      </div>
    </div>
  );
}
