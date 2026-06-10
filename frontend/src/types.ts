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
