import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BarChart3, Building2, CalendarDays, ListChecks, LogOut, Megaphone,
  Newspaper, PanelLeftClose, PanelLeftOpen, Settings, UserCog, Users, Users2,
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
  const [showArticleLibrary, setShowArticleLibrary] = useState(true);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

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

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      collapsed && "justify-center px-0",
      isActive
        ? "bg-gradient-to-br from-primary to-indigo-500 text-white shadow-md"
        : "text-[#c7c5dd] hover:bg-white/10 hover:text-white",
    );

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sticky top-0 flex h-screen flex-col gap-0 border-r border-white/[0.06]",
          "bg-gradient-to-b from-indigo-950 to-[#161331] text-[#e5e7eb]",
          "transition-[width] duration-200",
          collapsed ? "w-[68px] p-3" : "w-[244px] p-5",
        )}
      >
        <div className={cn("mb-6 flex items-center gap-2 font-serif font-bold tracking-tight", collapsed && "justify-center")}>
          <span className="h-10 w-10 flex-shrink-0 rounded-xl bg-[#6d28d9] flex items-center justify-center text-white font-bold text-sm">SF</span>
          {!collapsed && (
            <div>
              <span className="font-bold text-white" style={{ fontSize: "1.1rem" }}>SocialFlow</span>
              <p className="text-[10px] text-indigo-200/60 -mt-0.5">Enterprise Plan</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mb-4 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[#c7c5dd]",
            "hover:bg-white/10 hover:text-white transition-colors",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>

        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ to, label, icon: Icon, disabled }) =>
            disabled ? (
              <span key={to} title={`${label} — coming soon`}
                className={cn(navClass({ isActive: false }), "cursor-not-allowed opacity-40")}>
                <Icon size={16} className="flex-shrink-0" /> {!collapsed && label}
              </span>
            ) : (
              <NavLink key={to} to={to} className={navClass} title={collapsed ? label : undefined}>
                <Icon size={16} className="flex-shrink-0" /> {!collapsed && label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex flex-col gap-2">
          <ThemeToggle collapsed={collapsed} />
          {!collapsed && (
            <div className="flex flex-col gap-1 text-[0.85rem]">
              <strong className="truncate">{user?.full_name || user?.email}</strong>
              <span className="w-fit rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider">
                {user?.is_platform_admin ? "Super Admin" : (user?.org_role ?? user?.role)}
              </span>
            </div>
          )}
          <Button variant="ghost" onClick={logout} title={collapsed ? "Sign out" : undefined}
            className={cn(
              "border border-white/15 text-[#c7c5dd] hover:bg-white/10 hover:text-white",
              collapsed ? "justify-center px-0" : "justify-start",
            )}>
            <LogOut size={14} /> {!collapsed && "Sign out"}
          </Button>
        </div>
      </aside>
      <main className="max-w-[1140px] flex-1 px-9 py-8">{children}</main>
    </div>
  );
}
