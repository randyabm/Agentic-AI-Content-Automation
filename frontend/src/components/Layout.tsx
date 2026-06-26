import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-gradient-to-br from-primary to-indigo-400 text-white shadow-md"
      : "text-[#c7c5dd] hover:bg-white/10 hover:text-white",
  );

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [showArticleLibrary, setShowArticleLibrary] = useState(true);

  useEffect(() => {
    api<{ key: string; value: string }[]>("/settings")
      .then((settings) => {
        const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
        if (byKey["show_article_library"] === "false") setShowArticleLibrary(false);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[244px] flex-col gap-0 border-r border-white/[0.06] bg-gradient-to-b from-indigo-950 to-[#161331] p-5 text-[#e5e7eb]">
        <div className="mb-8 flex items-center gap-2 font-serif text-[1.2rem] font-bold tracking-tight">
          <span className="w-10 h-10 rounded-xl bg-[#6d28d9] flex items-center justify-center text-white font-bold text-sm mr-2">SF</span>
          <div>
            <span className="font-bold text-[#5300b7]" style={{ fontSize: "1.1rem" }}>SocialFlow</span>
            <p className="text-[10px] text-[#4a4455] opacity-70 -mt-0.5">Enterprise Plan</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {!user?.is_platform_admin && <NavLink to="/clients" className={navClass}>Clients</NavLink>}
          {!user?.is_platform_admin && <NavLink to="/campaigns" className={navClass}>Campaigns</NavLink>}
          {!user?.is_platform_admin && showArticleLibrary && <NavLink to="/articles" className={navClass}>Article Library</NavLink>}
          {!user?.is_platform_admin && <NavLink to="/calendar" className={navClass}>Calendar</NavLink>}
          {!user?.is_platform_admin && (
            <NavLink to="/analytics" className={navClass} style={{ opacity: 0.5, pointerEvents: "none" }} aria-disabled>
              Analytics
            </NavLink>
          )}
          {(user?.org_role === "reviewer" || user?.org_role === "org_admin") && (
            <NavLink to="/review-queue" className={navClass}>Review Queue</NavLink>
          )}
          {user?.org_role === "org_admin" && <NavLink to="/team" className={navClass}>Team</NavLink>}
          {user?.is_platform_admin && <NavLink to="/organizations" className={navClass}>Organizations</NavLink>}
          {user?.is_platform_admin && <NavLink to="/users" className={navClass}>Users</NavLink>}
          {user?.is_platform_admin && <NavLink to="/settings" className={navClass}>System Settings</NavLink>}
        </nav>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 text-[0.85rem]">
            <strong>{user?.full_name || user?.email}</strong>
            <span className="w-fit rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider">
              {user?.is_platform_admin ? "Super Admin" : (user?.org_role ?? user?.role)}
            </span>
          </div>
          <Button variant="ghost" onClick={logout} className="justify-start bg-surface border border-border-strong hover:bg-surface-alt hover:border-text-muted">
            <LogOut size={14} /> Sign out
          </Button>
        </div>
      </aside>
      <main className="max-w-[1140px] flex-1 px-9 py-8">{children}</main>
    </div>
  );
}
