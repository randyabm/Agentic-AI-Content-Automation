import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { BrandMemory } from "../components/BrandMemory";
import { Competitors } from "../components/Competitors";
import type { Client, ExtractionDraft, ExtractionJob } from "../types";

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

  if (!client) return <div className="page-loading">{error || "Loading…"}</div>;

  const running = job && RUNNING.includes(job.status);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{client.company_name}</h1>
          <a href={client.website_url} target="_blank" rel="noreferrer" className="muted">
            {client.website_url}
          </a>
        </div>
        <div className="competitor-actions">
          <Link className="btn btn-ghost" to={`/campaigns?client_id=${client.id}`}>
            Campaigns
          </Link>
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
              <button className="btn btn-ghost" onClick={startEditing}>
                Edit profile
              </button>
            )}
          </div>

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
              <ProfileSection label="Industry / Sector" value={client.industry} />
              <ProfileSection label="General description" value={client.description} />
              <ProfileSection label="Products and/or services" value={client.products_services} />
              <ProfileSection label="Target audience" value={client.target_audience} />
              <ProfileSection label="Value proposition" value={client.value_proposition} />
              <ProfileSection label="Business objectives" list={client.business_objectives} />
              <ProfileSection label="Communication tone" value={client.communication_tone} />
              <ProfileSection label="Social media" links={client.social_media_urls} />
              <ProfileSection label="Notes" value={client.notes} />
            </>
          )}
        </div>
        <div className="profile-side">
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
              <label className="btn btn-ghost file-btn">
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  hidden
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

function LogoPreview({ clientId }: { clientId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
    fetch(`${apiUrl}/clients/${clientId}/logo`, {
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
  }, [clientId]);
  if (!src) return <p className="muted">Loading logo…</p>;
  return <img src={src} alt="Client logo" className="logo-preview" />;
}
