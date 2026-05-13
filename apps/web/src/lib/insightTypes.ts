export interface RunInsight {
  id: string;
  rawContentId: string;
  analysisRunId?: string;
  problemStatement: string;
  userIntent: string;
  audienceSegment: string;
  needType: string;
  painPoints: string[];
  desiredOutcome: string;
  sentiment: string;
  confidence: number;
  evidence: InsightEvidence[];
  recommendedAction: string;
  engagementScore: number;
  modelName: string;
  batchIndex?: number;
  selectionReasons?: string[];
  createdAt: string;
  source?: {
    text: string;
    url: string;
    authorName?: string;
    authorHandle?: string;
    mediaUrls?: string[] | null;
    metricsJson: Record<string, unknown> | null;
    publishedAt?: string;
  };
}

export interface RunInsightsSummary {
  totalContents: number;
  totalInsights: number;
  totalEngagement: number;
  uniqueAuthors: number;
  dataCompleteness: number;
  themes: InsightTheme[];
  opportunityTypes: SummaryBucket[];
  topDemandSignals: SummaryBucket[];
  topSubreddits: SummaryBucket[];
  recommendedNextActions: string[];
  dataLimitations: string[];
}

export interface InsightEvidence {
  source: "post_body" | "comment" | "title" | "media_context";
  rawContentId: string;
  quote: string;
  url: string;
  commentAuthor?: string;
}

export interface InsightTheme {
  themeName: string;
  whyItMatters: string;
  opportunityType: string;
  demandSignals: string[];
  contentIdeas: string[];
  productServiceIdeas: string[];
  representativePostIds: string[];
  riskOrLimitations: string[];
}

export interface SummaryBucket {
  key: string;
  label?: string;
  count: number;
}

export interface RunInsightsResponse {
  summary: RunInsightsSummary;
  items: RunInsight[];
  page: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface AiInsightRunDiagnostics {
  id: string;
  analysisRunId: string;
  status: "selecting" | "extracting" | "summarizing" | "completed" | "failed" | string;
  totalRawCount: number;
  eligibleCount: number;
  selectedCandidateCount: number;
  excludedCandidateCount: number;
  batchCount: number;
  outputInsightCount: number;
  modelName: string;
  configSnapshot: Record<string, number | string | boolean | null>;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiInsightCandidate {
  id: string;
  aiInsightRunId: string;
  analysisRunId: string;
  rawContentId: string;
  selected: boolean;
  selectionScore: number;
  selectionReasons: string[];
  excludedReason?: string;
  batchIndex?: number;
  inputTextPreview: string;
  createdAt: string;
}

export interface AiInsightBatch {
  id: string;
  aiInsightRunId: string;
  analysisRunId: string;
  batchIndex: number;
  status: "pending" | "running" | "completed" | "failed" | string;
  rawContentIds: string[];
  candidateCount: number;
  outputInsightCount: number;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
