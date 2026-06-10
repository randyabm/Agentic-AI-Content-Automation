export type Role = "admin" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Client {
  id: string;
  company_name: string;
  website_url: string;
  industry: string;
  description: string;
  products_services: string;
  target_audience: string;
  value_proposition: string;
  business_objectives: string[];
  communication_tone: string;
  social_media_urls: string[];
  logo_object_key: string;
  notes: string;
  brand_tone: string;
  brand_words_required: string[];
  brand_words_forbidden: string[];
  brand_colors: string[];
  brand_visual_style: string;
  brand_copy_examples: string[];
  brand_legal_disclaimer: string;
  last_extraction_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandMemory {
  brand_tone: string;
  brand_words_required: string[];
  brand_words_forbidden: string[];
  brand_colors: string[];
  brand_visual_style: string;
  brand_copy_examples: string[];
  brand_legal_disclaimer: string;
}

export type JobStatus =
  | "pending"
  | "crawling"
  | "extracting"
  | "awaiting_review"
  | "completed"
  | "failed";

export interface ExtractionDraft {
  company_name: string;
  industry: string;
  description: string;
  products_services: string;
  target_audience: string;
  value_proposition: string;
  business_objectives: string[];
  communication_tone: string;
  social_media_urls: string[];
}

export interface ExtractionJob {
  id: string;
  client_id: string;
  status: JobStatus;
  pages_crawled: number;
  pages_total_estimate: number;
  error: string;
  draft: Partial<ExtractionDraft>;
  created_at: string;
  updated_at: string;
}

export type AnalysisStatus =
  | "pending"
  | "crawling"
  | "extracting"
  | "comparing"
  | "completed"
  | "failed";

export interface Competitor {
  id: string;
  client_id: string;
  company_name: string;
  website_url: string;
  source: "auto" | "manual";
  identification_reason: string;
  industry: string;
  description: string;
  products_services: string;
  target_audience: string;
  value_proposition: string;
  business_objectives: string[];
  communication_tone: string;
  social_media_urls: string[];
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  analysis_status: AnalysisStatus;
  analysis_error: string;
  pages_crawled: number;
  analyzed_at: string | null;
  created_at: string;
}

export interface CompetitorSearchJob {
  id: string;
  client_id: string;
  status: "pending" | "identifying" | "completed" | "failed";
  num_competitors: number;
  competitor_type: string;
  geographic_scope: string;
  identified: { company_name: string; website_url: string; reason: string }[];
  error: string;
  created_at: string;
  updated_at: string;
}

export type ArticleEntryType = "auto" | "manual";
export type ArticleStatus = "active" | "archived";
export type SyncFrequency = "daily" | "weekly" | "on_demand";

export interface Article {
  id: string;
  title: string;
  author: string;
  publication_date: string | null;
  source_url: string;
  summary: string;
  body: string;
  tags: string[];
  entry_type: ArticleEntryType;
  status: ArticleStatus;
  needs_review: boolean;
  source_id: string | null;
  last_used_in_campaign: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleListItem {
  id: string;
  title: string;
  author: string;
  publication_date: string | null;
  source_url: string;
  summary: string;
  tags: string[];
  entry_type: ArticleEntryType;
  status: ArticleStatus;
  needs_review: boolean;
  created_at: string;
}

export interface ArticleSource {
  id: string;
  name: string;
  url: string;
  frequency: SyncFrequency;
  max_articles_per_sync: number;
  auto_publish: boolean;
  duplicate_detection: boolean;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string;
  last_sync_detail: string;
  created_at: string;
}

export interface LLMConfig {
  id: string;
  function: string;
  provider: string;
  model_name: string;
  api_key_hint: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  is_active: boolean;
  updated_at: string;
}

export interface ImageModel {
  id: string;
  display_name: string;
  provider: string;
  model_name: string;
  api_key_hint: string;
  is_default: boolean;
  is_active: boolean;
  updated_at: string;
}

export interface Setting {
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

export interface VideoModel {
  id: string;
  display_name: string;
  provider: string;
  model_name: string;
  api_key_hint: string;
  max_duration_seconds: number;
  is_default: boolean;
  is_active: boolean;
  updated_at: string;
}

// --- Campaigns (Module 3) ---

export type CampaignPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "x"
  | "youtube";

export type CampaignObjective =
  | "awareness"
  | "consideration"
  | "conversion"
  | "retention"
  | "launch"
  | "promotion";

export type VisualFormat = "static_image" | "carousel";
export type CampaignStatus = "draft" | "generating" | "ready" | "failed";
export type PostStatus = "pending" | "generating" | "ready" | "failed";

export interface PlatformSpec {
  platform: CampaignPlatform;
  label: string;
  char_limit: number;
  aspect_ratios: string[];
  formats: VisualFormat[];
}

export interface PlatformConfig {
  id: string;
  platform: CampaignPlatform;
  is_active: boolean;
  num_posts: number;
  images_per_post: number;
  visual_format: VisualFormat;
  carousel_slides: number;
  tone: string;
  include_cta: boolean;
  cta_text: string;
  hashtag_count: number;
  hashtag_mix: { branded: number; trending: number; niche: number };
  emojis: string;
}

export interface PromptVersion {
  prompt: string;
  negative_prompt: string;
  created_at: string;
}

export interface GenerationVersion {
  object_key: string;
  prompt: string;
  created_at: string;
}

export interface LayerGeom {
  asset_id?: string;
  x: number;
  y: number;
  scale: number;
  rotation?: number;
  opacity: number;
  z?: number;
  locked?: boolean;
  visible?: boolean;
}

export interface CanvasState {
  logo?: LayerGeom;
  assets?: LayerGeom[];
}

export interface PostImage {
  id: string;
  post_id: string;
  slot_index: number;
  aspect_ratio: string;
  prompt: string;
  negative_prompt: string;
  additional_guidance: string;
  prompt_history: PromptVersion[];
  image_model_id: string | null;
  base_object_key: string;
  is_uploaded: boolean;
  generation_history: GenerationVersion[];
  canvas_state: CanvasState;
  composited_object_key: string;
}

export type VideoStatus = "draft" | "generating" | "ready" | "failed";

export interface PostVideo {
  id: string;
  post_id: string;
  aspect_ratio: string;
  duration_seconds: number;
  prompt: string;
  negative_prompt: string;
  prompt_history: PromptVersion[];
  video_model_id: string | null;
  base_object_key: string;
  is_uploaded: boolean;
  generation_history: GenerationVersion[];
  status: VideoStatus;
  error: string;
}

export interface Post {
  id: string;
  campaign_id: string;
  platform: CampaignPlatform;
  position: number;
  headline: string;
  copy: string;
  cta: string;
  hashtags: string[];
  best_time: string;
  rationale: string;
  status: PostStatus;
  images: PostImage[];
  videos: PostVideo[];
}

export interface PostAsset {
  id: string;
  campaign_id: string;
  object_key: string;
  filename: string;
  content_type: string;
}

export interface Campaign {
  id: string;
  client_id: string;
  name: string;
  objective: CampaignObjective;
  central_theme: string;
  content_language: string;
  creativity_level: number;
  start_date: string | null;
  end_date: string | null;
  article_id: string | null;
  article_url: string;
  status: CampaignStatus;
  error: string;
  created_at: string;
  updated_at: string;
  platforms: PlatformConfig[];
}

export interface CampaignDetail extends Campaign {
  posts: Post[];
}

export interface CampaignListItem {
  id: string;
  client_id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}
