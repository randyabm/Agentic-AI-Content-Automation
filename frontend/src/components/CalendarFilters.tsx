import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { PublishStatus } from "../types";

export interface CalendarFiltersState {
  client: string | "all";
  platform: string | "all";
  status: string | "all";
}

export const ALL_FILTERS: CalendarFiltersState = { client: "all", platform: "all", status: "all" };

interface CalendarFiltersProps {
  filters: CalendarFiltersState;
  onChange: (f: CalendarFiltersState) => void;
  clients: { id: string; name: string }[];
}

const PLATFORMS = ["facebook", "instagram", "linkedin", "x", "tiktok", "youtube"];
const STATUSES: PublishStatus[] = ["draft", "scheduled", "publishing", "published", "partial", "failed"];

export function CalendarFilters({ filters, onChange, clients }: CalendarFiltersProps) {
  const hasActive = filters.client !== "all" || filters.platform !== "all" || filters.status !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Select
        value={filters.client}
        onValueChange={(v) => onChange({ ...filters, client: v })}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All clients" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All clients</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.platform}
        onValueChange={(v) => onChange({ ...filters, platform: v })}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All platforms" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All platforms</SelectItem>
          {PLATFORMS.map((p) => (
            <SelectItem key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(v) => onChange({ ...filters, status: v })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(ALL_FILTERS)}
        >
          <X size={14} /> Clear
        </Button>
      )}
    </div>
  );
}
