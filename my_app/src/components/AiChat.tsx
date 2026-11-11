import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Send,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { api } from "../api";
import { useAppStore } from "../store";
import type { ChatMessage } from "../types";

const STARTER_PROMPTS = [
  "Search coffee shops and dress shops in Navi Mumbai and Thane, India. Only phone number not email. Give me name and phone number.",
  "Show my recent jobs in jobs.db and saved CSV files.",
  "Filter navi-mumbai-thane-leads.csv to show the first 10 businesses.",
];

export function AiChat() {
  const qc = useQueryClient();
  const {
    chatMessages,
    addChatMessage,
    clearChat,
    toolStream,
    clearToolStream,
    openCsvInViewer,
    setActiveTab,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>(
    {},
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, toolStream]);

  const sendMut = useMutation({
    mutationFn: async (prompt: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        createdAt: Date.now(),
      };
      addChatMessage(userMsg);
      clearToolStream();

      const history = [...chatMessages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      return api.chatWithGroq(history);
    },
    onSuccess: (res) => {
      addChatMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.assistantMessage,
        toolTraces: res.toolTraces,
        artifacts: res.artifacts,
        createdAt: Date.now(),
      });
      clearToolStream();
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
    onError: (err) => {
      addChatMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${(err as Error).message}`,
        createdAt: Date.now(),
      });
      clearToolStream();
    },
  });

  const submitPrompt = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || sendMut.isPending) return;
    if (!text) setInput("");
    sendMut.mutate(q);
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
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
        <button
          type="button"
          onClick={clearChat}
          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
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
          <textarea
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
  );
}

