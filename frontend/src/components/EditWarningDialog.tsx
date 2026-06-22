interface EditWarningDialogProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function EditWarningDialog({ visible, onCancel, onConfirm }: EditWarningDialogProps) {
  if (!visible) return null;
  return (
    <div className="mb-lg p-md bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 text-red-800">
        <span className="material-symbols-outlined text-red-500">warning</span>
        <p className="font-semibold" style={{ fontSize: "0.85rem" }}>Editing will void approval and require a re-review.</p>
      </div>
      <div className="flex gap-2">
        <button
          className="px-3 py-1.5 text-label-md font-bold text-red-800 hover:bg-red-100 rounded-lg transition-colors"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1.5 bg-red-500 text-white text-label-md font-bold rounded-lg shadow-sm hover:bg-red-600 transition-colors"
          onClick={onConfirm}
        >
          Confirm Edit
        </button>
      </div>
    </div>
  );
}
