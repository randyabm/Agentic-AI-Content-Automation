import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { api } from "../api";
import { PlatformIcon } from "./PlatformIcon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "../types";

const COLUMNS = [
  { id: "draft", label: "Draft", accent: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
  { id: "pending_review", label: "Needs Approval", accent: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300", dot: "bg-blue-500" },
  { id: "approved", label: "Approved", accent: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300", dot: "bg-violet-500" },
  { id: "scheduled", label: "Scheduled", accent: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", dot: "bg-amber-500" },
  { id: "published", label: "Published", accent: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", dot: "bg-emerald-500" },
] as const;

interface PipelineBoardProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
  canEdit: boolean;
  canReview: boolean;
  onRefresh: () => void;
}

function columnFor(item: CalendarItem): string {
  if (item.status === "published") return "published";
  if (item.status === "scheduled" || item.status === "retrying" || item.status === "throttled")
    return "scheduled";
  if (item.approval_status === "approved" || item.approval_status === "not_required") return "approved";
  // "Needs Approval" only once actually submitted (content ready_for_review);
  // an unsubmitted or sent-back post lives in Draft.
  if (item.approval_status === "pending" && item.content_status === "ready_for_review")
    return "pending_review";
  return "draft";
}

export function PipelineBoard({ items, onSelectItem, canEdit, canReview, onRefresh }: PipelineBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.id] = items.filter((i) => columnFor(i) === col.id);
    return acc;
  }, {} as Record<string, CalendarItem[]>);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const item = items.find((i) => i.id === active.id);
    if (!item) return;
    const targetCol = over.id as string;
    const currentCol = columnFor(item);
    if (targetCol === currentCol) return;

    try {
      if (targetCol === "pending_review" && currentCol === "draft" && canEdit) {
        await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/submit`, { method: "POST" });
        toast.success("Submitted for review");
      } else if (targetCol === "approved" && currentCol === "pending_review" && canReview) {
        await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/approve`, { method: "POST" });
        toast.success("Post approved");
      } else if (targetCol === "draft" && currentCol === "pending_review" && canReview) {
        await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/reject`, {
          method: "POST",
          body: { note: "" },
        });
        toast.success("Post rejected");
      } else {
        toast.info("Use the post drawer to schedule or publish");
        onRefresh();
        return;
      }
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      onRefresh();
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <ScrollArea className="w-full whitespace-nowrap rounded-md">
        <div className="flex gap-4 min-w-[1100px] pb-4">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              id={col.id}
              label={col.label}
              accent={col.accent}
              dot={col.dot}
              items={grouped[col.id]}
              onSelectItem={onSelectItem}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </DndContext>
  );
}

function Column({
  id,
  label,
  accent,
  dot,
  items,
  onSelectItem,
}: {
  id: string;
  label: string;
  accent: string;
  dot: string;
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex-1 min-w-[220px]">
      <div className={cn("rounded-lg px-3 py-2.5 mb-3 flex items-center justify-between", accent)}>
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", dot)} />
          <h4 className="text-sm font-semibold">{label}</h4>
        </div>
        <span className="text-xs font-medium bg-white/60 rounded-full px-2 py-0.5">
          {items.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "space-y-2 min-h-[300px] p-1.5 rounded-xl border-2 border-dashed transition-colors",
          isOver ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/10",
        )}
      >
        {items.map((item) => (
          <DraggableCard key={item.id} item={item} onSelect={() => onSelectItem(item)} />
        ))}
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground/60 text-center py-10 select-none">
            Drop posts here
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ item, onSelect }: { item: CalendarItem; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => { if (!isDragging) onSelect(); }}
      className={cn(
        "bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing",
        "hover:shadow-md hover:border-primary/20 transition-all duration-200",
        isDragging && "opacity-60 shadow-lg scale-105 z-50 ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <PlatformIcon platform={item.platform} size={14} />
        <span className="text-xs font-medium truncate flex-1 text-foreground">
          {item.client_name || "—"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
        {item.headline || item.preview || "(no copy)"}
      </p>
      {item.scheduled_at && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-1 h-1 rounded-full bg-amber-500" />
          {new Date(item.scheduled_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" · "}
          {new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      {item.published_url && (
        <Badge variant="default" className="mt-2 text-xs bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10">
          Published
        </Badge>
      )}
    </div>
  );
}
