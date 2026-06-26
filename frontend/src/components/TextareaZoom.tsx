import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TextareaZoom({
  label,
  value,
  onChange,
  placeholder,
  rows,
  readOnly,
  footerSlot,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
  /** Optional content rendered in the expand-modal footer, left of "Done". */
  footerSlot?: ReactNode;
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

  const onChangeHandler = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!readOnly) onChange(e.target.value);
  };

  return (
    <>
      <div
        className="group relative block"
        onDoubleClick={() => setOpen(true)}
      >
        <textarea
          rows={rows ?? 2}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={onChangeHandler}
          className="w-full cursor-text resize-none border border-border bg-surface-alt px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 group-hover:border-primary"
        />
        <span
          title="Expand"
          role="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
          className="absolute bottom-2 right-2 cursor-pointer text-sm leading-none text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          ⤢
        </span>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="flex w-[min(620px,94vw)] flex-col gap-4 rounded-2xl bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[0.95rem] font-semibold">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-md border-none bg-transparent px-1.5 py-0.5 text-base hover:bg-bg"
              >
                ✕
              </button>
            </div>
            <textarea
              ref={inputRef}
              value={value}
              onChange={onChangeHandler}
              placeholder={placeholder}
              readOnly={readOnly}
              className={cn(
                "min-h-[240px] w-full resize-y rounded-[10px] border-[1.5px] border-border bg-input px-4 py-3.5 font-sans text-[0.95rem] leading-relaxed",
                "focus:border-primary focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-primary/15",
              )}
            />
            <div className="flex items-center justify-between gap-2">
              <div>{footerSlot}</div>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
