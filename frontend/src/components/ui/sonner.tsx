import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** App-wide toast host. Mount once near the root, then call `toast()` from anywhere. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
