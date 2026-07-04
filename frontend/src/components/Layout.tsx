import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3, Building2, CalendarDays, ListChecks, LogOut, Megaphone, Menu,
  Newspaper, PanelLeftClose, PanelLeftOpen, Settings, UserCog, Users, Users2, X,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  disabled?: boolean;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [showArticleLibrary, setShowArticleLibrary] = useState(true);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");
  // Mobile drawer (below md); independent of the desktop collapse state.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    api<{ key: string; value: string }[]>("/settings")
      .then((settings) => {
        const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
        if (byKey["show_article_library"] === "false") setShowArticleLibrary(false);
      })
      .catch(() => {});
  }, []);

  const items: NavItem[] = user?.is_platform_admin
    ? [
        { to: "/organizations", label: "Organizations", icon: Building2 },
        { to: "/users", label: "Users", icon: UserCog },
        { to: "/settings", label: "System Settings", icon: Settings },
      ]
    : [
        { to: "/clients", label: "Clients", icon: Users2 },
        { to: "/campaigns", label: "Campaigns", icon: Megaphone },
        ...(showArticleLibrary ? [{ to: "/articles", label: "Article Library", icon: Newspaper }] : []),
        { to: "/calendar", label: "Calendar", icon: CalendarDays },
        { to: "/analytics", label: "Analytics", icon: BarChart3, disabled: true },
        ...(user?.org_role === "reviewer" || user?.org_role === "org_admin"
          ? [{ to: "/review-queue", label: "Review Queue", icon: ListChecks }]
          : []),
        ...(user?.org_role === "org_admin" ? [{ to: "/team", label: "Team", icon: Users }] : []),
      ];

  // On mobile the drawer is always full-width (never the icon rail).
  const isCollapsed = collapsed && !mobileOpen;

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isCollapsed && "md:justify-center md:px-0",
      isActive
        ? "bg-gradient-to-br from-primary to-indigo-500 text-white shadow-md"
        : "text-[#c7c5dd] hover:bg-white/10 hover:text-white",
    );

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar with hamburger (hidden ≥md). */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-md text-foreground hover:bg-muted">
          <Menu size={20} />
        </button>
        <span className="font-serif text-lg font-bold">SocialFlow</span>
      </header>

      {/* Backdrop when the mobile drawer is open. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      <aside
        className={cn(
          "flex h-screen flex-col gap-0 border-r border-white/[0.06]",
          "bg-gradient-to-b from-indigo-950 to-[#161331] text-[#e5e7eb]",
          "transition-[width,transform] duration-200",
          // Desktop: sticky rail, collapsible width.
          "md:sticky md:top-0 md:translate-x-0",
          isCollapsed ? "md:w-[68px] md:p-3" : "md:w-[244px] md:p-5",
          // Mobile: fixed off-canvas drawer that slides in.
          "fixed inset-y-0 left-0 z-50 w-[244px] p-5",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className={cn("mb-6 flex items-center gap-2 font-serif font-bold tracking-tight", isCollapsed && "md:justify-center")}>
          <span className="h-10 w-10 flex-shrink-0 rounded-xl bg-[#6d28d9] flex items-center justify-center text-white font-bold text-sm">SF</span>
          {!isCollapsed && (
            <div>
              <span className="font-bold text-white" style={{ fontSize: "1.1rem" }}>SocialFlow</span>
              <p className="text-[10px] text-indigo-200/60 -mt-0.5">Enterprise Plan</p>
            </div>
          )}
          {/* Close button (mobile only). */}
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu"
            className="ml-auto flex size-8 items-center justify-center rounded-md text-[#c7c5dd] hover:bg-white/10 hover:text-white md:hidden">
            <X size={18} />
          </button>
        </div>

        {/* Collapse toggle — desktop only. */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mb-4 hidden items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[#c7c5dd] md:flex",
            "hover:bg-white/10 hover:text-white transition-colors",
            isCollapsed && "md:justify-center md:px-0",
          )}
        >
          {isCollapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>

        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ to, label, icon: Icon, disabled }) =>
            disabled ? (
              <span key={to} title={`${label} — coming soon`}
                className={cn(navClass({ isActive: false }), "cursor-not-allowed opacity-40")}>
                <Icon size={16} className="flex-shrink-0" /> {!isCollapsed && label}
              </span>
            ) : (
              <NavLink key={to} to={to} className={navClass} title={isCollapsed ? label : undefined}>
                <Icon size={16} className="flex-shrink-0" /> {!isCollapsed && label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex flex-col gap-2">
          <ThemeToggle collapsed={isCollapsed} />
          {!isCollapsed && (
            <div className="flex flex-col gap-1 text-[0.85rem]">
              <strong className="truncate">{user?.full_name || user?.email}</strong>
              <span className="w-fit rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider">
                {user?.is_platform_admin ? "Super Admin" : (user?.org_role ?? user?.role)}
              </span>
            </div>
          )}
          <Button variant="ghost" onClick={logout} title={isCollapsed ? "Sign out" : undefined}
            className={cn(
              "border border-white/15 text-[#c7c5dd] hover:bg-white/10 hover:text-white",
              isCollapsed ? "md:justify-center md:px-0" : "justify-start",
            )}>
            <LogOut size={14} /> {!isCollapsed && "Sign out"}
          </Button>
        </div>
      </aside>

      <main className="max-w-[1140px] flex-1 px-5 pb-8 pt-20 md:px-9 md:pt-8">{children}</main>
    </div>
  );
}
