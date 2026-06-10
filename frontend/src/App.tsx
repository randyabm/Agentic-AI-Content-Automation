import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import Articles from "./pages/Articles";
import CampaignDetail from "./pages/CampaignDetail";
import Campaigns from "./pages/Campaigns";
import ClientDetail from "./pages/ClientDetail";
import Clients from "./pages/Clients";
import Login from "./pages/Login";
import SystemSettings from "./pages/SystemSettings";
import Users from "./pages/Users";

function Protected({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/clients" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/clients" replace />} />
      <Route path="/clients" element={<Protected><Clients /></Protected>} />
      <Route path="/clients/:clientId" element={<Protected><ClientDetail /></Protected>} />
      <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
      <Route path="/campaigns/:campaignId" element={<Protected><CampaignDetail /></Protected>} />
      <Route path="/articles" element={<Protected><Articles /></Protected>} />
      <Route path="/users" element={<Protected adminOnly><Users /></Protected>} />
      <Route path="/settings" element={<Protected adminOnly><SystemSettings /></Protected>} />
      <Route path="*" element={<Navigate to="/clients" replace />} />
    </Routes>
  );
}
