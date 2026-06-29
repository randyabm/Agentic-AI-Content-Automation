import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Cog,
  Edit,
  FileText,
  Globe,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  Rocket,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  User as UserIcon,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AuditLog } from "../types";

/** Map an audit `action` string to an icon + label + tone.
 *  Falls back to a generic "activity" entry for unknown actions. */
const ACTION_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  // Auth
  "auth.login": { label: "Signed in", icon: UserIcon, tone: "text-muted-foreground" },
  "auth.password_reset": { label: "Reset password", icon: Mail, tone: "text-muted-foreground" },

  // Client
  "client.create": { label: "Client created", icon: Sparkles, tone: "text-indigo-600 dark:text-indigo-400" },
  "client.update": { label: "Edited client", icon: Edit, tone: "text-muted-foreground" },
  "client.delete": { label: "Deleted client", icon: Trash2, tone: "text-destructive" },
  "client.logo_upload": { label: "Uploaded logo", icon: Upload, tone: "text-muted-foreground" },
  "client.avatar_upload": { label: "Uploaded profile photo", icon: Upload, tone: "text-muted-foreground" },
  "client.brand_memory_update": { label: "Updated brand memory", icon: Pencil, tone: "text-muted-foreground" },
  "client.onboard": { label: "Started onboarding", icon: Rocket, tone: "text-indigo-600 dark:text-indigo-400" },
  "client.onboard_step": { label: "Re-ran onboarding step", icon: Rocket, tone: "text-muted-foreground" },
  "client.analyze": { label: "Started extraction", icon: Bot, tone: "text-muted-foreground" },
  "client.extraction_confirm": { label: "Confirmed extracted profile", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
  "client.import_articles": { label: "Triggered article import", icon: FileText, tone: "text-muted-foreground" },
  "client.import_article_url": { label: "Imported article", icon: FileText, tone: "text-muted-foreground" },

  // Campaign
  "campaign.create": { label: "Created campaign", icon: Sparkles, tone: "text-indigo-600 dark:text-indigo-400" },
  "campaign.submit_for_approval": { label: "Sent campaign for approval", icon: Send, tone: "text-amber-600 dark:text-amber-400" },
  "campaign.approve": { label: "Approved campaign", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  "campaign.request_changes": { label: "Requested changes", icon: MessageSquare, tone: "text-amber-600 dark:text-amber-400" },
  "campaign.reject": { label: "Rejected campaign", icon: XCircle, tone: "text-destructive" },
  "campaign.delete": { label: "Deleted campaign", icon: Trash2, tone: "text-destructive" },
  "campaign.autopilot_commit": { label: "AI auto-scheduled", icon: Bot, tone: "text-indigo-600 dark:text-indigo-400" },
  "campaign.image_generate": { label: "Generated image", icon: ImageIcon, tone: "text-muted-foreground" },
  "campaign.video_generate": { label: "Generated video", icon: ImageIcon, tone: "text-muted-foreground" },
  "campaign.video_derive": { label: "Derived video ratios", icon: ImageIcon, tone: "text-muted-foreground" },
  "campaign.reference_upload": { label: "Uploaded reference image", icon: Upload, tone: "text-muted-foreground" },
  "campaign.export": { label: "Exported campaign", icon: FileText, tone: "text-muted-foreground" },

  // Post
  "post.submit": { label: "Sent post for review", icon: Send, tone: "text-amber-600 dark:text-amber-400" },
  "post.approve": { label: "Approved post", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  "post.reject": { label: "Rejected post", icon: XCircle, tone: "text-destructive" },
  "post.publish": { label: "Published post", icon: Rocket, tone: "text-emerald-600 dark:text-emerald-400" },
  "post.reschedule": { label: "Rescheduled post", icon: Cog, tone: "text-muted-foreground" },
  "post.unschedule": { label: "Cancelled scheduled post", icon: XCircle, tone: "text-muted-foreground" },
  "post.retry": { label: "Retried failed post", icon: Play, tone: "text-muted-foreground" },

  // Competitor
  "competitor.create": { label: "Added competitor", icon: UserIcon, tone: "text-muted-foreground" },
  "competitor.search": { label: "Started competitor search", icon: Search, tone: "text-muted-foreground" },
  "competitor.analyze": { label: "Analyzed competitor", icon: Bot, tone: "text-muted-foreground" },
  "competitor.update": { label: "Edited competitor", icon: Edit, tone: "text-muted-foreground" },
  "competitor.delete": { label: "Removed competitor", icon: Trash2, tone: "text-destructive" },

  // Channel
  "channel.connect_start": { label: "Started channel connection", icon: Globe, tone: "text-muted-foreground" },
  "channel.disconnect": { label: "Disconnected channel", icon: XCircle, tone: "text-muted-foreground" },

  // Article
  "article.add_url": { label: "Imported article", icon: FileText, tone: "text-muted-foreground" },
  "article.add_text": { label: "Imported article (text)", icon: FileText, tone: "text-muted-foreground" },
  "article.update": { label: "Edited article", icon: Edit, tone: "text-muted-foreground" },
  "article.approve": { label: "Approved article", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
  "article.archive": { label: "Archived article", icon: Trash2, tone: "text-muted-foreground" },
  "article.delete": { label: "Deleted article", icon: Trash2, tone: "text-destructive" },
  "article_source.create": { label: "Added article source", icon: Tag, tone: "text-muted-foreground" },
  "article_source.update": { label: "Edited article source", icon: Edit, tone: "text-muted-foreground" },
  "article_source.delete": { label: "Removed article source", icon: Trash2, tone: "text-destructive" },
  "article_source.sync": { label: "Synced article source", icon: Rocket, tone: "text-muted-foreground" },
};

function metaFor(action: string) {
  return ACTION_META[action] ?? {
    label: action,
    icon: Activity,
    tone: "text-muted-foreground",
  };
}

function relativeTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 30) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return t.toLocaleDateString();
}

function describeDetail(action: string, detail: Record<string, unknown>): string | null {
  if (!detail || Object.keys(detail).length === 0) return null;
  switch (action) {
    case "campaign.submit_for_approval":
      if (detail.scope === "full_campaign") return "Full campaign";
      if (detail.scope === "individual_posts") {
        const n = Array.isArray(detail.post_ids) ? detail.post_ids.length : 0;
        return `${n} post${n === 1 ? "" : "s"}`;
      }
      return null;
    case "client.onboard_step":
      return detail.step ? `Step: ${detail.step}` : null;
    case "campaign.image_generate":
    case "campaign.video_generate":
    case "campaign.video_derive":
    case "campaign.reference_upload":
      return null;
    case "post.publish":
      if (detail.channel) return `Channel: ${detail.channel}`;
      return null;
    case "client.import_articles":
      if (detail.from_date && detail.to_date) {
        return `${detail.from_date} → ${detail.to_date}`;
      }
      return null;
    case "channel.connect_start":
      if (detail.platform) return `Platform: ${detail.platform}`;
      return null;
    case "channel.disconnect":
      if (detail.channel_id) return `Channel: ${String(detail.channel_id).slice(0, 8)}…`;
      return null;
    default:
      // Generic: pick the first scalar field, if any.
      const first = Object.values(detail).find((v) => typeof v === "string" || typeof v === "number");
      return first != null ? String(first) : null;
  }
}

interface ActivityTimelineProps {
  events: AuditLog[];
  emptyText?: string;
  initialLimit?: number;
  showActor?: boolean;
}

export function ActivityTimeline({
  events,
  emptyText = "No activity yet.",
  initialLimit = 8,
  showActor = true,
}: ActivityTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, initialLimit);
  const hidden = Math.max(0, events.length - initialLimit);

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        <CircleDashed className="h-4 w-4 shrink-0" />
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1">
        {visible.map((e, i) => {
          const meta = metaFor(e.action);
          const Icon = meta.icon;
          const sub = describeDetail(e.action, e.detail);
          const isLast = i === visible.length - 1;
          return (
            <li key={e.id} className="flex gap-3 group">
              <div className="flex flex-col items-center pt-1">
                <div className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-card bg-muted",
                  meta.tone,
                )}>
                  <Icon className="h-3 w-3" />
                </div>
                {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-1" />}
              </div>
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium leading-tight">{meta.label}</span>
                  {sub && (
                    <Badge variant="outline" className="font-normal text-[10px] py-0">
                      {sub}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  {showActor && e.user_email && <span>{e.user_email}</span>}
                  {showActor && e.user_email && <span aria-hidden>·</span>}
                  <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()}>
                    {relativeTime(e.created_at)}
                  </time>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Show less" : `Show ${hidden} more`}
        </Button>
      )}
    </div>
  );
}
