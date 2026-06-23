import { useDraggable } from "@dnd-kit/core";
import { Clock, GripVertical, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { cn } from "@/lib/utils";
import type { ScheduleablePost } from "../types";

interface ScheduleablePostsSidebarProps {
  posts: ScheduleablePost[];
  filters: { client: string; platform: string };
}

export function ScheduleablePostsSidebar({ posts, filters }: ScheduleablePostsSidebarProps) {
  const filtered = posts.filter((p) => {
    if (filters.client !== "all" && p.client_id !== filters.client) return false;
    if (filters.platform !== "all" && p.platform !== filters.platform) return false;
    return true;
  });
  const ready = filtered.filter((p) => !p.blocked_reason);
  const blocked = filtered.filter((p) => p.blocked_reason);

  return (
    <div className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          Ready to schedule
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {ready.length} ready to drag
          {blocked.length > 0 ? ` · ${blocked.length} need a channel` : ""}
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground">
                {posts.length === 0
                  ? "No approved posts waiting. Approve posts in campaigns first."
                  : "No posts match your filters."}
              </p>
            </div>
          ) : (
            <>
              {ready.map((post) => (
                <DraggablePostCard key={post.post_id} post={post} />
              ))}
              {blocked.map((post) => (
                <BlockedPostCard key={post.post_id} post={post} />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function BlockedPostCard({ post }: { post: ScheduleablePost }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-muted/30 p-2.5 cursor-not-allowed opacity-80",
      )}
      title={post.blocked_reason}
    >
      <div className="flex items-start gap-2">
        <Lock size={14} className="text-muted-foreground/60 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <PlatformIcon platform={post.platform} size={12} />
            <span className="text-xs font-medium truncate">{post.client_name}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">
            {post.headline || post.preview || "(no copy)"}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-amber-300 text-amber-700">
              {post.blocked_reason || "Can't schedule yet"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function DraggablePostCard({ post }: { post: ScheduleablePost }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sched-${post.post_id}`,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "group rounded-lg border border-border bg-card p-2.5 cursor-grab active:cursor-grabbing",
        "hover:border-primary/30 hover:shadow-sm transition-all duration-200",
        isDragging && "opacity-60 shadow-lg ring-2 ring-primary/40 scale-105 z-50",
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-muted-foreground transition-colors" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <PlatformIcon platform={post.platform} size={12} />
            <span className="text-xs font-medium truncate">{post.client_name}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">
            {post.headline || post.preview || "(no copy)"}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 capitalize">
              {post.platform}
            </Badge>
            {post.best_time && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock size={9} /> {post.best_time}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
