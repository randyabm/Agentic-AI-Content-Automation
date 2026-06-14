import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Client, Competitor, CompetitorSearchJob } from "../types";

const RUNNING_ANALYSIS = ["pending", "crawling", "extracting", "comparing"];
const RUNNING_SEARCH = ["pending", "identifying"];

export function Competitors({ client }: { client: Client }) {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [searchJob, setSearchJob] = useState<CompetitorSearchJob | null>(null);
  const [params, setParams] = useState({ num_competitors: 5, competitor_type: "direct", geographic_scope: "national" });
  const [manualUrl, setManualUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [list, job] = await Promise.all([
      api<Competitor[]>(`/clients/${client.id}/competitors`),
      api<CompetitorSearchJob | null>(`/clients/${client.id}/competitors/search/latest`),
    ]);
    setCompetitors(list);
    setSearchJob(job);
    return { list, job };
  }, [client.id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

  const busy =
    (searchJob && RUNNING_SEARCH.includes(searchJob.status)) ||
    competitors.some((c) => RUNNING_ANALYSIS.includes(c.analysis_status));

  useEffect(() => {
    if (busy && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const { list, job } = await load().catch(() => ({ list: [], job: null }));
        const stillBusy =
          (job && RUNNING_SEARCH.includes(job.status)) ||
          list.some((c) => RUNNING_ANALYSIS.includes(c.analysis_status));
        if (!stillBusy && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 4000);
    }
  }, [busy, load]);

  async function startSearch(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clients/${client.id}/competitors/search`, { method: "POST", body: params });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start search");
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clients/${client.id}/competitors`, { method: "POST", body: { website_url: manualUrl } });
      setManualUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add competitor");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this competitor?")) return;
    try {
      await api(`/clients/${client.id}/competitors/${id}`, { method: "DELETE" });
      setCompetitors((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function reanalyze(id: string) {
    setError("");
    try {
      await api(`/clients/${client.id}/competitors/${id}/analyze`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start analysis");
    }
  }

  const searching = !!(searchJob && RUNNING_SEARCH.includes(searchJob.status));
  const selected = competitors.find((c) => c.id === selectedId) ?? competitors[0] ?? null;

  return (
    <div className="competitors">
      {canEdit && (
        <div className="card comp-search">
          <h2>Find competitors automatically</h2>
          <p className="muted">
            Uses the configured LLM with web search to identify the most relevant competitors,
            then crawls and analyzes each one against this client.
          </p>
          <form className="comp-search-grid" onSubmit={startSearch}>
            <label>
              Number of competitors (1–20)
              <input type="number" min={1} max={20} value={params.num_competitors}
                onChange={(e) => setParams({ ...params, num_competitors: Number(e.target.value) })} />
            </label>
            <label>
              Type
              <select value={params.competitor_type}
                onChange={(e) => setParams({ ...params, competitor_type: e.target.value })}>
                <option value="direct">Direct</option>
                <option value="indirect">Indirect</option>
              </select>
            </label>
            <label>
              Geographic scope
              <select value={params.geographic_scope}
                onChange={(e) => setParams({ ...params, geographic_scope: e.target.value })}>
                <option value="local">Local</option>
                <option value="national">National</option>
                <option value="international">International</option>
              </select>
            </label>
            <button className="btn btn-primary" disabled={searching}>
              {searching ? "Searching…" : "Find competitors"}
            </button>
          </form>
          {searching && (
            <div className="progress-bar"><div className="progress-fill indeterminate" /></div>
          )}
          {searchJob?.status === "failed" && (
            <div className="alert alert-error">Last search failed: {searchJob.error}</div>
          )}
          <div className="comp-manual">
            <span className="comp-or">or add one manually</span>
            <form className="comp-manual-row" onSubmit={addManual}>
              <input type="url" placeholder="https://competitor.com" value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)} required />
              <button className="btn btn-secondary">Add competitor</button>
            </form>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {competitors.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">
            No competitors yet — run an automatic search above or add one by URL.
          </p>
        </div>
      ) : (
        <div className="card comp-workspace">
          <div className="comp-tabs" role="tablist">
            {competitors.map((c) => (
              <button
                key={c.id}
                role="tab"
                type="button"
                aria-selected={selected?.id === c.id}
                className={`comp-tab ${selected?.id === c.id ? "active" : ""}`}
                onClick={() => setSelectedId(c.id)}
                title={c.company_name}
              >
                <Dot status={c.analysis_status} />
                <span className="comp-tab-name">{c.company_name}</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="comp-detail" role="tabpanel">
              <div className="comp-detail-head">
                <div>
                  <h3>
                    {selected.company_name}{" "}
                    <span className={`tag ${selected.source === "auto" ? "" : "tag-green"}`}>{selected.source}</span>
                  </h3>
                  <a href={selected.website_url} target="_blank" rel="noreferrer" className="muted small">
                    {selected.website_url}
                  </a>
                </div>
                <div className="competitor-actions">
                  <StatusBadge status={selected.analysis_status} pages={selected.pages_crawled} />
                  {canEdit && !RUNNING_ANALYSIS.includes(selected.analysis_status) && (
                    <button className="btn btn-ghost" onClick={() => reanalyze(selected.id)}>Re-analyze</button>
                  )}
                  {canEdit && (
                    <button className="btn btn-ghost danger" onClick={() => remove(selected.id)}>Remove</button>
                  )}
                </div>
              </div>

              {selected.identification_reason && (
                <p className="comp-reason">{selected.identification_reason}</p>
              )}

              {selected.analysis_status === "failed" && (
                <div className="alert alert-error">{selected.analysis_error}</div>
              )}

              {RUNNING_ANALYSIS.includes(selected.analysis_status) && (
                <div className="progress-bar"><div className="progress-fill indeterminate" /></div>
              )}

              {selected.analysis_status === "completed" && (
                <>
                  <div className="versus-grid">
                    <div className="versus-col strengths">
                      <h4>Strengths vs {client.company_name}</h4>
                      <ul>{selected.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                    <div className="versus-col weaknesses">
                      <h4>Weaknesses vs {client.company_name}</h4>
                      <ul>{selected.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setExpanded(expanded === selected.id ? null : selected.id)}
                  >
                    {expanded === selected.id ? "Hide full profile" : "Show full profile"}
                  </button>
                  {expanded === selected.id && (
                    <div className="competitor-profile">
                      <Row label="Differential positioning" value={selected.positioning} />
                      <Row label="Industry" value={selected.industry} />
                      <Row label="Description" value={selected.description} />
                      <Row label="Products / services" value={selected.products_services} />
                      <Row label="Target audience" value={selected.target_audience} />
                      <Row label="Value proposition" value={selected.value_proposition} />
                      <Row label="Communication tone" value={selected.communication_tone} />
                      <Row label="Social media" value={selected.social_media_urls.join(", ")} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Dot({ status }: { status: string }) {
  const state =
    status === "completed" ? "ok" : status === "failed" ? "err"
    : RUNNING_ANALYSIS.includes(status) ? "busy" : "idle";
  return <span className={`comp-dot ${state}`} aria-hidden />;
}

function StatusBadge({ status, pages }: { status: string; pages: number }) {
  const cls =
    status === "completed" ? "tag-green" : status === "failed" ? "tag-red" : "";
  const label = RUNNING_ANALYSIS.includes(status)
    ? `${status}${status === "crawling" && pages ? ` (${pages} pages)` : ""}…`
    : status;
  return <span className={`tag ${cls}`}>{label}</span>;
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="profile-row">
      <div className="profile-label">{label}</div>
      <div>{value}</div>
    </div>
  );
}
