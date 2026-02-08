export type LinkStatus = 'verified' | 'unverified' | 'broken';
export type AppMode = 'execution' | 'decision';
export type UserLevel = '3-5y' | '5-10y';

export interface ScoreBreakdown {
  impact: number;
  relevance: number;
  urgency: number;
  credibility: number;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  region?: 'domestic' | 'global';
  published_at: string;
  url: string;
  domain: string;
  link_status: LinkStatus;
  verification_note?: string;
  category_tags: string[];
  top5_theme: string;
  summary_3lines: string | string[];
  checkpoints: string[];
  score_total: number;
  score_breakdown: ScoreBreakdown;
}

export interface BriefData {
  date: string;
  mode: AppMode;
  level: UserLevel;
  takeaways_3: string[];
  items: NewsItem[];
  top5_summary: string[];
  checklist_5: string[];
}
