export type TabId = "search" | "explorer" | "chat" | "settings";

export interface PythonInfo {
  executable: string;
  version: string;
}

export interface EngineStatus {
  running: boolean;
  managedByApp: boolean;
  foreignPortBusy: boolean;
  port: number;
  url: string;
  engineVersion: string | null;
  python: PythonInfo | null;
  chromePath: string | null;
}

export interface DesktopConfig {
  kitRoot: string;
  pythonOverride: string | null;
  groqModel: string;
}

export interface KitEnv {
  port: number;
  apiKey: string;
  headless: boolean;
  navTimeout: number;
  noUpdateCheck: boolean;
}

export interface SettingsSummary {
  config: DesktopConfig;
  kitEnv: KitEnv;
  hasGroqKey: boolean;
  groqKeyMasked: string;
}

export interface DbJobEntry {
  id: string;
  name: string;
  date: string;
  status: "pending" | "working" | "ok" | "failed" | string;
  error: string;
  keywords: string[];
  depth: number;
  lang: string;
  country: string;
  emailEnabled: boolean;
  socialsEnabled: boolean;
  places: number;
  percent: number;
  stage: string;
  csvPath: string;
  csvExists: boolean;
  csvSizeBytes: number;
}

export interface CsvFileEntry {
  name: string;
  path: string;
  source: "workspace" | "engine_job" | string;
  sizeBytes: number;
  modifiedMs: number;
  rowCount: number;
  jobId: string | null;
  jobStatus: string | null;
}

export interface CsvFilterOptions {
  search?: string;
  hasPhone?: boolean;
  hasEmail?: boolean;
  noWebsite?: boolean;
  minRating?: number;
  columns?: string[];
  maxRows?: number;
}

export interface CsvTableData {
  path: string;
  headers: string[];
  allHeaders: string[];
  rows: string[][];
  totalRows: number;
  filteredRows: number;
}

export interface CityMatch {
  label: string;
  lat: string;
  lon: string;
  country: string;
  source: string;
}

export interface CityInput {
  label: string;
  lat?: string;
  lon?: string;
}

export interface ScrapeRequest {
  keywords: string[];
  cities: CityInput[];
  depth?: number;
  zoom?: number;
  lang?: string;
  country?: string;
  maxTime?: number;
  collectEmails?: boolean;
  collectSocials?: boolean;
  verifyEmails?: boolean;
  browserSites?: boolean;
  reviewsMax?: number;
  proxies?: string[];
  hasPhone?: boolean;
  hasEmail?: boolean;
  noWebsite?: boolean;
  minRating?: number;
  fields?: string[];
  outFilename?: string;
  grid?: number;
  deepScan?: boolean;
  tech?: boolean;
}

export interface ScrapeRunResult {
  jobIds: string[];
  primaryCsvPath: string | null;
  exportedCsvPath: string | null;
  exportedRows: number;
  totalPlaces: number;
  warnings: string[];
}

export interface LiveJobProgressEvent {
  jobId: string;
  cityLabel: string;
  status: string;
  stage: string;
  keywordsDone: number;
  keywordsTotal: number;
  places: number;
  percent: number;
  error: string;
}

export interface ToolTrace {
  toolName: string;
  arguments: unknown;
  summary: string;
  ok: boolean;
}

export interface CsvArtifact {
  path: string;
  name: string;
  rowCount: number;
  columns: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolTraces?: ToolTrace[];
  artifacts?: CsvArtifact[];
  createdAt: number;
}

export interface ChatResponse {
  assistantMessage: string;
  toolTraces: ToolTrace[];
  artifacts: CsvArtifact[];
}

export interface ChatToolStreamEvent {
  status: "calling" | "done" | "error" | string;
  toolName: string;
  detail: string;
}

