import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Globe,
  ImageIcon,
  Lightbulb,
  Loader2,
  Palette,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertCircle } from "lucide-react";
import type { Client } from "../types";

interface PipelineStep {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  estimate: string;
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "profile",
    title: "Analyzing website & extracting profile",
    description: "Crawls the site and uses AI to infer industry, audience, products, and tone.",
    icon: <Globe className="h-4 w-4" />,
    estimate: "~1 min",
  },
  {
    key: "branding",
    title: "Recovering logo & profile photo",
    description: "Finds the brand mark, profile photo, and extracts a brand color palette.",
    icon: <ImageIcon className="h-4 w-4" />,
    estimate: "<1 min",
  },
  {
    key: "brand_memory",
    title: "Generating brand memory",
    description: "Builds a persistent context the editorial + visual agents will reference for every campaign.",
    icon: <Palette className="h-4 w-4" />,
    estimate: "~30 s",
  },
  {
    key: "competitors",
    title: "Researching competitors",
    description: "Identifies 3–5 main competitors and pulls their positioning for context.",
    icon: <Search className="h-4 w-4" />,
    estimate: "~1 min",
  },
  {
    key: "articles",
    title: "Importing articles",
    description: "Discovers the company blog (WordPress API preferred, site crawl as fallback) and indexes the last ~50 posts.",
    icon: <Lightbulb className="h-4 w-4" />,
    estimate: "~1 min",
  },
];

export default function NewClient() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = name.trim().length > 0 && /^https?:\/\/.+/.test(url.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError("");
    setBusy(true);
    try {
      const client = await api<Client>("/clients", {
        method: "POST",
        body: { company_name: name.trim(), website_url: url.trim(), notes: notes.trim() },
      });
      toast.success(`Created ${client.company_name} — onboarding started`);
      navigate(`/clients/${client.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create client";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to clients">
          <Link to="/clients">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
          <p className="text-sm text-muted-foreground">
            Add a client to start the onboarding pipeline.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[5fr_4fr]">
        {/* Left column — inputs */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company details</CardTitle>
              <CardDescription>
                The minimum we need to start. Industry, brand, and audience are
                filled in automatically by the pipeline — you can review them on
                the next page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="name">
                  Company name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Inc."
                  required
                  autoFocus
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="url">
                  Website URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="url"
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  We start the pipeline by crawling this site. Make sure it's the
                  public marketing site (not a login page).
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="notes">Internal notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Anything we should know — e.g. 'main competitor is BrandX', 'sarah owns the relationship'…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Visible to your team only. Not used by the AI pipeline.
                </p>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link to="/clients">Cancel</Link>
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Create & start onboarding
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right column — what happens next preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What happens next</CardTitle>
              <CardDescription>
                5 steps run automatically in the background. You can leave this
                page; we'll route you to live progress when you come back.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {PIPELINE_STEPS.map((step, i) => (
                <div key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center pt-0.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
                      {step.icon}
                    </div>
                    {i < PIPELINE_STEPS.length - 1 && (
                      <div className="mt-1 h-full w-px bg-border flex-1" />
                    )}
                  </div>
                  <div className="pb-3 flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{step.title}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                        {step.estimate}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}

              <Separator />

              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-muted-foreground leading-relaxed">
                  Total estimated time: <span className="font-medium text-foreground">~3–5 minutes</span>.
                  Onboarding runs in the background — you can navigate away and
                  come back; the client page polls for live progress.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">After onboarding</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <CircleDashed className="h-4 w-4 shrink-0 mt-0.5 text-border" />
                  Review the extracted profile and edit anything wrong.
                </li>
                <li className="flex gap-2">
                  <CircleDashed className="h-4 w-4 shrink-0 mt-0.5 text-border" />
                  Connect social channels to publish campaigns.
                </li>
                <li className="flex gap-2">
                  <CircleDashed className="h-4 w-4 shrink-0 mt-0.5 text-border" />
                  Create your first campaign — pick a concept and let the
                  Editorial + Visual agents draft it.
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
