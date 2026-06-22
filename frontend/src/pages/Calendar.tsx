import { useEffect, useState, useMemo, useCallback } from "react";
import { CalendarDays, RefreshCw, LayoutGrid, List, CalendarRange, Kanban } from "lucide-react";
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

  const viewIcons: Record<View, React.ReactNode> = {
    month: <CalendarDays size={15} />,
    week: <CalendarRange size={15} />,
    list: <List size={15} />,
    board: <Kanban size={15} />,
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
            <CalendarDays size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />
            Publishing Calendar
          </h1>
          <p className="muted" style={{ margin: "4px 0 0 0" }}>
            All scheduled and published posts across your clients. Click any post for details.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* View switcher */}
      <div className="flex items-center justify-between mb-4">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="month">
              <CalendarDays size={15} className="mr-1.5" /> Month
            </TabsTrigger>
            <TabsTrigger value="week">
              <CalendarRange size={15} className="mr-1.5" /> Week
            </TabsTrigger>
            <TabsTrigger value="list">
              <List size={15} className="mr-1.5" /> List
            </TabsTrigger>
            <TabsTrigger value="board">
              <Kanban size={15} className="mr-1.5" /> Pipeline
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Filters */}
      <CalendarFilters filters={filters} onChange={setFilters} clients={clientOptions} />

      {/* Content */}
      {loading ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">Loading calendar…</p>
        </div>
      ) : filteredItems.length === 0 && items.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">
            Nothing scheduled yet. Approve a post in a campaign and use <em>Schedule…</em> to plan it here.
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">No posts match your filters.</p>
        </div>
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
