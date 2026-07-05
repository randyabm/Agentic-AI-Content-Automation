import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BookOpen, ExternalLink, FileText, Search, Share2, Users } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { ArticleModal } from "../components/ArticleModal";
import { AvatarCropper } from "../components/AvatarCropper";
import { BrandMemory } from "../components/BrandMemory";
import { TextareaZoom } from "../components/TextareaZoom";
import { ClientAvatar, useProtectedImage } from "../components/ClientAvatar";
import { Channels } from "../components/Channels";
import { Competitors } from "../components/Competitors";
import { PlatformIcon, platformFromUrl } from "../components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  const [tab, setTab] = useState<"profile" | "articles" | "competitors" | "channels">("profile");
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [showOnboardingPanel, setShowOnboardingPanel] = useState(false);
  const [devMode, setDevMode] = useState(false);
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
      const updated = await api<Client>(`/clients/${clientId}/jobs/${job.id}/confirm`, { method: "POST", body: draft });
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

  if (!client) {
    if (error) return <div className="py-12 text-center text-muted-foreground">{error}</div>;
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const running = job && RUNNING.includes(job.status);
  const profileEmpty = !client.industry && !client.description && !client.products_services && !client.target_audience && !client.value_proposition && (client.business_objectives?.length ?? 0) === 0;
  const profileLocked = !!running || !!draft || (onboardingStatus === "running" && profileEmpty);

  return (
    <div>
      {pendingAvatar && (
        <AvatarCropper file={pendingAvatar} onCancel={() => setPendingAvatar(null)} onConfirm={uploadAvatar} />
      )}

      <Breadcrumb items={[{ label: "Clients", to: "/clients" }, { label: client.company_name }]} />

      <div className="mb-5 flex items-center gap-4">
        <ClientAvatar client={client} />
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{client.company_name}</h1>
          <a href={client.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            {client.website_url} <ExternalLink size={12} />
          </a>
        </div>
        <div>
          <Button variant="ghost" asChild>
            <Link to={`/campaigns?client_id=${client.id}`}>Campaigns →</Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {(["profile", "articles", "competitors", "channels"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t
                ? "border-b-2 border-primary text-foreground"
                : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "profile" && <FileText size={15} />}
            {t === "articles" && <BookOpen size={15} />}
            {t === "competitors" && <Users size={15} />}
            {t === "channels" && <Share2 size={15} />}
            {t === "profile" ? "Profile & Brand" : t === "articles" ? "Articles" : t === "competitors" ? "Competitors" : "Channels"}
          </button>
        ))}
      </div>

      {tab === "competitors" && <Competitors client={client} onboardingRunning={onboardingStatus === "running"} />}
      {tab === "channels" && <Channels client={client} canEdit={canEdit} />}
      {tab === "articles" && <ClientArticles clientId={client.id} canEdit={canEdit} isAdmin={user?.role === "admin"} />}

      {tab === "profile" && (
        <>
          {notice && (
            <div className="mb-4 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}

          <OnboardingProgress
            clientId={clientId!}
            clientName={client.company_name}
            canEdit={canEdit}
            compact={!showOnboardingPanel}
            onStatus={setOnboardingStatus}
            onProgress={handleOnboardingProgress}
          />

          {running && (
            <Card className="mb-4">
              <CardContent className="py-4">
                <strong>Website analysis in progress — {job!.status}</strong>
                <p className="text-sm text-muted-foreground">
                  Pages crawled: {job!.pages_crawled}
                  {job!.pages_total_estimate > 0 && ` (≈${job!.pages_total_estimate} discovered)`}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                  <div className="h-full w-[35%] animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
                </div>
              </CardContent>
            </Card>
          )}

          {job?.status === "failed" && (
            <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              Last analysis failed: {job.error}
            </div>
          )}

          {draft && canEdit && (
            <Card className="mb-4">
              <CardContent className="space-y-3 py-5">
                <div>
                  <h2 className="mb-1">Review extracted profile</h2>
                  <p className="text-sm text-muted-foreground">
                    Review and edit the AI-extracted fields below, then confirm to apply them to the client profile.
                  </p>
                </div>
                <Field label="Company name" value={draft.company_name} onChange={(v) => setDraft({ ...draft, company_name: v })} />
                <Field label="Industry / Sector" value={draft.industry} onChange={(v) => setDraft({ ...draft, industry: v })} />
                <Area label="General description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
                <Area label="Products and/or services" value={draft.products_services} onChange={(v) => setDraft({ ...draft, products_services: v })} />
                <Area label="Target audience" value={draft.target_audience} onChange={(v) => setDraft({ ...draft, target_audience: v })} />
                <Area label="Value proposition" value={draft.value_proposition} onChange={(v) => setDraft({ ...draft, value_proposition: v })} />
                <Area label="Business objectives (one per line)" value={draft.business_objectives.join("\n")} onChange={(v) => setDraft({ ...draft, business_objectives: v.split("\n").filter(Boolean) })} />
                <Field label="Perceived communication tone" value={draft.communication_tone} onChange={(v) => setDraft({ ...draft, communication_tone: v })} />
                <Area label="Social media URLs (one per line)" value={draft.social_media_urls.join("\n")} onChange={(v) => setDraft({ ...draft, social_media_urls: v.split("\n").filter(Boolean) })} />
                <div className="flex gap-2">
                  <Button onClick={confirmDraft}>Confirm and save profile</Button>
                  <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
            <Card className="px-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
                {canEdit && !editing && (
                  <Button variant="ghost" onClick={startEditing} disabled={profileLocked} title={profileLocked ? "Available once the website analysis finishes" : undefined}>
                    Edit profile
                  </Button>
                )}
              </div>

              {profileLocked && (
                <div className="mb-3 text-sm text-muted-foreground">
                  ⏳ Generating this profile from the website analysis — editing will be available once it finishes.
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
                  <div className="flex gap-2">
                    <Button onClick={saveProfile}>Save profile</Button>
                    <Button variant="ghost" onClick={() => { setEditing(false); setProfileForm(null); }}>Cancel</Button>
                  </div>
                </>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ProfileFact label="Industry / Sector" value={client.industry} />
                    <ProfileFact label="Communication tone" value={client.communication_tone} />
                  </div>
                  <ProfileSection label="General description" value={client.description} />
                  <ProfileSection label="Products and/or services" value={client.products_services} />
                  <ProfileSection label="Target audience" value={client.target_audience} />
                  <ProfileSection label="Value proposition" value={client.value_proposition} />
                  <ProfileSection label="Business objectives" list={client.business_objectives} />
                  {client.notes && <ProfileSection label="Notes" value={client.notes} />}
                </div>
              )}
            </Card>
            <div className="flex flex-col gap-4">
              <Card>
                <CardContent className="space-y-3 py-5">
                  <h2 className="m-0">Profile photo</h2>
                  <p className="text-sm text-muted-foreground">Used as the brand avatar in post previews.</p>
                  <div className="flex justify-center rounded-md border border-border bg-surface-alt p-4">
                    <ClientAvatar client={client} large />
                  </div>
                  {canEdit && (
                    <Button
                      asChild
                      variant="ghost"
                      className={cn("w-full", profileLocked && "pointer-events-none opacity-50")}
                      title={profileLocked ? "Available once the website analysis finishes" : undefined}
                    >
                      <label className="flex cursor-pointer items-center justify-center gap-1.5">
                        {client.avatar_object_key ? "Change photo" : "Upload photo"}
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={profileLocked}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingAvatar(f); e.target.value = ""; }} />
                      </label>
                    </Button>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-3 py-5">
                  <h2 className="m-0">Logo</h2>
                  <div className="flex min-h-[100px] items-center justify-center rounded-md border border-border bg-surface-alt p-4">
                    {client.logo_object_key ? (
                      <LogoPreview clientId={client.id} logoObjectKey={client.logo_object_key} />
                    ) : (
                      <p className="text-sm text-muted-foreground">No logo uploaded.</p>
                    )}
                  </div>
                  {canEdit && (
                    <Button
                      asChild
                      variant="ghost"
                      className={cn("w-full", profileLocked && "pointer-events-none opacity-50")}
                      title={profileLocked ? "Available once the website analysis finishes" : undefined}
                    >
                      <label className="flex cursor-pointer items-center justify-center gap-1.5">
                        Upload logo
                        <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden disabled={profileLocked}
                          onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                      </label>
                    </Button>
                  )}
                </CardContent>
              </Card>
              <BrandMemory client={client} canEdit={canEdit} />
              {client.social_media_urls?.length > 0 && (
                <Card>
                  <CardContent className="space-y-2 py-5">
                    <h2 className="m-0">Social profiles</h2>
                    <div className="flex flex-col gap-1">
                      {client.social_media_urls.map((url, i) => {
                        const platform = platformFromUrl(url);
                        const handle = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").split("/").filter(Boolean).pop() ?? url;
                        return (
                          <a key={i} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                            <span className="flex size-7 items-center justify-center rounded-md bg-surface-alt">
                              {platform ? <PlatformIcon platform={platform} size={18} /> : <ExternalLink size={16} />}
                            </span>
                            <span className="font-medium">@{handle}</span>
                            <ExternalLink size={11} className="ml-auto text-muted-foreground" />
                          </a>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
              {client.last_extraction_at && (
                <Card>
                  <CardContent className="py-5">
                    <h2 className="mb-2">Last analysis</h2>
                    <p className="text-sm text-muted-foreground">{new Date(client.last_extraction_at).toLocaleString()}</p>
                  </CardContent>
                </Card>
              )}
              {canEdit && devMode && (
                <Card>
                  <CardContent className="space-y-3 py-5">
                    <h2 className="m-0">Developer tools</h2>
                    <p className="mb-3 text-sm text-muted-foreground">These actions are hidden in production. Enable Dev Mode in System Settings.</p>
                    {running && <p className="mb-2 text-sm text-muted-foreground">⏳ Analysis running…</p>}
                    <Button onClick={analyze} disabled={!!running}>
                      {running ? "Analyzing…" : "Analyze Website"}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type ImportMode = "date" | "url";

function ClientArticles({ clientId, canEdit, isAdmin }: { clientId: string; canEdit: boolean; isAdmin: boolean }) {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Article | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("date");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [importLimit, setImportLimit] = useState(50);
  const [importUrl, setImportUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");
  const importPollRef = useRef<number | null>(null);

  const reloadArticles = useCallback(() => {
    api<ArticleListItem[]>(`/articles?client_id=${clientId}&article_status=active`).then(setArticles).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    api<ArticleListItem[]>(`/articles?client_id=${clientId}&article_status=active`).then(setArticles).catch(() => {}).finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => () => { if (importPollRef.current) window.clearInterval(importPollRef.current); }, []);

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
    try { setSelected(await api<Article>(`/articles/${id}`)); } catch { /* noop */ }
  }

  async function articleAction(id: string, path: string, method = "POST") {
    try { await api(`/articles/${id}${path}`, { method }); setSelected(null); reloadArticles(); } catch { /* noop */ }
  }

  async function handleImportByDate() {
    setImportError("");
    setImportNotice("");
    setImportBusy(true);
    try {
      const body: Record<string, unknown> = { limit: importLimit };
      if (fromDate) body.from_date = fromDate;
      if (toDate) body.to_date = toDate;
      await api<{ detail: string }>(`/clients/${clientId}/import-articles`, { method: "POST", body });
      setImportNotice("Import started — new articles will appear in the list in a few moments.");
      setTimeout(reloadArticles, 5000);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleImportByUrl() {
    const url = importUrl.trim();
    if (!url) return;
    setImportError("");
    setImportNotice("");
    setImportBusy(true);
    try {
      const res = await api<{ status: string; detail: string; article_id: string | null }>(`/clients/${clientId}/import-article-url`, { method: "POST", body: { url } });
      if (res.status === "already_exists") { setImportNotice("This article is already in the library."); setImportBusy(false); return; }
      if (res.article_id) {
        const articleId = res.article_id;
        importPollRef.current = window.setInterval(async () => {
          try {
            const a = await api<Article>(`/articles/${articleId}`);
            if (!a.summary.startsWith("[Fetching")) {
              if (importPollRef.current) window.clearInterval(importPollRef.current);
              importPollRef.current = null;
              setImportBusy(false);
              if (a.summary.startsWith("[Extraction")) setImportError(`Could not extract article: ${a.summary}`);
              else { setImportNotice(`Imported: "${a.title}"`); setImportUrl(""); reloadArticles(); }
            }
          } catch { if (importPollRef.current) window.clearInterval(importPollRef.current); importPollRef.current = null; setImportBusy(false); }
        }, 3000);
      } else { setImportBusy(false); }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
      setImportBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative max-w-[320px] flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <span className="text-sm text-muted-foreground">{visible.length} article{visible.length !== 1 ? "s" : ""}</span>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className={cn("ml-auto", showImport && "bg-accent text-accent-foreground")}
            onClick={() => { setShowImport((v) => !v); setImportNotice(""); setImportError(""); }}
          >
            + Import articles
          </Button>
        )}
      </div>

      {showImport && canEdit && (
        <Card>
          <div className="flex border-b border-border">
            {(["date", "url"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setImportMode(m); setImportNotice(""); setImportError(""); }}
                className={cn(
                  "border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  importMode === m && "border-primary text-foreground",
                )}
              >
                {m === "date" ? "From website (by date)" : "From URL"}
              </button>
            ))}
          </div>

          <CardContent className="py-4">
            {importMode === "date" && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={importBusy} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={importBusy} />
                  </div>
                  <div className="space-y-1.5">
                    <Label title="Maximum articles to import">Limit</Label>
                    <Input type="number" min={1} max={500} value={importLimit} onChange={(e) => setImportLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} disabled={importBusy} className="w-20" />
                  </div>
                  <Button onClick={handleImportByDate} disabled={importBusy}>
                    {importBusy ? "Importing…" : "Import"}
                  </Button>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Leave dates empty to import the most recent articles. Already-imported articles are skipped automatically.
                </p>
              </>
            )}
            {importMode === "url" && (
              <>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label>Article URL</Label>
                    <Input type="url" placeholder="https://example.com/blog/article-title" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} disabled={importBusy} />
                  </div>
                  <Button onClick={handleImportByUrl} disabled={importBusy || !importUrl.trim()}>
                    {importBusy ? "Importing…" : "Import"}
                  </Button>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">If the URL is already in the library, it won't be imported again.</p>
              </>
            )}
            {importNotice && (
              <div className="mt-3 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{importNotice}</div>
            )}
            {importError && (
              <div className="mt-3 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{importError}</div>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading articles…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {articles.length === 0 ? "No articles yet." : "No articles match your search."}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.map((a) => (
            <div key={a.id} onClick={() => openArticle(a.id)} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent">
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{a.title}</span>
                {a.summary && <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{a.summary}</p>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 text-sm">
                {a.publication_date && <span className="text-sm text-muted-foreground">{new Date(a.publication_date).toLocaleDateString()}</span>}
                {a.tags?.slice(0, 2).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <ArticleModal article={selected} canEdit={canEdit} isAdmin={isAdmin} onClose={() => setSelected(null)} onAction={articleAction} />
      )}
    </div>
  );
}

const STEP_ICON: Record<string, string> = {
  pending: "○", running: "⏳", ok: "✓", error: "✗", skipped: "–",
};

function OnboardingProgress({ clientId, clientName, canEdit, compact = false, onStatus, onProgress }: { clientId: string; clientName?: string; canEdit: boolean; compact?: boolean; onStatus?: (status: OnboardingStatus | null) => void; onProgress?: () => void }) {
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
      const newDone = j.steps.filter((s) => s.status === "ok" || s.status === "skipped").length;
      if (newDone > doneCountRef.current || (j.status !== "running" && doneCountRef.current > 0)) {
        doneCountRef.current = newDone;
        onProgress?.();
      } else { doneCountRef.current = newDone; }
      return j;
    } catch {
      setJob(null);
      onStatus?.(null);
      return null;
    }
  }, [clientId, onStatus, onProgress]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (job?.status === "running" && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const j = await load();
        if (j?.status !== "running" && pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      }, 2000);
    }
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  }, [job?.status, load]);

  async function rerun() {
    setErr("");
    setBusy(true);
    try { setJob(await api<OnboardingJob>(`/clients/${clientId}/onboard`, { method: "POST" })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not start onboarding"); }
    finally { setBusy(false); }
  }

  async function retryStep(stepKey: string) {
    setErr("");
    setBusy(true);
    try { setJob(await api<OnboardingJob>(`/clients/${clientId}/onboarding/retry/${stepKey}`, { method: "POST" })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not retry step"); }
    finally { setBusy(false); }
  }

  const running = job?.status === "running";
  const total = job?.steps.length ?? 0;
  const done = job?.steps.filter((s) => s.status === "ok" || s.status === "skipped").length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const currentStep = job?.steps.find((s) => s.status === "running");

  if (compact) {
    if (!job) return null;
    if (running) {
      return (
        <Card className="mb-4 border-violet-300 bg-gradient-to-br from-indigo-50 to-violet-50">
          <CardContent className="flex items-start gap-4 py-4">
            <div className="flex size-9 flex-shrink-0 items-center justify-center">
              <span className="size-6 animate-spin rounded-full border-[3px] border-violet-700 border-t-transparent" />
            </div>
            <div className="min-w-0 flex-1">
              <strong className="text-violet-800">Setting up {clientName ?? "this client"}…</strong>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {currentStep ? currentStep.label : "Analyzing website, importing articles and researching competitors."} This usually takes a few minutes.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                </div>
                <span className="whitespace-nowrap text-sm text-muted-foreground">{done} / {total} steps</span>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    const failedSteps = job.steps.filter((s) => s.status === "error" || s.status === "pending");
    if (failedSteps.length === 0) return null;

    return (
      <Card className="mb-4 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardContent className="flex items-start gap-4 py-4">
          <div className="flex size-9 flex-shrink-0 items-center justify-center text-xl text-amber-700">⚠</div>
          <div className="min-w-0 flex-1 space-y-2">
            <strong className="text-amber-800">Setup incomplete</strong>
            <p className="text-sm text-muted-foreground">
              {failedSteps.length === 1 ? `"${failedSteps[0].label}" didn't finish.` : `${failedSteps.length} steps didn't finish: ${failedSteps.map((s) => s.label).join(", ")}.`}
            </p>
            {err && (
              <div className="mt-2 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</div>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {failedSteps.map((s) => (
                  <Button key={s.key} variant="secondary" size="sm" disabled={busy} onClick={() => retryStep(s.key)}>
                    {busy ? "Retrying…" : `Retry: ${s.label}`}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!job) {
    return canEdit ? (
      <Card className="mb-4 border-l-4 border-l-primary">
        <CardContent className="flex items-center justify-between py-4">
          <strong>Onboarding</strong>
          <Button variant="ghost" size="sm" onClick={rerun} disabled={busy}>
            {busy ? "Starting…" : "Run onboarding"}
          </Button>
        </CardContent>
        {err && (
          <div className="mx-5 mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</div>
        )}
      </Card>
    ) : null;
  }

  const title = running ? "Setting up this client…"
    : job.status === "completed" ? "Onboarding complete"
    : job.status === "completed_with_errors" ? "Onboarding finished with some errors"
    : "Onboarding failed";

  return (
    <Card className="mb-4 border-l-4 border-l-primary">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between gap-2">
          <strong>{running && <span className="mr-1 inline-block size-3 animate-spin rounded-full border-2 border-primary border-t-transparent align-middle" />} {title}</strong>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/clients/${clientId}/setup`}>View setup →</Link>
            </Button>
            {canEdit && !running && (
              <Button variant="ghost" size="sm" onClick={rerun} disabled={busy}>
                {busy ? "Starting…" : "Re-run onboarding"}
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm text-muted-foreground">{done} of {total} steps</span>
        </div>
        {err && (
          <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</div>
        )}
        <ul className="space-y-1.5">
          {job.steps.map((s) => (
            <li key={s.key} className={cn("flex items-center gap-2", s.status === "error" && "text-amber-700")}>
              <span className="size-5 text-center">{STEP_ICON[s.status] ?? "○"}</span>
              <span className="font-medium">{s.label}</span>
              {s.detail && <span className="text-sm text-muted-foreground">— {s.detail}</span>}
              {canEdit && !running && s.status === "error" && (
                <Button variant="ghost" size="sm" onClick={() => retryStep(s.key)} disabled={busy}>Retry</Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type ProfileForm = {
  industry: string; description: string; products_services: string; target_audience: string;
  value_proposition: string; business_objectives: string; communication_tone: string;
  social_media_urls: string; notes: string;
};

function ProfileFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-alt/50 p-3">
      <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium leading-relaxed">{value || "—"}</div>
    </div>
  );
}

function ProfileSection({ label, value, list, links }: { label: string; value?: string; list?: string[]; links?: string[] }) {
  const empty = !value && !list?.length && !links?.length;
  // Detect a numbered list embedded in plain text (e.g. "1. …\n2. …") and
  // render it as a real ordered list instead of one run-on paragraph.
  const numbered = value && /(^|\n)\s*1\.\s/.test(value) && /(^|\n)\s*2\.\s/.test(value)
    ? value.split(/\n(?=\s*\d+\.\s)/).map((s) => s.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean)
    : null;
  return (
    <section className="border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">{label}</h3>
      {empty ? <p className="text-sm text-muted-foreground">—</p>
      : list ? (
        <ul className="ml-4 list-disc space-y-1.5 text-sm leading-relaxed text-foreground/90 marker:text-primary/60">
          {list.map((item, i) => <li key={i} className="pl-1">{item}</li>)}
        </ul>
      )
      : numbered ? (
        <ol className="ml-4 list-decimal space-y-1.5 text-sm leading-relaxed text-foreground/90 marker:font-medium marker:text-primary/70">
          {numbered.map((item, i) => <li key={i} className="pl-1 text-justify hyphens-auto">{item}</li>)}
        </ol>
      )
      : links ? (
        <div className="flex flex-col gap-1">
          {links.map((url, i) => {
            const platform = platformFromUrl(url);
            return (
              <a key={i} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                {platform && <PlatformIcon platform={platform} size={15} />}
                {url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            );
          })}
        </div>
      ) : <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 text-justify hyphens-auto">{value}</p>}
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-3 block">
      <span className="text-sm font-medium">{label}</span>
      <TextareaZoom label={label} rows={1} value={value} onChange={onChange} />
    </label>
  );
}

function Area({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="mb-3 block">
      <span className="text-sm font-medium">{label}</span>
      <TextareaZoom label={label} rows={rows} value={value} onChange={onChange} />
    </label>
  );
}

function Label({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <label className={cn("text-xs font-medium text-muted-foreground", className)} title={title}>{children}</label>;
}

function LogoPreview({ clientId, logoObjectKey }: { clientId: string; logoObjectKey: string }) {
  const src = useProtectedImage(`/clients/${clientId}/logo?v=${logoObjectKey}`, true);
  if (!src) return <p className="text-sm text-muted-foreground">Loading logo…</p>;
  return <img src={src} alt="Client logo" className="max-h-24 object-contain" loading="lazy" />;
}
