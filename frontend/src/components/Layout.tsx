import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

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
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="w-10 h-10 rounded-xl bg-[#6d28d9] flex items-center justify-center text-white font-bold text-sm mr-2">SF</span>
          <div>
            <span className="font-bold text-[#5300b7]" style={{ fontSize: "1.1rem" }}>SocialFlow</span>
            <p className="text-[10px] text-[#4a4455] opacity-70 -mt-0.5">Enterprise Plan</p>
          </div>
        </div>
        <nav>
          {/* Brand/org work — hidden from the platform super-admin. */}
          {!user?.is_platform_admin && <NavLink to="/clients">Clients</NavLink>}
          {!user?.is_platform_admin && <NavLink to="/campaigns">Campaigns</NavLink>}
          {!user?.is_platform_admin && showArticleLibrary && <NavLink to="/articles">Article Library</NavLink>}
          {!user?.is_platform_admin && <NavLink to="/calendar">Calendar</NavLink>}
          {!user?.is_platform_admin && <NavLink to="/analytics" style={{ opacity: 0.5, pointerEvents: "none" }}>Analytics</NavLink>}
          {(user?.org_role === "reviewer" || user?.org_role === "org_admin") && (
            <NavLink to="/review-queue">Review Queue</NavLink>
          )}
          {user?.org_role === "org_admin" && <NavLink to="/team">Team</NavLink>}
          {/* Platform/system administration — super-admin only. */}
          {user?.is_platform_admin && <NavLink to="/organizations">Organizations</NavLink>}
          {user?.is_platform_admin && <NavLink to="/users">Users</NavLink>}
          {user?.is_platform_admin && <NavLink to="/settings">System Settings</NavLink>}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <strong>{user?.full_name || user?.email}</strong>
            <span className="role-badge">
              {user?.is_platform_admin ? "Super Admin" : (user?.org_role ?? user?.role)}
            </span>
          </div>
          <button className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
