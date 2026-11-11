import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { Database, MessageSquare, Search, Settings } from "lucide-react";
import { api } from "./api";
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

export default function App() {
  const qc = useQueryClient();
  const { activeTab, setActiveTab, upsertProgress, pushToolEvent } =
    useAppStore();

  useEffect(() => {
    // Auto-start engine quietly if stopped and Python + Chrome are available.
    api
      .getEngineStatus()
      .then((st) => {
        if (!st.running && !st.foreignPortBusy && st.python) {
          return api.startEngine().then((next) => {
            qc.setQueryData(["engine-status"], next);
          });
        }
        return undefined;
      })
      .catch(() => {});

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
  }, [qc, upsertProgress, pushToolEvent]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <TopBar />

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
