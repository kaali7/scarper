import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  History,
  KeyRound,
  Loader2,
  MessageSquarePlus,
  Send,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { api, formatError } from "../api";
import { useAppStore } from "../store";
import type { ChatMessage, ChatSession } from "../types";

const STARTER_PROMPTS = [
  "Search coffee shops and dress shops in Navi Mumbai and Thane, India. Only phone number not email. Give me name and phone number.",
  "Show my recent jobs in jobs.db and saved CSV files.",
  "Filter navi-mumbai-thane-leads.csv to show the first 10 businesses.",
];

function deriveSessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user")?.content.trim() ?? "";
  if (!firstUser) return "New Chat";
  return firstUser.length > 42 ? `${firstUser.slice(0, 42)}…` : firstUser;
}

function formatSessionDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AiChat() {
  const qc = useQueryClient();
  const {
    activeChatId,
    setActiveChatId,
    chatMessages,
    setChatMessages,
    addChatMessage,
    clearChat,
    toolStream,
    clearToolStream,
    openCsvInViewer,
    setActiveTab,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>(
    {},
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });

  const { data: savedSessions = [] } = useQuery({
    queryKey: ["chat-history"],
    queryFn: async () => {
      try {
        return await api.loadChatHistory();
      } catch {
        return [];
      }
    },
  });

  useEffect(() => {
    if (hydratedRef.current || savedSessions.length === 0) return;
    hydratedRef.current = true;
    const state = useAppStore.getState();
    if (!state.activeChatId && state.chatMessages.length === 0) {
      const latest = savedSessions[0];
      setActiveChatId(latest.id);
      setChatMessages(latest.messages);
    }
  }, [savedSessions, setActiveChatId, setChatMessages]);

  const persistSession = (sessionId: string, messages: ChatMessage[]) => {
    const prev = qc.getQueryData<ChatSession[]>(["chat-history"]) ?? savedSessions;
    const without = prev.filter((s) => s.id !== sessionId);
    const next =
      messages.length > 0
        ? [
            {
              id: sessionId,
              title: deriveSessionTitle(messages),
              updatedAt: Date.now(),
              messages,
            },
            ...without,
          ]
        : without;
    qc.setQueryData(["chat-history"], next);
    api.saveChatHistory(next).catch(() => {});
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, toolStream]);

  const sendMut = useMutation({
    mutationFn: async (prompt: string) => {
      const state = useAppStore.getState();
      const sessionId = state.activeChatId ?? crypto.randomUUID();
      if (!state.activeChatId) {
        setActiveChatId(sessionId);
      }
      const prior = state.chatMessages;
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        createdAt: Date.now(),
      };
      addChatMessage(userMsg);
      persistSession(sessionId, [...prior, userMsg]);
      clearToolStream();

      const history = [...prior, userMsg]
        .filter((m) => !(m.role === "assistant" && m.content.startsWith("Error:")))
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));
      const res = await api.chatWithGroq(history);
      return { res, sessionId };
    },
    onSuccess: ({ res, sessionId }) => {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.assistantMessage,
        toolTraces: res.toolTraces,
        artifacts: res.artifacts,
        createdAt: Date.now(),
      };
      addChatMessage(assistantMsg);
      persistSession(sessionId, useAppStore.getState().chatMessages);
      clearToolStream();
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
    onError: (err) => {
      const state = useAppStore.getState();
      const sessionId = state.activeChatId;
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${formatError(err) || "Request failed"}`,
        createdAt: Date.now(),
      };
      addChatMessage(errMsg);
      if (sessionId) {
        persistSession(sessionId, useAppStore.getState().chatMessages);
      }
      clearToolStream();
    },
  });

  const handleNewChat = () => {
    if (sendMut.isPending) return;
    hydratedRef.current = true;
    clearChat();
    setActiveChatId(crypto.randomUUID());
  };

  const handleSelectSession = (session: ChatSession) => {
    if (sendMut.isPending) return;
    hydratedRef.current = true;
    setActiveChatId(session.id);
    setChatMessages(session.messages);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (sendMut.isPending) return;
    hydratedRef.current = true;
    const next = savedSessions.filter((s) => s.id !== sessionId);
    qc.setQueryData(["chat-history"], next);
    api.saveChatHistory(next).catch(() => {});
    if (activeChatId === sessionId) {
      clearChat();
    }
  };

  const handleClearActive = () => {
    if (sendMut.isPending) return;
    hydratedRef.current = true;
    if (activeChatId) {
      persistSession(activeChatId, []);
    }
    clearChat();
  };

  const submitPrompt = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || sendMut.isPending) return;
    if (!text) setInput("");
    sendMut.mutate(q);
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-3 overflow-hidden">
      {showHistory && (
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Chat History ({savedSessions.length})
            </span>
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
              title="Start a fresh conversation"
            >
              <MessageSquarePlus className="h-3 w-3" />
              New Chat
            </button>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {savedSessions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 p-3 text-center text-[11px] text-slate-500">
                Your conversations will be saved here automatically.
              </p>
            ) : (
              savedSessions.map((session) => {
                const isActive = activeChatId === session.id;
                return (
                  <div
                    key={session.id}
                    className={`group flex items-start justify-between gap-1.5 rounded-lg border p-2 transition ${
                      isActive
                        ? "border-emerald-500/70 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSession(session)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-xs font-medium text-slate-100">
                        {session.title}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        {session.messages.length} msgs ·{" "}
                        {formatSessionDate(session.updatedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(session.id)}
                      className="rounded p-1 text-slate-500 opacity-70 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                      aria-label={`Delete chat ${session.title}`}
                      title="Delete conversation"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
              aria-label="Toggle chat history"
              title={showHistory ? "Hide chat history" : "Show chat history"}
            >
              <History className="h-3.5 w-3.5" />
            </button>
            <Bot className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Groq AI Assistant
            </h2>
            {settings && (
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                {settings.config.groqModel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!showHistory && (
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                New Chat
              </button>
            )}
            <button
              type="button"
              onClick={handleClearActive}
              className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>

      {settings && !settings.hasGroqKey && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Add your Groq API key in Settings to use AI tool-calling chat.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className="rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-500"
          >
            Go to Settings
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {chatMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Bot className="h-10 w-10 text-emerald-400/70" />
            <div>
              <h3 className="text-sm font-semibold text-slate-200">
                Ask in plain English to search, inspect jobs.db, or filter CSVs
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Groq automatically calls the scraper engine, geocoder, and CSV
                tools for you.
              </p>
            </div>
            <div className="grid max-w-2xl gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submitPrompt(p)}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-left text-xs text-slate-300 transition hover:border-emerald-500/50 hover:text-white"
                >
                  "{p}"
                </button>
              ))}
            </div>
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "assistant" && (
                <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                  <Bot className="h-4 w-4" />
                </span>
              )}

              <div
                className={`max-w-[85%] space-y-2.5 rounded-xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-emerald-600/20 text-slate-100 border border-emerald-500/30"
                    : "bg-slate-950/70 text-slate-200 border border-slate-800"
                }`}
              >
                {msg.toolTraces && msg.toolTraces.length > 0 && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTools((prev) => ({
                          ...prev,
                          [msg.id]: !prev[msg.id],
                        }))
                      }
                      className="flex w-full items-center justify-between text-slate-300"
                    >
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                        Used {msg.toolTraces.length} tool step(s)
                      </span>
                      {expandedTools[msg.id] ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {expandedTools[msg.id] && (
                      <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                        {msg.toolTraces.map((t, i) => (
                          <li
                            key={i}
                            className="flex items-start justify-between gap-2 text-[11px]"
                          >
                            <span className="font-mono text-emerald-300">
                              {t.toolName}
                            </span>
                            <span
                              className={
                                t.ok ? "text-slate-400" : "text-rose-300"
                              }
                            >
                              {t.summary}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="prose prose-sm prose-invert max-w-none break-words [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-900 [&_th]:px-2 [&_th]:py-1">
                  <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                </div>

                {msg.artifacts && msg.artifacts.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {msg.artifacts.map((art, i) => (
                      <button
                        key={`${art.path}-${i}`}
                        type="button"
                        onClick={() => openCsvInViewer(art.path)}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Open {art.name} ({art.rowCount} rows)
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
                  <User className="h-4 w-4" />
                </span>
              )}
            </div>
          ))
        )}

        {sendMut.isPending && (
          <div className="flex items-start gap-3">
            <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-300">
              <div className="font-medium text-emerald-300">
                Thinking & executing tools…
              </div>
              {toolStream.map((ev, i) => (
                <div key={i} className="font-mono text-[11px] text-slate-400">
                  [{ev.status}] {ev.toolName}: {ev.detail}
                </div>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 p-3">
        <div className="flex gap-2">
          <label htmlFor="ai-chat-prompt-input" className="sr-only">
            Chat Prompt
          </label>
          <textarea
            id="ai-chat-prompt-input"
            name="ai-chat-prompt-input"
            aria-label="Chat Prompt"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
              }
            }}
            placeholder="Type what you want to search or inspect…"
            className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={sendMut.isPending || !input.trim()}
            onClick={() => submitPrompt()}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {sendMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  </div>
  );
}

