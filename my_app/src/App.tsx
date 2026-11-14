import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, Database, MessageSquare, Search, Settings } from "lucide-react";
import { AiChat } from "./components/AiChat";
import { DbCsvExplorer } from "./components/DbCsvExplorer";
import { SearchBuilder } from "./components/SearchBuilder";
import { SettingsLogs } from "./components/SettingsLogs";
import { TopBar } from "./components/TopBar";
import { useAppStore } from "./store";
import type {
  ChatToolStreamEvent,
  LiveJobProgressEvent,
  TabId,
} from "./types";

const TABS: { id: TabId; label: string; icon: typeof Search }[] = [
  { id: "search", label: "Search Builder", icon: Search },
  { id: "explorer", label: "DB & CSV Viewer", icon: Database },
  { id: "chat", label: "AI Chat (Groq)", icon: MessageSquare },
  { id: "settings", label: "Settings & Logs", icon: Settings },
];

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export default function App() {
  const { activeTab, setActiveTab, upsertProgress, pushToolEvent } =
    useAppStore();
  const inTauri = isTauriRuntime();

  useEffect(() => {
    if (!inTauri) return;

    const unlistenProgress = listen<LiveJobProgressEvent>(
      "scrape://progress",
      (ev) => {
        upsertProgress(ev.payload);
      },
    );
    const unlistenChat = listen<ChatToolStreamEvent>(
      "chat://tool-event",
      (ev) => {
        pushToolEvent(ev.payload);
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenChat.then((fn) => fn());
    };
  }, [inTauri, upsertProgress, pushToolEvent]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <TopBar />

      {!inTauri && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-5 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            You are viewing the Vite frontend inside a web browser where Tauri
            backend commands (Engine Stop/Start, jobs.db, CSV files, Groq AI) are
            unavailable. Launch the desktop window with{" "}
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono">
              npm run tauri dev
            </code>{" "}
            (or{" "}
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono">
              npm.cmd run tauri dev
            </code>{" "}
            in PowerShell).
          </span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-slate-800 bg-slate-900/40 p-3">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  active
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <main className="flex-1 overflow-auto p-5">
          {activeTab === "search" && <SearchBuilder />}
          {activeTab === "explorer" && <DbCsvExplorer />}
          {activeTab === "chat" && <AiChat />}
          {activeTab === "settings" && <SettingsLogs />}
        </main>
      </div>
    </div>
  );
}
