import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AvatarCropper } from "../components/AvatarCropper";
import { BrandMemory } from "../components/BrandMemory";
import { Competitors } from "../components/Competitors";
import type { Client, ExtractionDraft, ExtractionJob, OnboardingJob, OnboardingStatus } from "../types";

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
  const [tab, setTab] = useState<"profile" | "competitors" | "brand">("profile");
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [importing, setImporting] = useState(false);
  const [importLimit, setImportLimit] = useState(50);
  const pollRef = useRef<number | null>(null);

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
      <div className="page-header">
        <div className="client-head">
          <ClientAvatar client={client} />
          <div>
            <h1>{client.company_name}</h1>
            <a href={client.website_url} target="_blank" rel="noreferrer" className="muted">
              {client.website_url}
            </a>
          </div>
        </div>
        <div className="competitor-actions">
          <Link className="btn btn-ghost" to={`/campaigns?client_id=${client.id}`}>
            Campaigns
          </Link>
          <Link className="btn btn-ghost" to={`/articles?client_id=${client.id}`}>
            Articles
          </Link>
          {canEdit && tab === "profile" && (
            <div className="import-articles-control">
              <input
                type="number"
                min={1}
                max={200}
                value={importLimit}
                onChange={(e) =>
                  setImportLimit(Math.max(1, Math.min(200, Number(e.target.value) || 1)))
                }
                disabled={importing}
                title="Number of articles to import (1–200)"
                aria-label="Number of articles to import"
              />
              <button className="btn btn-ghost" onClick={importArticles} disabled={importing}>
                {importing ? "Importing…" : "Import articles from website"}
              </button>
            </div>
          )}
          {canEdit && tab === "profile" && (
            <button className="btn btn-primary" onClick={analyze} disabled={!!running}>
              {running ? "Analyzing…" : "Analyze Website"}
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "profile" ? "tab-active" : ""}`} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button
          className={`tab ${tab === "competitors" ? "tab-active" : ""}`}
          onClick={() => setTab("competitors")}
        >
          Competitors
        </button>
        <button className={`tab ${tab === "brand" ? "tab-active" : ""}`} onClick={() => setTab("brand")}>
          Brand Memory
        </button>
      </div>

      {tab === "competitors" && <Competitors client={client} />}
      {tab === "brand" && <BrandMemory client={client} canEdit={canEdit} />}

      {tab === "profile" && (
      <>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <OnboardingProgress clientId={clientId!} canEdit={canEdit} onStatus={setOnboardingStatus} />


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
              <ProfileSection label="Social media" links={client.social_media_urls} />
              <ProfileSection label="Notes" value={client.notes} />
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
          {client.last_extraction_at && (
            <div className="card">
              <h2>Last analysis</h2>
              <p className="muted">{new Date(client.last_extraction_at).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
      </>
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
  canEdit,
  onStatus,
}: {
  clientId: string;
  canEdit: boolean;
  onStatus?: (status: OnboardingStatus | null) => void;
}) {
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api<OnboardingJob>(`/clients/${clientId}/onboarding`);
      setJob(j);
      onStatus?.(j.status);
      return j;
    } catch {
      setJob(null); // 404 = client was never onboarded (e.g. created before this feature)
      onStatus?.(null);
      return null;
    }
  }, [clientId, onStatus]);

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

  const running = job.status === "running";
  const total = job.steps.length;
  const done = job.steps.filter((s) => s.status === "ok" || s.status === "skipped").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
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
          {links.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer">
              {url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </a>
          ))}
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
      <input value={value} onChange={(e) => onChange(e.target.value)} />
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
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Fetch a protected image endpoint as an object URL (auth header, revoked on cleanup). */
function useProtectedImage(path: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return;
    }
    let revoked: string | null = null;
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
    fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (blob) {
          revoked = URL.createObjectURL(blob);
          setSrc(revoked);
        }
      });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [path, enabled]);
  return src;
}

function LogoPreview({ clientId }: { clientId: string }) {
  const src = useProtectedImage(`/clients/${clientId}/logo`, true);
  if (!src) return <p className="muted">Loading logo…</p>;
  return <img src={src} alt="Client logo" className="logo-preview" />;
}

/** Round brand avatar — the client's profile photo, falling back to its initial. */
function ClientAvatar({ client, large }: { client: Client; large?: boolean }) {
  const src = useProtectedImage(`/clients/${client.id}/avatar`, !!client.avatar_object_key);
  const cls = `client-avatar ${large ? "lg" : ""}`;
  if (src) return <img src={src} alt="" className={cls} />;
  return <div className={`${cls} placeholder`}>{(client.company_name[0] ?? "?").toUpperCase()}</div>;
}
