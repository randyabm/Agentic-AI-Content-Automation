import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";

// Route-level code splitting: each page loads on first visit instead of
// shipping the whole app (image editor, calendar, dnd-kit…) on login.
const Articles = lazy(() => import("./pages/Articles"));
const Calendar = lazy(() => import("./pages/Calendar"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const CampaignPreview = lazy(() => import("./pages/CampaignPreview"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const Clients = lazy(() => import("./pages/Clients"));
const ClientSetup = lazy(() => import("./pages/ClientSetup"));
const Login = lazy(() => import("./pages/Login"));
const NewClient = lazy(() => import("./pages/NewClient"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback"));
const PublicApproval = lazy(() => import("./pages/PublicApproval"));
const Organizations = lazy(() => import("./pages/Organizations"));
const ReviewQueue = lazy(() => import("./pages/ReviewQueue"));
const SystemSettings = lazy(() => import("./pages/SystemSettings"));
const Team = lazy(() => import("./pages/Team"));
const Users = lazy(() => import("./pages/Users"));

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
  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
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
  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.is_platform_admin ? "/organizations" : "/clients"} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading…</div>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/approve/:token" element={<PublicApproval />} />
      <Route path="/" element={<Home />} />
      <Route path="/clients" element={<Protected orgOnly><Clients /></Protected>} />
      <Route path="/clients/new" element={<Protected orgOnly><NewClient /></Protected>} />
      <Route path="/clients/:clientId/setup" element={<Protected orgOnly><ClientSetup /></Protected>} />
      <Route path="/clients/:clientId" element={<Protected orgOnly><ClientDetail /></Protected>} />
      <Route path="/campaigns" element={<Protected orgOnly><Campaigns /></Protected>} />
      <Route path="/campaigns/:campaignId" element={<Protected orgOnly><CampaignDetail /></Protected>} />
      <Route path="/campaigns/:campaignId/preview" element={<Protected orgOnly><CampaignPreview /></Protected>} />
      <Route path="/articles" element={<Protected orgOnly><Articles /></Protected>} />
      <Route path="/calendar" element={<Protected orgOnly><Calendar /></Protected>} />
      <Route path="/review-queue" element={<Protected orgOnly><ReviewQueue /></Protected>} />
      <Route path="/team" element={<Protected orgAdminOnly><Team /></Protected>} />
      <Route path="/organizations" element={<Protected platformOnly><Organizations /></Protected>} />
      <Route path="/users" element={<Protected platformOnly><Users /></Protected>} />
      <Route path="/settings" element={<Protected platformOnly><SystemSettings /></Protected>} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="*" element={<Home />} />
    </Routes>
    </Suspense>
  );
}
