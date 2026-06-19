import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import Articles from "./pages/Articles";
import CampaignDetail from "./pages/CampaignDetail";
import Campaigns from "./pages/Campaigns";
import ClientDetail from "./pages/ClientDetail";
import Clients from "./pages/Clients";
import Login from "./pages/Login";
import OAuthCallback from "./pages/OAuthCallback";
import Organizations from "./pages/Organizations";
import ReviewQueue from "./pages/ReviewQueue";
import SystemSettings from "./pages/SystemSettings";
import Team from "./pages/Team";
import Users from "./pages/Users";

function Protected({
  children,
  platformOnly = false,
  orgOnly = false,
  orgAdminOnly = false,
}: {
  children: React.ReactNode;
  platformOnly?: boolean;
  orgOnly?: boolean;
  orgAdminOnly?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Platform super-admin handles system config only; org users handle brand work.
  if (platformOnly && !user.is_platform_admin) return <Navigate to="/" replace />;
  if (orgOnly && user.is_platform_admin) return <Navigate to="/organizations" replace />;
  if (orgAdminOnly && user.org_role !== "org_admin") return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

/** Send each user to their natural home: super-admin → Organizations, org users → Clients. */
function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.is_platform_admin ? "/organizations" : "/clients"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
      <Route path="/clients" element={<Protected orgOnly><Clients /></Protected>} />
      <Route path="/clients/:clientId" element={<Protected orgOnly><ClientDetail /></Protected>} />
      <Route path="/campaigns" element={<Protected orgOnly><Campaigns /></Protected>} />
      <Route path="/campaigns/:campaignId" element={<Protected orgOnly><CampaignDetail /></Protected>} />
      <Route path="/articles" element={<Protected orgOnly><Articles /></Protected>} />
      <Route path="/review-queue" element={<Protected orgOnly><ReviewQueue /></Protected>} />
      <Route path="/team" element={<Protected orgAdminOnly><Team /></Protected>} />
      <Route path="/organizations" element={<Protected platformOnly><Organizations /></Protected>} />
      <Route path="/users" element={<Protected platformOnly><Users /></Protected>} />
      <Route path="/settings" element={<Protected platformOnly><SystemSettings /></Protected>} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
