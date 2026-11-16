import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { api, formatError } from "../api";

const DEFAULT_GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

export function SettingsLogs() {
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });

  const {
    data: logs = "",
    refetch: refetchLogs,
    isFetching: loadingLogs,
  } = useQuery({
    queryKey: ["engine-logs"],
    queryFn: () => api.readEngineLogs(250),
  });

  const [kitRoot, setKitRoot] = useState("");
  const [pythonOverride, setPythonOverride] = useState("");
  const [groqModel, setGroqModel] = useState("qwen/qwen3.8-27b");
  const [port, setPort] = useState(8080);
  const [navTimeout, setNavTimeout] = useState(90);
  const [headless, setHeadless] = useState(true);
  const [noUpdateCheck, setNoUpdateCheck] = useState(false);

  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    if (!settings) return;
    setKitRoot(settings.config.kitRoot);
    setPythonOverride(settings.config.pythonOverride ?? "");
    setGroqModel(settings.config.groqModel);
    setPort(settings.kitEnv.port);
    setNavTimeout(settings.kitEnv.navTimeout);
    setHeadless(settings.kitEnv.headless);
    setNoUpdateCheck(settings.kitEnv.noUpdateCheck);
  }, [settings]);

  const saveSettingsMut = useMutation({
    mutationFn: async () => {
      if (groqKeyInput.trim()) {
        await api.setGroqApiKey(groqKeyInput.trim());
        setGroqKeyInput("");
      }
      return api.saveDesktopSettings({
        kitRoot,
        pythonOverride: pythonOverride.trim() || null,
        groqModel,
        kitEnv: {
          port,
          apiKey: settings?.kitEnv.apiKey ?? "",
          headless,
          navTimeout,
          noUpdateCheck,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["engine-status"] });
      setStatusMsg(
        "Settings saved. Restart the engine if you changed Port, Headless, or Navigation Timeout.",
      );
    },
  });

  const saveKeyMut = useMutation({
    mutationFn: () => api.setGroqApiKey(groqKeyInput),
    onSuccess: (masked) => {
      setGroqKeyInput("");
      qc.invalidateQueries({ queryKey: ["settings"] });
      setStatusMsg(`Groq API key saved securely in OS Credential Manager (${masked}).`);
    },
  });

  const clearKeyMut = useMutation({
    mutationFn: api.clearGroqApiKey,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setStatusMsg("Groq API key removed.");
    },
  });

  const testGroqMut = useMutation({
    mutationFn: api.testGroqConnection,
    onSuccess: (models) => {
      setAvailableModels(models);
      setStatusMsg(`Groq connection verified (${models.length} models returned).`);
    },
  });

  const pickKitFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setKitRoot(picked);
  };

  const errMsg =
    formatError(saveSettingsMut.error) ||
    formatError(saveKeyMut.error) ||
    formatError(clearKeyMut.error) ||
    formatError(testGroqMut.error);

  const modelOptions = Array.from(
    new Set([...DEFAULT_GROQ_MODELS, ...availableModels, groqModel].filter(Boolean)),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {statusMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errMsg && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {errMsg}
        </div>
      )}

      {/* Groq API Key */}
      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Groq API Configuration
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-400">
            {settings?.hasGroqKey
              ? `Saved: ${settings.groqKeyMasked}`
              : "Not configured"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <label htmlFor="groq-api-key-input" className="sr-only">
            Groq API Key
          </label>
          <input
            id="groq-api-key-input"
            name="groq-api-key-input"
            aria-label="Groq API Key"
            type="password"
            value={groqKeyInput}
            onChange={(e) => setGroqKeyInput(e.target.value)}
            placeholder="Paste your gsk_... Groq API key"
            className="min-w-[260px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={!groqKeyInput.trim() || saveKeyMut.isPending}
            onClick={() => saveKeyMut.mutate()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Save Key
          </button>
          <button
            type="button"
            disabled={!settings?.hasGroqKey || testGroqMut.isPending}
            onClick={() => testGroqMut.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {testGroqMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Test Connection
          </button>
          {settings?.hasGroqKey && (
            <button
              type="button"
              onClick={() => clearKeyMut.mutate()}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/25"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-400">
          Reads your Groq key from Windows Credential Store, local AppData,{" "}
          <code className="text-slate-300">GROQ_API_KEY</code> env var, or{" "}
          <code className="text-slate-300">.env</code> in the scraper kit folder.
        </p>

        <div>
          <label htmlFor="groq-model-select" className="mb-1 block text-xs text-slate-400">
            Groq Tool-Calling Model
          </label>
          <select
            id="groq-model-select"
            name="groq-model-select"
            aria-label="Groq Tool-Calling Model"
            value={groqModel}
            onChange={(e) => setGroqModel(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Engine & Kit Paths */}
      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-semibold text-slate-100">
          Kit Paths & Engine Settings (.env)
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="kit-root-input" className="mb-1 block text-xs text-slate-400">
              Scraper Kit Folder
            </label>
            <div className="flex gap-2">
              <input
                id="kit-root-input"
                name="kit-root-input"
                aria-label="Scraper Kit Folder"
                value={kitRoot}
                onChange={(e) => setKitRoot(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={pickKitFolder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="python-override-input" className="mb-1 block text-xs text-slate-400">
              Python Executable Override (blank = auto-detect)
            </label>
            <input
              id="python-override-input"
              name="python-override-input"
              aria-label="Python Executable Override"
              value={pythonOverride}
              onChange={(e) => setPythonOverride(e.target.value)}
              placeholder="e.g. python"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="engine-port-input" className="mb-1 block text-xs text-slate-400">
              Engine Port (SCRAPER_PORT)
            </label>
            <input
              id="engine-port-input"
              name="engine-port-input"
              aria-label="Engine Port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 8080)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="nav-timeout-input" className="mb-1 block text-xs text-slate-400">
              Page Navigation Timeout, sec (SCRAPER_NAV_TIMEOUT)
            </label>
            <input
              id="nav-timeout-input"
              name="nav-timeout-input"
              aria-label="Page Navigation Timeout"
              type="number"
              min={5}
              max={300}
              value={navTimeout}
              onChange={(e) => setNavTimeout(Number(e.target.value) || 90)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div className="flex flex-col justify-end gap-2">
            <label htmlFor="setting-headless-input" className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                id="setting-headless-input"
                name="setting-headless-input"
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                className="accent-emerald-500"
              />
              Run Chrome Headless (SCRAPER_HEADLESS)
            </label>
            <label htmlFor="setting-noupdate-input" className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                id="setting-noupdate-input"
                name="setting-noupdate-input"
                type="checkbox"
                checked={noUpdateCheck}
                onChange={(e) => setNoUpdateCheck(e.target.checked)}
                className="accent-emerald-500"
              />
              Disable GitHub update check
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={saveSettingsMut.isPending}
            onClick={() => saveSettingsMut.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save Settings
          </button>
        </div>
      </section>

      {/* Live Engine Logs */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            Engine Log (.engine/engine.log)
          </h2>
          <button
            type="button"
            onClick={() => refetchLogs()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {logs || "No engine log entries yet."}
        </pre>
      </section>
    </div>
  );
}

