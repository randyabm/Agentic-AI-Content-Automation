import { useCallback, useState } from "react";

export function TextareaZoom({
  label,
  value,
  onChange,
  placeholder,
  rows,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const inputRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) {
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 0);
    }
  }, []);

  return (
    <>
      <div className="textarea-zoom-trigger" onClick={() => setOpen(true)}>
        <textarea
          rows={rows ?? 2}
          value={value}
          placeholder={placeholder}
          readOnly
          tabIndex={-1}
        />
        <span className="textarea-zoom-icon" title="Click to expand">⤢</span>
      </div>
      {open && (
        <div
          className="textarea-zoom-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="textarea-zoom-modal">
            <div className="textarea-zoom-header">
              <span className="textarea-zoom-title">{label}</span>
              <button type="button" className="btn-icon" onClick={() => setOpen(false)}>✕</button>
            </div>
            <textarea
              ref={inputRef}
              className="textarea-zoom-input"
              value={value}
              onChange={(e) => { if (!readOnly) onChange(e.target.value); }}
              placeholder={placeholder}
              readOnly={readOnly}
            />
            <div className="textarea-zoom-footer">
              <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
