import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Promise-based confirm()/prompt() built on shadcn Dialog, so native
 * window.confirm/window.prompt can be replaced app-wide with a consistent,
 * on-brand modal. Mount <DialogsProvider> once near the root, then call the
 * useConfirm()/usePrompt() hooks from anywhere.
 */

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PromptOptions = ConfirmOptions & {
  placeholder?: string;
  defaultValue?: string;
  /** When true an empty value is allowed (default true). */
  allowEmpty?: boolean;
};

type Request =
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (v: string | null) => void } & PromptOptions);

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(
  async () => false,
);
const PromptCtx = createContext<(o: PromptOptions) => Promise<string | null>>(
  async () => null,
);

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const resolved = useRef(false);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolved.current = false;
      setReq({ kind: "confirm", resolve, ...o });
    });
  }, []);

  const prompt = useCallback((o: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolved.current = false;
      setValue(o.defaultValue ?? "");
      setReq({ kind: "prompt", resolve, ...o });
    });
  }, []);

  function settle(result: boolean | string | null) {
    if (!req || resolved.current) return;
    resolved.current = true;
    if (req.kind === "confirm") req.resolve(result as boolean);
    else req.resolve(result as string | null);
    setReq(null);
    setValue("");
  }

  const open = !!req;
  const isPrompt = req?.kind === "prompt";
  const allowEmpty = req?.kind === "prompt" ? req.allowEmpty !== false : true;
  const canConfirm = !isPrompt || allowEmpty || value.trim().length > 0;

  return (
    <ConfirmCtx.Provider value={confirm}>
      <PromptCtx.Provider value={prompt}>
        {children}
        <Dialog open={open} onOpenChange={(o) => !o && settle(isPrompt ? null : false)}>
          <DialogContent className="sm:max-w-md">
            {req && (
              <>
                <DialogHeader>
                  <DialogTitle>{req.title}</DialogTitle>
                  {req.description && (
                    <DialogDescription>{req.description}</DialogDescription>
                  )}
                </DialogHeader>

                {isPrompt && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="dialog-prompt-input" className="sr-only">
                      {req.title}
                    </Label>
                    <Input
                      id="dialog-prompt-input"
                      autoFocus
                      value={value}
                      placeholder={(req as PromptOptions).placeholder}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canConfirm) settle(value);
                      }}
                    />
                  </div>
                )}

                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => settle(isPrompt ? null : false)}
                  >
                    {req.cancelLabel ?? "Cancel"}
                  </Button>
                  <Button
                    variant={req.destructive ? "destructive" : "default"}
                    disabled={!canConfirm}
                    onClick={() => settle(isPrompt ? value : true)}
                  >
                    {req.confirmLabel ?? (isPrompt ? "OK" : "Confirm")}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

export function usePrompt() {
  return useContext(PromptCtx);
}
