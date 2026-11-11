import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, RefreshCw, Square } from "lucide-react";
import { api } from "../api";

export function TopBar() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["engine-status"],
    queryFn: api.getEngineStatus,
    refetchInterval: 5000,
  });

  const startMut = useMutation({
    mutationFn: api.startEngine,
    onSuccess: (next) => qc.setQueryData(["engine-status"], next),
  });

  const stopMut = useMutation({
    mutationFn: api.stopEngine,
    onSuccess: (next) => qc.setQueryData(["engine-status"], next),
  });

  const restartMut = useMutation({
    mutationFn: api.restartEngine,
    onSuccess: (next) => qc.setQueryData(["engine-status"], next),
  });

  const busy = startMut.isPending || stopMut.isPending || restartMut.isPending;
  const errMsg =
    (startMut.error as Error | null)?.message ||
    (stopMut.error as Error | null)?.message ||
    (restartMut.error as Error | null)?.message;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-sm font-bold text-emerald-400">
          GM
        </span>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-slate-100">
            Google Maps Scraper
          </h1>
          <p className="text-xs text-slate-400">
            {status?.python
              ? `Python ${status.python.version} (${status.python.executable})`
              : "Python not detected"}
            {status?.chromePath ? " · Chrome ready" : " · No Chrome found"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {errMsg && (
          <span className="max-w-xs truncate rounded bg-rose-500/15 px-2.5 py-1 text-xs text-rose-300" title={errMsg}>
            {errMsg}
          </span>
        )}

        <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              isLoading || busy
                ? "animate-pulse bg-amber-400"
                : status?.running
                  ? "bg-emerald-400"
                  : status?.foreignPortBusy
                    ? "bg-rose-400"
                    : "bg-slate-500"
            }`}
          />
          <span className="font-medium text-slate-200">
            {busy
              ? "Updating…"
              : status?.running
                ? `Engine Running :${status.port}`
                : status?.foreignPortBusy
                  ? `Port :${status.port} Busy`
                  : "Engine Stopped"}
          </span>
        </div>

        {!status?.running ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => startMut.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start Engine
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => restartMut.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${restartMut.isPending ? "animate-spin" : ""}`} />
              Restart
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => stopMut.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          </>
        )}
      </div>
    </header>
  );
}

