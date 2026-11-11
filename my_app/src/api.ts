import { invoke } from "@tauri-apps/api/core";
import type {
  ChatResponse,
  CityMatch,
  CsvFileEntry,
  CsvFilterOptions,
  CsvTableData,
  DbJobEntry,
  EngineStatus,
  KitEnv,
  ScrapeRequest,
  ScrapeRunResult,
  SettingsSummary,
} from "./types";

export const api = {
  getSettings: () => invoke<SettingsSummary>("get_settings"),

  saveDesktopSettings: (params: {
    kitRoot: string;
    pythonOverride: string | null;
    groqModel: string;
    kitEnv?: KitEnv;
  }) => invoke<SettingsSummary>("save_desktop_settings", params),

  setGroqApiKey: (apiKey: string) =>
    invoke<string>("set_groq_api_key", { apiKey }),

  clearGroqApiKey: () => invoke<void>("clear_groq_api_key"),

  testGroqConnection: () => invoke<string[]>("test_groq_connection"),

  getEngineStatus: () => invoke<EngineStatus>("get_engine_status"),

  startEngine: () => invoke<EngineStatus>("start_engine"),

  stopEngine: () => invoke<EngineStatus>("stop_engine"),

  restartEngine: () => invoke<EngineStatus>("restart_engine"),

  readEngineLogs: (maxLines = 200) =>
    invoke<string>("read_engine_logs", { maxLines }),

  listDbJobs: () => invoke<DbJobEntry[]>("list_db_jobs"),

  deleteDbJob: (jobId: string) => invoke<void>("delete_db_job", { jobId }),

  listCsvFiles: () => invoke<CsvFileEntry[]>("list_csv_files"),

  readCsvTable: (path: string, options?: CsvFilterOptions) =>
    invoke<CsvTableData>("read_csv_table", { path, options }),

  exportCsvFile: (
    sourcePath: string,
    destPath: string,
    options?: CsvFilterOptions,
  ) => invoke<number>("export_csv_file", { sourcePath, destPath, options }),

  listBusinessTypes: () => invoke<string[]>("list_business_types"),

  lookupCity: (query: string) => invoke<CityMatch[]>("lookup_city", { query }),

  startScrapeJob: (request: ScrapeRequest, waitForCompletion = true) =>
    invoke<ScrapeRunResult>("start_scrape_job", {
      request,
      waitForCompletion,
    }),

  chatWithGroq: (messages: { role: "user" | "assistant"; content: string }[]) =>
    invoke<ChatResponse>("chat_with_groq", { messages }),
};

