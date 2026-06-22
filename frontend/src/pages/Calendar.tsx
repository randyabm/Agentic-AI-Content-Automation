import { useEffect, useState, useMemo, useCallback } from "react";
import { CalendarDays, RefreshCw, CalendarRange, List, Kanban } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { toast } from "sonner";
import type { CalendarItem, Client } from "../types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarFilters, ALL_FILTERS, type CalendarFiltersState } from "../components/CalendarFilters";
import { CalendarMonthGrid } from "../components/CalendarMonthGrid";
import { CalendarWeekView } from "../components/CalendarWeekView";
import { CalendarListView } from "../components/CalendarListView";
import { PipelineBoard } from "../components/PipelineBoard";
import { PostDrawer } from "../components/PostDrawer";

type View = "month" | "week" | "list" | "board";

export default function Calendar() {
  const { user } = useAuth();
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("month");
  const [filters, setFilters] = useState<CalendarFiltersState>(ALL_FILTERS);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const canEdit = !user?.is_platform_admin;
  const canReview = user?.org_role === "reviewer" || user?.org_role === "org_admin" || !!user?.is_platform_admin;

  const load = useCallback(async () => {
    try {
      const [calendarData, clientData] = await Promise.all([
        api<CalendarItem[]>("/calendar"),
        api<Client[]>("/clients"),
      ]);
      setItems(calendarData);
      setClients(clientData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
      toast.error("Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filters.client !== "all" && item.client_id !== filters.client) return false;
      if (filters.platform !== "all" && item.platform !== filters.platform) return false;
      if (filters.status !== "all" && item.status !== filters.status) return false;
      return true;
    });
  }, [items, filters]);

  const clientOptions = useMemo(
    () => clients.map((c) => ({ id: c.id, name: c.company_name })),
    [clients],
  );

  function handleSelectItem(item: CalendarItem) {
    setSelectedItem(item);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col h-full" style={{ maxWidth: "none", margin: 0, padding: 0 }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
            <CalendarDays size={18} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ margin: 0 }}>
              Publishing Calendar
            </h1>
            <p className="text-sm text-muted-foreground" style={{ margin: 0 }}>
              All scheduled and published posts across your clients
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="month" className="gap-1.5">
                <CalendarDays size={14} /> Month
              </TabsTrigger>
              <TabsTrigger value="week" className="gap-1.5">
                <CalendarRange size={14} /> Week
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5">
                <List size={14} /> List
              </TabsTrigger>
              <TabsTrigger value="board" className="gap-1.5">
                <Kanban size={14} /> Pipeline
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <CalendarFilters filters={filters} onChange={setFilters} clients={clientOptions} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw size={24} className="animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading calendar…</p>
          </div>
        ) : filteredItems.length === 0 && items.length === 0 ? (
          <EmptyState
            title="Nothing scheduled yet"
            description="Approve a post in a campaign and use Schedule to plan it here."
          />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title="No posts match your filters"
            description="Try adjusting or clearing the filters above."
          />
        ) : (
          <>
            {view === "month" && <CalendarMonthGrid items={filteredItems} onSelectItem={handleSelectItem} />}
            {view === "week" && <CalendarWeekView items={filteredItems} onSelectItem={handleSelectItem} />}
            {view === "list" && <CalendarListView items={filteredItems} onSelectItem={handleSelectItem} />}
            {view === "board" && (
              <PipelineBoard
                items={filteredItems}
                onSelectItem={handleSelectItem}
                canEdit={canEdit}
                canReview={canReview}
                onRefresh={load}
              />
            )}
          </>
        )}
      </div>

      {/* Post detail drawer */}
      <PostDrawer
        item={selectedItem}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        canEdit={canEdit}
        canReview={canReview}
        onRefresh={load}
      />
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-2">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
        <CalendarDays size={28} className="text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-md">{description}</p>
    </div>
  );
}
