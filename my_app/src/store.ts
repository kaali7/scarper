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
  selectedJobId: string | null;
  setSelectedJobId: (id: string | null) => void;
  openCsvInViewer: (path: string, errorNote?: string | null) => void;
  clearSelectedCsv: () => void;
  clearSelectedJobError: () => void;

  liveProgress: Record<string, LiveJobProgressEvent>;
  upsertProgress: (ev: LiveJobProgressEvent) => void;
  clearProgress: () => void;

  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (msgs: ChatMessage[]) => void;
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
  selectedJobId: null,
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  openCsvInViewer: (path, errorNote = null) =>
    set({
      selectedCsvPath: path,
      selectedJobError: errorNote || null,
      activeTab: "explorer",
    }),
  clearSelectedCsv: () => set({ selectedCsvPath: null, selectedJobError: null }),
  clearSelectedJobError: () => set({ selectedJobError: null }),

  liveProgress: {},
  upsertProgress: (ev) =>
    set((s) => ({
      liveProgress: { ...s.liveProgress, [ev.jobId]: ev },
    })),
  clearProgress: () => set({ liveProgress: {} }),

  activeChatId: null,
  setActiveChatId: (activeChatId) => set({ activeChatId }),
  chatMessages: [],
  setChatMessages: (chatMessages) => set({ chatMessages, toolStream: [] }),
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  clearChat: () => set({ activeChatId: null, chatMessages: [], toolStream: [] }),

  toolStream: [],
  pushToolEvent: (ev) =>
    set((s) => ({ toolStream: [...s.toolStream.slice(-24), ev] })),
  clearToolStream: () => set({ toolStream: [] }),
}));

