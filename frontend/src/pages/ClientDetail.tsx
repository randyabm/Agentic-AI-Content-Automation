import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BookOpen, ExternalLink, FileText, Search, Users } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ArticleModal } from "../components/ArticleModal";
import { AvatarCropper } from "../components/AvatarCropper";
import { BrandMemory } from "../components/BrandMemory";
import { TextareaZoom } from "../components/TextareaZoom";
import { ClientAvatar, useProtectedImage } from "../components/ClientAvatar";
import { Competitors } from "../components/Competitors";
import { PlatformIcon, platformFromUrl } from "../components/PlatformIcon";
import type { Article, ArticleListItem, Client, ExtractionDraft, ExtractionJob, OnboardingJob, OnboardingStatus } from "../types";

const RUNNING = ["pending", "crawling", "extracting"];

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const [client, setClient] = useState<Client | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"profile" | "articles" | "competitors">("profile");
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [showOnboardingPanel, setShowOnboardingPanel] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importLimit, setImportLimit] = useState(50);
  const pollRef = useRef<number | null>(null);

  const handleOnboardingProgress = useCallback(() => {
    api<Client>(`/clients/${clientId}`).then(setClient).catch(() => {});
  }, [clientId]);

  const loadJobs = useCallback(async () => {
    const jobs = await api<ExtractionJob[]>(`/clients/${clientId}/jobs`);
    const latest = jobs[0] ?? null;
    setJob(latest);
    if (latest?.status === "awaiting_review") {
      setDraft({
        company_name: latest.draft.company_name ?? "",
        industry: latest.draft.industry ?? "",
        description: latest.draft.description ?? "",
        products_services: latest.draft.products_services ?? "",
        target_audience: latest.draft.target_audience ?? "",
        value_proposition: latest.draft.value_proposition ?? "",
        business_objectives: latest.draft.business_objectives ?? [],
        communication_tone: latest.draft.communication_tone ?? "",
        social_media_urls: latest.draft.social_media_urls ?? [],
      });
    }
    return latest;
  }, [clientId]);

  useEffect(() => {
    api<Client>(`/clients/${clientId}`).then(setClient).catch((e) => setError(e.message));
    loadJobs().catch(() => {});
    api<{ key: string; value: string }[]>("/settings")
      .then((settings) => {
        const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
        setShowOnboardingPanel(byKey["show_onboarding_panel"] === "true");
        setDevMode(byKey["dev_mode"] === "true");
      })
      .catch(() => {});
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [clientId, loadJobs]);

  // Poll while a job is running.
  useEffect(() => {
    if (job && RUNNING.includes(job.status) && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const latest = await loadJobs().catch(() => null);
        if (!latest || !RUNNING.includes(latest.status)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2500);
    }
  }, [job, loadJobs]);

  async function analyze() {
    setError("");
    setNotice("");
    try {
      await api<ExtractionJob>(`/clients/${clientId}/analyze`, { method: "POST" });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start analysis");
    }
  }

  async function importArticles() {
    setError("");
    setNotice("");
    setImporting(true);
    try {
      const res = await api<{ detail: string; limit: number }>(
        `/clients/${clientId}/import-articles`,
        { method: "POST", body: { limit: importLimit } },
      );
      setNotice(`${res.detail} Check the Article Library shortly.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import articles");
    } finally {
      setImporting(false);
    }
  }

  async function confirmDraft() {
    if (!job || !draft) return;
    setError("");
    try {
      const updated = await api<Client>(`/clients/${clientId}/jobs/${job.id}/confirm`, {
        method: "POST",
        body: draft,
      });
      setClient(updated);
      setDraft(null);
      setJob(null);
      setNotice("Profile updated from website analysis.");
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm extraction");
    }
  }

  function startEditing() {
    if (!client) return;
    setProfileForm({
      industry: client.industry,
      description: client.description,
      products_services: client.products_services,
      target_audience: client.target_audience,
      value_proposition: client.value_proposition,
      business_objectives: client.business_objectives.join("\n"),
      communication_tone: client.communication_tone,
      social_media_urls: client.social_media_urls.join("\n"),
      notes: client.notes,
    });
    setEditing(true);
    setNotice("");
    setError("");
  }

  async function saveProfile() {
    if (!profileForm) return;
    setError("");
    try {
      const updated = await api<Client>(`/clients/${clientId}`, {
        method: "PATCH",
        body: {
          ...profileForm,
          business_objectives: profileForm.business_objectives.split("\n").map((s) => s.trim()).filter(Boolean),
          social_media_urls: profileForm.social_media_urls.split("\n").map((s) => s.trim()).filter(Boolean),
        },
      });
      setClient(updated);
      setEditing(false);
      setProfileForm(null);
      setNotice("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    }
  }

  async function uploadLogo(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const updated = await api<Client>(`/clients/${clientId}/logo`, { method: "POST", formData });
      setClient(updated);
      setNotice("Logo uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed");
    }
  }

  async function uploadAvatar(blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "avatar.png");
    try {
      const updated = await api<Client>(`/clients/${clientId}/avatar`, { method: "POST", formData });
      setClient(updated);
      setPendingAvatar(null);
      setNotice("Profile photo updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile photo upload failed");
    }
  }

  if (!client) return <div className="page-loading">{error || "Loading…"}</div>;

  const running = job && RUNNING.includes(job.status);

  // While the website is being analyzed / the profile is being generated, the
  // profile + photo + logo are read-only: the onboarding pipeline will populate
  // them, so manual edits here would conflict / be overwritten. We lock during an
  // active extraction, while a review draft is pending, and while the onboarding
  // pipeline is running (profile still empty). Clients that never ran onboarding
  // (no job) stay editable, so nothing is permanently locked.
  const profileEmpty =
    !client.industry &&
    !client.description &&
    !client.products_services &&
    !client.target_audience &&
    !client.value_proposition &&
    (client.business_objectives?.length ?? 0) === 0;
  const profileLocked = !!running || !!draft || (onboardingStatus === "running" && profileEmpty);

  return (
    <div>
      {pendingAvatar && (
        <AvatarCropper
          file={pendingAvatar}
          onCancel={() => setPendingAvatar(null)}
          onConfirm={uploadAvatar}
        />
      )}

      {/* Clean header — no action buttons */}
      <div className="client-detail-header">
        <ClientAvatar client={client} />
        <div className="client-detail-header-info">
          <h1>{client.company_name}</h1>
          <a href={client.website_url} target="_blank" rel="noreferrer" className="client-detail-url">
            {client.website_url} <ExternalLink size={12} />
          </a>
        </div>
        <div className="client-detail-header-links">
          <Link className="client-detail-nav-link" to={`/campaigns?client_id=${client.id}`}>
            Campaigns →
          </Link>
        </div>
      </div>

      {/* Redesigned tabs */}
      <div className="client-tabs">
        <button
          className={`client-tab${tab === "profile" ? " client-tab-active" : ""}`}
          onClick={() => setTab("profile")}
        >
          <FileText size={15} /> Profile &amp; Brand
        </button>
        <button
          className={`client-tab${tab === "articles" ? " client-tab-active" : ""}`}
          onClick={() => setTab("articles")}
        >
          <BookOpen size={15} /> Articles
        </button>
        <button
          className={`client-tab${tab === "competitors" ? " client-tab-active" : ""}`}
          onClick={() => setTab("competitors")}
        >
          <Users size={15} /> Competitors
        </button>
      </div>

      {tab === "competitors" && <Competitors client={client} onboardingRunning={onboardingStatus === "running"} />}

      {tab === "articles" && (
        <ClientArticles
          clientId={client.id}
          canEdit={canEdit}
          isAdmin={user?.role === "admin"}
          showImportControls={canEdit && devMode}
          importing={importing}
          importLimit={importLimit}
          onImportLimitChange={setImportLimit}
          onImport={importArticles}
          notice={notice}
          error={error}
        />
      )}

      {tab === "profile" && (
      <>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <OnboardingProgress
        clientId={clientId!}
        clientName={client.company_name}
        canEdit={canEdit}
        compact={!showOnboardingPanel}
        onStatus={setOnboardingStatus}
        onProgress={handleOnboardingProgress}
      />


      {running && (
        <div className="card progress-card">
          <strong>Website analysis in progress — {job!.status}</strong>
          <p className="muted">
            Pages crawled: {job!.pages_crawled}
            {job!.pages_total_estimate > 0 && ` (≈${job!.pages_total_estimate} discovered)`}
          </p>
          <div className="progress-bar">
            <div className="progress-fill indeterminate" />
          </div>
        </div>
      )}

      {job?.status === "failed" && (
        <div className="alert alert-error">Last analysis failed: {job.error}</div>
      )}

      {draft && canEdit && (
        <div className="card review-card">
          <h2>Review extracted profile</h2>
          <p className="muted">
            Review and edit the AI-extracted fields below, then confirm to apply them to the client profile.
          </p>
          <Field label="Company name" value={draft.company_name} onChange={(v) => setDraft({ ...draft, company_name: v })} />
          <Field label="Industry / Sector" value={draft.industry} onChange={(v) => setDraft({ ...draft, industry: v })} />
          <Area label="General description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
          <Area label="Products and/or services" value={draft.products_services} onChange={(v) => setDraft({ ...draft, products_services: v })} />
          <Area label="Target audience" value={draft.target_audience} onChange={(v) => setDraft({ ...draft, target_audience: v })} />
          <Area label="Value proposition" value={draft.value_proposition} onChange={(v) => setDraft({ ...draft, value_proposition: v })} />
          <Area
            label="Business objectives (one per line)"
            value={draft.business_objectives.join("\n")}
            onChange={(v) => setDraft({ ...draft, business_objectives: v.split("\n").filter(Boolean) })}
          />
          <Field label="Perceived communication tone" value={draft.communication_tone} onChange={(v) => setDraft({ ...draft, communication_tone: v })} />
          <Area
            label="Social media URLs (one per line)"
            value={draft.social_media_urls.join("\n")}
            onChange={(v) => setDraft({ ...draft, social_media_urls: v.split("\n").filter(Boolean) })}
          />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={confirmDraft}>
              Confirm and save profile
            </button>
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="two-col profile-layout">
        <div className="card profile-card">
          <div className="card-header-row">
            <h2>Profile</h2>
            {canEdit && !editing && (
              <button
                className="btn btn-ghost"
                onClick={startEditing}
                disabled={profileLocked}
                title={profileLocked ? "Available once the website analysis finishes" : undefined}
              >
                Edit profile
              </button>
            )}
          </div>

          {profileLocked && (
            <div className="profile-locked-hint muted small">
              ⏳ Generating this profile from the website analysis — editing will be
              available once it finishes.
            </div>
          )}

          {editing && profileForm ? (
            <>
              <Field label="Industry / Sector" value={profileForm.industry} onChange={(v) => setProfileForm({ ...profileForm, industry: v })} />
              <Area label="General description" rows={8} value={profileForm.description} onChange={(v) => setProfileForm({ ...profileForm, description: v })} />
              <Area label="Products and/or services" rows={6} value={profileForm.products_services} onChange={(v) => setProfileForm({ ...profileForm, products_services: v })} />
              <Area label="Target audience" value={profileForm.target_audience} onChange={(v) => setProfileForm({ ...profileForm, target_audience: v })} />
              <Area label="Value proposition" value={profileForm.value_proposition} onChange={(v) => setProfileForm({ ...profileForm, value_proposition: v })} />
              <Area label="Business objectives (one per line)" value={profileForm.business_objectives} onChange={(v) => setProfileForm({ ...profileForm, business_objectives: v })} />
              <Field label="Communication tone" value={profileForm.communication_tone} onChange={(v) => setProfileForm({ ...profileForm, communication_tone: v })} />
              <Area label="Social media URLs (one per line)" rows={3} value={profileForm.social_media_urls} onChange={(v) => setProfileForm({ ...profileForm, social_media_urls: v })} />
              <Area label="Notes" rows={3} value={profileForm.notes} onChange={(v) => setProfileForm({ ...profileForm, notes: v })} />
              <div className="form-actions">
                <button className="btn btn-primary" onClick={saveProfile}>
                  Save profile
                </button>
                <button className="btn btn-ghost" onClick={() => { setEditing(false); setProfileForm(null); }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="profile-facts">
                <ProfileFact label="Industry / Sector" value={client.industry} />
                <ProfileFact label="Communication tone" value={client.communication_tone} />
              </div>
              <ProfileSection label="General description" value={client.description} />
              <ProfileSection label="Products and/or services" value={client.products_services} />
              <ProfileSection label="Target audience" value={client.target_audience} />
              <ProfileSection label="Value proposition" value={client.value_proposition} />
              <ProfileSection label="Business objectives" list={client.business_objectives} />
              {client.notes && <ProfileSection label="Notes" value={client.notes} />}
            </>
          )}
        </div>
        <div className="profile-side">
          <div className="card">
            <h2>Profile photo</h2>
            <p className="muted small">Used as the brand avatar in post previews.</p>
            <div className="avatar-box">
              <ClientAvatar client={client} large />
            </div>
            {canEdit && (
              <label
                className={`btn btn-ghost file-btn ${profileLocked ? "disabled" : ""}`}
                title={profileLocked ? "Available once the website analysis finishes" : undefined}
              >
                {client.avatar_object_key ? "Change photo" : "Upload photo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  disabled={profileLocked}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setPendingAvatar(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <div className="card">
            <h2>Logo</h2>
            <div className="logo-box">
              {client.logo_object_key ? (
                <LogoPreview clientId={client.id} />
              ) : (
                <p className="muted">No logo uploaded.</p>
              )}
            </div>
            {canEdit && (
              <label
                className={`btn btn-ghost file-btn ${profileLocked ? "disabled" : ""}`}
                title={profileLocked ? "Available once the website analysis finishes" : undefined}
              >
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  hidden
                  disabled={profileLocked}
                  onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                />
              </label>
            )}
          </div>
          <BrandMemory client={client} canEdit={canEdit} />
          {client.social_media_urls?.length > 0 && (
            <div className="card">
              <h2>Social profiles</h2>
              <div className="social-profiles-list">
                {client.social_media_urls.map((url, i) => {
                  const platform = platformFromUrl(url);
                  const handle = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").split("/").filter(Boolean).pop() ?? url;
                  return (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="social-profile-row">
                      <span className="social-profile-icon">
                        {platform
                          ? <PlatformIcon platform={platform} size={18} />
                          : <ExternalLink size={16} />}
                      </span>
                      <span className="social-profile-handle">@{handle}</span>
                      <ExternalLink size={11} className="social-profile-ext" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
          {client.last_extraction_at && (
            <div className="card">
              <h2>Last analysis</h2>
              <p className="muted">{new Date(client.last_extraction_at).toLocaleString()}</p>
            </div>
          )}
          {canEdit && devMode && (
            <div className="card">
              <h2>Developer tools</h2>
              <p className="muted small" style={{ marginBottom: "0.75rem" }}>
                These actions are hidden in production. Enable Dev Mode in System Settings.
              </p>
              {running && (
                <p className="muted small" style={{ marginBottom: "0.5rem" }}>
                  ⏳ Analysis running…
                </p>
              )}
              <button className="btn btn-primary" onClick={analyze} disabled={!!running}>
                {running ? "Analyzing…" : "Analyze Website"}
              </button>
            </div>
          )}
        </div>
      </div>

      </>
      )}
    </div>
  );
}


function ClientArticles({
  clientId,
  canEdit,
  isAdmin,
  showImportControls,
  importing,
  importLimit,
  onImportLimitChange,
  onImport,
  notice,
  error,
}: {
  clientId: string;
  canEdit: boolean;
  isAdmin: boolean;
  showImportControls: boolean;
  importing: boolean;
  importLimit: number;
  onImportLimitChange: (n: number) => void;
  onImport: () => void;
  notice: string;
  error: string;
}) {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Article | null>(null);

  useEffect(() => {
    setLoading(true);
    api<ArticleListItem[]>(`/articles?client_id=${clientId}&article_status=active`)
      .then(setArticles)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  const visible = useMemo(() => {
    const lq = q.trim().toLowerCase();
    const filtered = lq
      ? articles.filter((a) => a.title.toLowerCase().includes(lq) || a.summary?.toLowerCase().includes(lq))
      : articles;
    return [...filtered].sort((a, b) => {
      const da = Date.parse(a.publication_date ?? a.created_at) || 0;
      const db = Date.parse(b.publication_date ?? b.created_at) || 0;
      return db - da;
    });
  }, [articles, q]);

  async function openArticle(id: string) {
    try {
      setSelected(await api<Article>(`/articles/${id}`));
    } catch {
      // silently ignore
    }
  }

  async function articleAction(id: string, path: string, method = "POST") {
    try {
      await api(`/articles/${id}${path}`, { method });
      setSelected(null);
      const list = await api<ArticleListItem[]>(`/articles?client_id=${clientId}&article_status=active`);
      setArticles(list);
    } catch {
      // silently ignore
    }
  }

  return (
    <div>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="client-articles-bar">
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input
            placeholder="Search articles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ margin: 0, paddingLeft: "2rem", width: "100%" }}
          />
        </div>
        <span className="muted small">{visible.length} article{visible.length !== 1 ? "s" : ""}</span>
        {showImportControls && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginLeft: "auto" }}>
            <input
              type="number"
              min={1}
              max={200}
              value={importLimit}
              onChange={(e) => onImportLimitChange(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              disabled={importing}
              style={{ width: 64, margin: 0 }}
              title="Max articles to import"
            />
            <button className="btn btn-ghost" onClick={onImport} disabled={importing}>
              {importing ? "Importing…" : "Import from website"}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="muted">Loading articles…</p>
      ) : visible.length === 0 ? (
        <p className="muted">
          {articles.length === 0 ? "No articles yet." : "No articles match your search."}
        </p>
      ) : (
        <div className="client-articles-list">
          {visible.map((a) => (
            <div key={a.id} className="client-article-row" onClick={() => openArticle(a.id)} style={{ cursor: "pointer" }}>
              <div className="client-article-main">
                <span className="client-article-title">{a.title}</span>
                {a.summary && (
                  <p className="client-article-summary muted small">{a.summary}</p>
                )}
              </div>
              <div className="client-article-meta">
                {a.publication_date && (
                  <span className="muted small">
                    {new Date(a.publication_date).toLocaleDateString()}
                  </span>
                )}
                {a.tags?.slice(0, 2).map((t) => (
                  <span key={t} className="tag" style={{ fontSize: "0.72rem" }}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <ArticleModal
          article={selected}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onAction={articleAction}
        />
      )}
    </div>
  );
}

const STEP_ICON: Record<string, string> = {
  pending: "○",
  running: "⏳",
  ok: "✓",
  error: "✗",
  skipped: "–",
};

function OnboardingProgress({
  clientId,
  clientName,
  canEdit,
  compact = false,
  onStatus,
  onProgress,
}: {
  clientId: string;
  clientName?: string;
  canEdit: boolean;
  compact?: boolean;
  onStatus?: (status: OnboardingStatus | null) => void;
  onProgress?: () => void;
}) {
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);
  const doneCountRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const j = await api<OnboardingJob>(`/clients/${clientId}/onboarding`);
      setJob(j);
      onStatus?.(j.status);
      // Refresh client data whenever a new step completes or onboarding finishes.
      const newDone = j.steps.filter((s) => s.status === "ok" || s.status === "skipped").length;
      if (newDone > doneCountRef.current || (j.status !== "running" && doneCountRef.current > 0)) {
        doneCountRef.current = newDone;
        onProgress?.();
      } else {
        doneCountRef.current = newDone;
      }
      return j;
    } catch {
      setJob(null); // 404 = client was never onboarded (e.g. created before this feature)
      onStatus?.(null);
      return null;
    }
  }, [clientId, onStatus, onProgress]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the pipeline is running.
  useEffect(() => {
    if (job?.status === "running" && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const j = await load();
        if (j?.status !== "running" && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    }
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job?.status, load]);

  async function rerun() {
    setErr("");
    setBusy(true);
    try {
      setJob(await api<OnboardingJob>(`/clients/${clientId}/onboard`, { method: "POST" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start onboarding");
    } finally {
      setBusy(false);
    }
  }

  async function retryStep(stepKey: string) {
    setErr("");
    setBusy(true);
    try {
      setJob(await api<OnboardingJob>(`/clients/${clientId}/onboarding/retry/${stepKey}`, { method: "POST" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not retry step");
    } finally {
      setBusy(false);
    }
  }

  const running = job?.status === "running";
  const total = job?.steps.length ?? 0;
  const done = job?.steps.filter((s) => s.status === "ok" || s.status === "skipped").length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const currentStep = job?.steps.find((s) => s.status === "running");

  // Compact mode: show a running banner or a failure banner; hide on success.
  if (compact) {
    if (!job) return null;

    if (running) {
      return (
        <div className="card onboarding-setup-banner">
          <div className="onboarding-setup-icon">
            <span className="spinner-inline" style={{ width: 22, height: 22, borderWidth: 3 }} />
          </div>
          <div className="onboarding-setup-body">
            <strong className="onboarding-setup-title">
              Setting up {clientName ?? "this client"}…
            </strong>
            <p className="onboarding-setup-sub muted small">
              {currentStep
                ? currentStep.label
                : "Analyzing website, importing articles and researching competitors."}
              {" "}This usually takes a few minutes.
            </p>
            <div className="onboarding-setup-progress">
              <div className="progress-bar" style={{ flex: 1 }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="muted small" style={{ whiteSpace: "nowrap" }}>{done} / {total} steps</span>
            </div>
          </div>
        </div>
      );
    }

    const failedSteps = job.steps.filter((s) => s.status === "error" || s.status === "pending");
    if (failedSteps.length === 0) return null;

    return (
      <div className="card onboarding-setup-banner onboarding-setup-banner--failed">
        <div className="onboarding-setup-icon">⚠</div>
        <div className="onboarding-setup-body">
          <strong className="onboarding-setup-title">Setup incomplete</strong>
          <p className="onboarding-setup-sub muted small">
            {failedSteps.length === 1
              ? `"${failedSteps[0].label}" didn't finish.`
              : `${failedSteps.length} steps didn't finish: ${failedSteps.map((s) => s.label).join(", ")}.`}
          </p>
          {err && <div className="alert alert-error" style={{ marginTop: "0.5rem" }}>{err}</div>}
          {canEdit && (
            <div className="onboarding-setup-actions">
              {failedSteps.map((s) => (
                <button
                  key={s.key}
                  className="btn btn-secondary small"
                  disabled={busy}
                  onClick={() => retryStep(s.key)}
                >
                  {busy ? "Retrying…" : `Retry: ${s.label}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full panel mode (show_onboarding_panel = true in settings).
  if (!job) {
    return canEdit ? (
      <div className="card onboarding-card">
        <div className="onboarding-head">
          <strong>Onboarding</strong>
          <button className="btn btn-ghost small" onClick={rerun} disabled={busy}>
            {busy ? "Starting…" : "Run onboarding"}
          </button>
        </div>
        {err && <div className="alert alert-error">{err}</div>}
      </div>
    ) : null;
  }

  const title =
    running ? "Setting up this client…"
    : job.status === "completed" ? "Onboarding complete"
    : job.status === "completed_with_errors" ? "Onboarding finished with some errors"
    : "Onboarding failed";

  return (
    <div className="card onboarding-card">
      <div className="onboarding-head">
        <strong>{running && <span className="spinner-inline" />} {title}</strong>
        {canEdit && !running && (
          <button className="btn btn-ghost small" onClick={rerun} disabled={busy}>
            {busy ? "Starting…" : "Re-run onboarding"}
          </button>
        )}
      </div>

      <div className="onboarding-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="muted small">{done} of {total} steps</span>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      <ul className="onboarding-steps">
        {job.steps.map((s) => (
          <li key={s.key} className={`onboarding-step step-${s.status}`}>
            <span className="step-icon">{STEP_ICON[s.status] ?? "○"}</span>
            <span className="step-label">{s.label}</span>
            {s.detail && <span className="step-detail muted small">{s.detail}</span>}
            {canEdit && !running && s.status === "error" && (
              <button className="btn btn-ghost small" onClick={() => retryStep(s.key)} disabled={busy}>
                Retry
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type ProfileForm = {
  industry: string;
  description: string;
  products_services: string;
  target_audience: string;
  value_proposition: string;
  business_objectives: string;
  communication_tone: string;
  social_media_urls: string;
  notes: string;
};

function ProfileFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="profile-fact">
      <div className="profile-section-label">{label}</div>
      <div className="profile-fact-value">{value || "—"}</div>
    </div>
  );
}

function ProfileSection({
  label,
  value,
  list,
  links,
}: {
  label: string;
  value?: string;
  list?: string[];
  links?: string[];
}) {
  const empty = !value && !list?.length && !links?.length;
  return (
    <div className="profile-section">
      <div className="profile-section-label">{label}</div>
      {empty ? (
        <div className="muted">—</div>
      ) : list ? (
        <ul className="profile-list">
          {list.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : links ? (
        <div className="profile-links">
          {links.map((url, i) => {
            const platform = platformFromUrl(url);
            return (
              <a key={i} href={url} target="_blank" rel="noreferrer">
                {platform && <PlatformIcon platform={platform} size={15} />}
                {url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            );
          })}
        </div>
      ) : (
        <div className="profile-section-text">{value}</div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      {label}
      <TextareaZoom label={label} rows={1} value={value} onChange={onChange} />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label>
      {label}
      <TextareaZoom label={label} rows={rows} value={value} onChange={onChange} />
    </label>
  );
}

function LogoPreview({ clientId }: { clientId: string }) {
  const src = useProtectedImage(`/clients/${clientId}/logo`, true);
  if (!src) return <p className="muted">Loading logo…</p>;
  return <img src={src} alt="Client logo" className="logo-preview" />;
}
