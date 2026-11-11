import { create } from "zustand";
import type {
  ChatMessage,
  ChatToolStreamEvent,
  LiveJobProgressEvent,
  TabId,
} from "./types";

interface AppStore {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  selectedCsvPath: string | null;
  selectedJobError: string | null;
  openCsvInViewer: (path: string, errorNote?: string | null) => void;

  liveProgress: Record<string, LiveJobProgressEvent>;
  upsertProgress: (ev: LiveJobProgressEvent) => void;
  clearProgress: () => void;

  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;

  toolStream: ChatToolStreamEvent[];
  pushToolEvent: (ev: ChatToolStreamEvent) => void;
  clearToolStream: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  activeTab: "search",
  setActiveTab: (activeTab) => set({ activeTab }),

  selectedCsvPath: null,
  selectedJobError: null,
  openCsvInViewer: (path, errorNote = null) =>
    set({
      selectedCsvPath: path,
      selectedJobError: errorNote || null,
      activeTab: "explorer",
    }),

  liveProgress: {},
  upsertProgress: (ev) =>
    set((s) => ({
      liveProgress: { ...s.liveProgress, [ev.jobId]: ev },
    })),
  clearProgress: () => set({ liveProgress: {} }),

  chatMessages: [],
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [], toolStream: [] }),

  toolStream: [],
  pushToolEvent: (ev) =>
    set((s) => ({ toolStream: [...s.toolStream.slice(-24), ev] })),
  clearToolStream: () => set({ toolStream: [] }),
}));

