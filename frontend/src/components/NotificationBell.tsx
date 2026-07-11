import { useCallback, useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Notification } from "../types";

const POLL_MS = 30000;

/** Bell + unread badge in the sidebar. Polls the unread count every 30s (FR-07)
 *  and loads the full list when opened. */
export function NotificationBell({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);

  const loadCount = useCallback(async () => {
    try {
      const { count } = await api<{ count: number }>("/notifications/unread-count");
      setUnread(count);
    } catch {
      /* silent — a transient failure shouldn't spam the user */
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      setItems(await api<Notification[]>("/notifications?limit=50"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCount();
    const id = setInterval(() => {
      if (!document.hidden) loadCount();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadCount]);

  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  async function markAllRead() {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    } catch {
      /* ignore */
    }
  }

  async function openItem(n: Notification) {
    setOpen(false);
    if (!n.read_at) {
      try {
        await api(`/notifications/${n.id}/read`, { method: "POST" });
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        /* ignore */
      }
    }
    if (n.link) navigate(n.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Notifications"
          className={cn(
            "relative flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-[0.85rem] text-[#c7c5dd] transition-colors hover:bg-white/10 hover:text-white",
            collapsed ? "md:justify-center md:px-0" : "justify-start",
          )}
        >
          <span className="relative">
            <Bell size={16} />
            {unread > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.6rem] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          {!collapsed && "Notifications"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Check size={12} /> Mark all read
            </button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">You're all caught up.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => openItem(n)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                      !n.read_at && "bg-primary/5",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {!n.read_at && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                      <span className="line-clamp-1 text-sm font-medium">{n.title}</span>
                    </span>
                    {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                    <span className="text-[0.65rem] text-muted-foreground">{formatWhen(n.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}
