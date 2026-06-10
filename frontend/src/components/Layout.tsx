import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AI</span> Marketing Platform
        </div>
        <nav>
          <NavLink to="/clients">Clients</NavLink>
          <NavLink to="/campaigns">Campaigns</NavLink>
          <NavLink to="/articles">Article Library</NavLink>
          {user?.role === "admin" && <NavLink to="/users">Users</NavLink>}
          {user?.role === "admin" && <NavLink to="/settings">System Settings</NavLink>}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <strong>{user?.full_name || user?.email}</strong>
            <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
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
