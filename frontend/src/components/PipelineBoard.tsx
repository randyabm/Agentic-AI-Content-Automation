import { useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CalendarItem } from "../types";

const COLUMNS = [
  { id: "draft", label: "Draft", color: "bg-gray-100" },
  { id: "pending_review", label: "Needs Approval", color: "bg-blue-50" },
  { id: "approved", label: "Approved", color: "bg-purple-50" },
  { id: "scheduled", label: "Scheduled", color: "bg-amber-50" },
  { id: "published", label: "Published", color: "bg-green-50" },
] as const;

interface PipelineBoardProps {
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
  canEdit: boolean;
  canReview: boolean;
  onRefresh: () => void;
}

export function PipelineBoard({ items, onSelectItem, canEdit, canReview, onRefresh }: PipelineBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Group items by their "board column" — derived from approval_status + publish status.
  function columnFor(item: CalendarItem): string {
    if (item.status === "published" || item.status === "partial") return "published";
    if (item.status === "scheduled") return "scheduled";
    if (item.approval_status === "approved") return "approved";
    if (item.approval_status === "pending_review") return "pending_review";
    return "draft";
  }

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

    // Map column → API action
    try {
      if (targetCol === "pending_review" && currentCol === "draft" && canEdit) {
        await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/submit`, { method: "POST" });
        toast.success("Submitted for review");
      } else if (targetCol === "approved" && currentCol === "pending_review" && canReview) {
        await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/approve`, { method: "POST" });
        toast.success("Post approved");
      } else if (targetCol === "scheduled" && currentCol === "approved" && canEdit) {
        toast.info("Use the post drawer to set a schedule time");
        onRefresh();
        return;
      } else if (targetCol === "draft" && currentCol === "pending_review" && canReview) {
        await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/reject`, {
          method: "POST",
          body: { note: "" },
        });
        toast.success("Post rejected");
      } else {
        toast.info("This move is not available via drag");
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
      <ScrollArea className="w-full overflow-x-auto">
        <div className="flex gap-4 min-w-[1000px] pb-4">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              id={col.id}
              label={col.label}
              color={col.color}
              items={grouped[col.id]}
              onSelectItem={onSelectItem}
            />
          ))}
        </div>
      </ScrollArea>
    </DndContext>
  );
}

function Column({
  id,
  label,
  color,
  items,
  onSelectItem,
}: {
  id: string;
  label: string;
  color: string;
  items: CalendarItem[];
  onSelectItem: (item: CalendarItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex-1 min-w-[200px]">
      <div className={`rounded-lg ${color} p-3 mb-2`}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">{label}</h4>
          <span className="text-xs text-muted-foreground bg-background/50 rounded-full px-2 py-0.5">
            {items.length}
          </span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`space-y-2 min-h-[200px] p-1 rounded-lg transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        {items.map((item) => (
          <DraggableCard key={item.id} item={item} onSelect={() => onSelectItem(item)} />
        ))}
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ item, onSelect }: { item: CalendarItem; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if (!isDragging) onSelect();
      }}
      className={`bg-background border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        isDragging ? "opacity-50 shadow-lg z-50" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <PlatformIcon platform={item.platform} size={14} />
        <span className="text-xs font-medium truncate flex-1">
          {item.client_name || "—"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">
        {item.headline || item.preview || "(no copy)"}
      </p>
      {item.scheduled_at && (
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(item.scheduled_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" · "}
          {new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
