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
  last_extraction_at: string | null;
  created_at: string;
  updated_at: string;
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
