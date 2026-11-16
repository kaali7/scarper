import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  AlertCircle,
  Check,
  Columns3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { api, formatError } from "../api";
import { useAppStore } from "../store";
import type { CsvFilterOptions, DbJobEntry } from "../types";

const LEAD_8 = [
  "title",
  "phone",
  "emails",
  "website",
  "category",
  "address",
  "review_rating",
  "review_count",
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function displayJobStatus(status: string, engineRunning: boolean): string {
  if ((status === "working" || status === "pending") && !engineRunning) {
    return "stopped";
  }
  return status;
}

function isIncompleteJob(job: DbJobEntry, engineRunning: boolean): boolean {
  const shown = displayJobStatus(job.status, engineRunning);
  return shown === "stopped" || shown === "failed";
}

function statusBadge(status: string) {
  if (status === "ok") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "working" || status === "pending") {
    return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
  if (status === "stopped" || status === "paused") {
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  }
  if (status === "failed") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return "bg-slate-700/50 text-slate-300 border-slate-600";
}

export function DbCsvExplorer() {
  const qc = useQueryClient();
  const {
    selectedCsvPath,
    selectedJobError,
    selectedJobId,
    setSelectedJobId,
    openCsvInViewer,
    clearSelectedCsv,
    clearSelectedJobError,
    liveProgress,
  } = useAppStore();

  const [search, setSearch] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [noWebsite, setNoWebsite] = useState(false);
  const [selectedCols, setSelectedCols] = useState<string[] | undefined>(
    undefined,
  );
  const [showColPicker, setShowColPicker] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [confirmDeleteJobId, setConfirmDeleteJobId] = useState<string | null>(
    null,
  );
  const [confirmClearMode, setConfirmClearMode] = useState<
    "failed" | "all" | null
  >(null);

  const tableParentRef = useRef<HTMLDivElement>(null);

  const { data: engineStatus } = useQuery({
    queryKey: ["engine-status"],
    queryFn: api.getEngineStatus,
    refetchInterval: 5000,
  });
  const engineRunning = Boolean(engineStatus?.running);

  const {
    data: dbJobs = [],
    isFetching: loadingJobs,
    error: jobsError,
  } = useQuery({
    queryKey: ["db-jobs"],
    queryFn: api.listDbJobs,
    refetchInterval: (query) => {
      const hasWorking = (query.state.data ?? []).some(
        (j) => j.status === "working" || j.status === "pending",
      );
      return hasWorking ? 1500 : 4000;
    },
  });

  const {
    data: csvFiles = [],
    isFetching: loadingCsvs,
    error: csvFilesError,
  } = useQuery({
    queryKey: ["csv-files"],
    queryFn: api.listCsvFiles,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (selectedCsvPath || selectedJobId) return;
    const workingJob = dbJobs.find(
      (j) =>
        j.status === "working" ||
        j.status === "pending" ||
        displayJobStatus(j.status, engineRunning) === "working" ||
        displayJobStatus(j.status, engineRunning) === "pending",
    );
    if (workingJob) {
      setSelectedJobId(workingJob.id);
      return;
    }
    const firstWorkspace = csvFiles.find(
      (f) => f.source === "workspace" && f.rowCount > 0,
    );
    if (firstWorkspace) {
      openCsvInViewer(firstWorkspace.path, null);
      return;
    }
    const firstJob = dbJobs.find((j) => j.csvExists && j.places > 0);
    if (firstJob) {
      openCsvInViewer(firstJob.csvPath, firstJob.error || null);
      return;
    }
    if (dbJobs.length > 0) {
      setSelectedJobId(dbJobs[0].id);
    }
  }, [selectedCsvPath, selectedJobId, csvFiles, dbJobs, engineRunning, openCsvInViewer, setSelectedJobId]);

  const filterOptions: CsvFilterOptions = useMemo(
    () => ({
      search: search.trim() || undefined,
      hasPhone,
      hasEmail,
      noWebsite,
      columns: selectedCols,
      maxRows: 5000,
    }),
    [search, hasPhone, hasEmail, noWebsite, selectedCols],
  );

  const {
    data: tableData,
    isFetching: loadingTable,
    error: tableError,
  } = useQuery({
    queryKey: ["csv-table", selectedCsvPath, filterOptions],
    queryFn: () => api.readCsvTable(selectedCsvPath!, filterOptions),
    enabled: Boolean(selectedCsvPath),
    placeholderData: (prev) => prev,
  });

  const selectedJob = useMemo(
    () =>
      dbJobs.find((j) => j.id === selectedJobId) ??
      dbJobs.find((j) => selectedCsvPath && j.csvPath === selectedCsvPath) ??
      null,
    [dbJobs, selectedJobId, selectedCsvPath],
  );

  const activeRunningJob = useMemo(() => {
    return dbJobs.find((j) => {
      const shown = displayJobStatus(j.status, engineRunning);
      return shown === "working" || shown === "pending";
    });
  }, [dbJobs, engineRunning]);

  const liveForSelected = selectedJob ? liveProgress[selectedJob.id] : undefined;

  const shownJobStatus = selectedJob
    ? displayJobStatus(liveForSelected?.status ?? selectedJob.status, engineRunning)
    : "idle";

  const isJobWorking =
    shownJobStatus === "working" || shownJobStatus === "pending";

  const placesScraped = liveForSelected?.places ?? selectedJob?.places ?? 0;
  const percentDone = Math.min(
    100,
    Math.max(0, Math.round(liveForSelected?.percent ?? selectedJob?.percent ?? 0)),
  );
  const percentPending = Math.max(0, 100 - percentDone);
  const currentStage =
    liveForSelected?.stage || selectedJob?.stage || "scraping";

  const keywordsTotal =
    liveForSelected?.keywordsTotal ??
    (selectedJob?.keywords?.length || 1);
  const keywordsDone = Math.min(
    keywordsTotal,
    liveForSelected?.keywordsDone ??
      Math.round((percentDone / 100) * keywordsTotal),
  );
  const keywordsPending = Math.max(0, keywordsTotal - keywordsDone);

  const deleteMut = useMutation({
    mutationFn: (job: DbJobEntry) => api.deleteDbJob(job.id),
    onSuccess: (_data, job) => {
      setConfirmDeleteJobId(null);
      if (selectedJobId === job.id) {
        setSelectedJobId(null);
      }
      if (selectedCsvPath === job.csvPath) {
        clearSelectedCsv();
      }
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
    },
    onError: (err) => setActionErr(formatError(err)),
  });

  const clearMut = useMutation({
    mutationFn: (failedOnly: boolean) => api.clearDbJobs(failedOnly),
    onSuccess: (_count, failedOnly) => {
      setConfirmClearMode(null);
      const removedIds = new Set(
        dbJobs
          .filter((j) => !failedOnly || j.status === "failed")
          .map((j) => j.id),
      );
      if (selectedJobId && removedIds.has(selectedJobId)) {
        setSelectedJobId(null);
      }
      const removedPaths = new Set(
        dbJobs
          .filter((j) => !failedOnly || j.status === "failed")
          .map((j) => j.csvPath),
      );
      if (selectedCsvPath && removedPaths.has(selectedCsvPath)) {
        clearSelectedCsv();
      }
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
    },
    onError: (err) => setActionErr(formatError(err)),
  });

  const restartMut = useMutation({
    mutationFn: (job: DbJobEntry) => api.restartDbJob(job.id),
    onSuccess: (newJobId, job) => {
      setActionErr(null);
      setSelectedJobId(newJobId);
      setRestartMsg(
        `Restarted "${job.name}" (${newJobId.slice(0, 8)}…). Engine is running and scraping will continue.`,
      );
      qc.invalidateQueries({ queryKey: ["engine-status"] });
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
      qc.invalidateQueries({ queryKey: ["csv-table"] });
    },
    onError: (err) => setActionErr(formatError(err)),
  });

  const handleBrowseExternal = async () => {
    setActionErr(null);
    setRestartMsg(null);
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "CSV Files", extensions: ["csv"] }],
      });
      if (typeof picked === "string") {
        setSelectedJobId(null);
        setSelectedCols(undefined);
        openCsvInViewer(picked, null);
      }
    } catch (err) {
      setActionErr(formatError(err));
    }
  };

  const handleSelectPath = (
    path: string,
    errorNote?: string | null,
    jobId: string | null = null,
  ) => {
    setSelectedCols(undefined);
    setExportMsg(null);
    setActionErr(null);
    setRestartMsg(null);
    setSelectedJobId(jobId);
    if (tableParentRef.current) {
      tableParentRef.current.scrollTop = 0;
    }
    openCsvInViewer(path, errorNote);
  };

  useEffect(() => {
    if (tableParentRef.current) {
      tableParentRef.current.scrollTop = 0;
    }
  }, [selectedCsvPath]);

  const handleSelectJob = (job: DbJobEntry) => {
    setSelectedCols(undefined);
    setExportMsg(null);
    setActionErr(null);
    setRestartMsg(null);
    setSelectedJobId(job.id);
    const shown = displayJobStatus(job.status, engineRunning);
    if (shown === "working" || shown === "pending" || !job.csvExists) {
      clearSelectedCsv();
    } else {
      openCsvInViewer(job.csvPath, job.error || null);
    }
  };

  const handleDeleteJob = (job: DbJobEntry) => {
    setActionErr(null);
    setConfirmClearMode(null);
    setConfirmDeleteJobId((prev) => (prev === job.id ? null : job.id));
  };

  const handleExport = async () => {
    if (!selectedCsvPath) return;
    setActionErr(null);
    try {
      const defaultName = selectedJob?.name
        ? `${selectedJob.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")}.csv`
        : "filtered-leads.csv";
      const dest = await save({
        defaultPath: defaultName,
        filters: [
          { name: "CSV", extensions: ["csv"] },
          { name: "JSON", extensions: ["json"] },
        ],
      });
      if (!dest) return;
      const count = await api.exportCsvFile(selectedCsvPath, dest, filterOptions);
      setExportMsg(`Saved ${count} row(s) to ${dest}`);
      qc.invalidateQueries({ queryKey: ["csv-files"] });
    } catch (err) {
      setActionErr(formatError(err));
    }
  };

  const handleReveal = async () => {
    if (!selectedCsvPath) return;
    setActionErr(null);
    try {
      await api.revealFileInFolder(selectedCsvPath);
    } catch (err) {
      setActionErr(formatError(err));
    }
  };

  const handleOpenExternal = async () => {
    if (!selectedCsvPath) return;
    setActionErr(null);
    try {
      await api.openFileExternally(selectedCsvPath);
    } catch (err) {
      setActionErr(formatError(err));
    }
  };

  const copyCell = async (text: string, key: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const columnHelper = useMemo(() => createColumnHelper<string[]>(), []);
  const tableHeaders = tableData?.headers;
  const columns = useMemo(() => {
    if (!tableHeaders || tableHeaders.length === 0) return [];
    return tableHeaders.map((header, idx) =>
      columnHelper.accessor((row) => row[idx] ?? "", {
        id: header,
        header: () => header,
        cell: (info) => info.getValue(),
      }),
    );
  }, [columnHelper, tableHeaders]);

  const tableRows = tableData?.rows;
  const stableRows = useMemo(() => tableRows ?? [], [tableRows]);

  const table = useReactTable({
    data: stableRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    setPage(0);
  }, [selectedCsvPath, search, hasPhone, hasEmail, noWebsite]);

  const sortedRows = table.getRowModel().rows;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedRows = sortedRows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  const refreshAll = () => {
    setActionErr(null);
    qc.invalidateQueries({ queryKey: ["db-jobs"] });
    qc.invalidateQueries({ queryKey: ["csv-files"] });
    if (selectedCsvPath) {
      qc.invalidateQueries({ queryKey: ["csv-table", selectedCsvPath] });
    }
  };

  const allHeaders = tableData?.allHeaders ?? [];
  const visibleHeaders = tableData?.headers ?? [];

  const toggleColumn = (col: string) => {
    const base = selectedCols ?? allHeaders;
    const next = base.includes(col)
      ? base.filter((c) => c !== col)
      : allHeaders.filter((c) => c === col || base.includes(c));
    if (next.length > 0) setSelectedCols(next);
  };

  const sidebarError =
    formatError(jobsError) || formatError(csvFilesError);

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* Left Explorer Sidebar */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <Database className="h-3.5 w-3.5 text-emerald-400" />
            DB & CSV Explorer
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleBrowseExternal}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
              title="Open any CSV file from disk"
            >
              Browse…
            </button>
            <button
              type="button"
              onClick={refreshAll}
              className="rounded border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:bg-slate-700"
              title="Refresh jobs.db & CSV list"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingJobs || loadingCsvs ? "animate-spin" : ""
                  }`}
              />
            </button>
          </div>
        </div>

        {sidebarError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
            {sidebarError}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {/* jobs.db list */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Engine Jobs (jobs.db · {dbJobs.length})
              </h3>
              {dbJobs.length > 0 && (
                <div className="flex items-center gap-1">
                  {dbJobs.some((j) => j.status === "failed") && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteJobId(null);
                        setConfirmClearMode((prev) =>
                          prev === "failed" ? null : "failed",
                        );
                      }}
                      disabled={clearMut.isPending || deleteMut.isPending}
                      className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-slate-700 disabled:opacity-50"
                      title="Remove failed jobs from jobs.db"
                    >
                      Clear Failed
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteJobId(null);
                      setConfirmClearMode((prev) =>
                        prev === "all" ? null : "all",
                      );
                    }}
                    disabled={clearMut.isPending || deleteMut.isPending}
                    className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                    title="Remove all engine jobs and their raw CSVs"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>
            {confirmClearMode && dbJobs.length > 0 && (
              <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
                <span>
                  {confirmClearMode === "failed"
                    ? "Remove all failed jobs and their raw CSV files?"
                    : "Remove all engine jobs and raw CSV files? Saved CSV files are kept."}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      clearMut.mutate(confirmClearMode === "failed")
                    }
                    disabled={clearMut.isPending}
                    className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    {clearMut.isPending ? "Removing…" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearMode(null)}
                    className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {dbJobs.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-xs text-slate-500">
                No jobs recorded in .engine/data/jobs.db yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {dbJobs.map((job) => {
                  const shownStatus = displayJobStatus(job.status, engineRunning);
                  const incomplete = isIncompleteJob(job, engineRunning);
                  const active =
                    selectedJobId === job.id ||
                    (!selectedJobId && selectedCsvPath === job.csvPath);
                  const confirmingThis = confirmDeleteJobId === job.id;
                  return (
                    <div
                      key={job.id}
                      onClick={() => handleSelectJob(job)}
                      className={`group cursor-pointer rounded-lg border p-2.5 transition ${active
                          ? "border-emerald-500/70 bg-emerald-500/10"
                          : "border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900/60"
                        }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 text-left">
                          <div className="truncate text-xs font-medium text-slate-100">
                            {job.name}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span
                              className={`rounded border px-1.5 py-0.5 font-semibold uppercase ${statusBadge(
                                shownStatus,
                              )}`}
                            >
                              {shownStatus}
                            </span>
                            <span className="text-slate-400">
                              {job.places} places
                            </span>
                            {!job.csvExists && (
                              <span className="text-slate-500">(no CSV)</span>
                            )}
                          </div>
                          <div className="mt-1 truncate text-[10px] text-slate-500">
                            {formatDate(job.date)}
                          </div>
                          {shownStatus === "stopped" && (
                            <p className="mt-1 text-[10px] text-amber-300/90">
                              Stopped mid-run — click to restart
                            </p>
                          )}
                        </div>
                        <div
                          className="flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {incomplete && (
                            <button
                              type="button"
                              onClick={() => restartMut.mutate(job)}
                              disabled={restartMut.isPending}
                              className="rounded p-1 text-amber-300 opacity-85 transition hover:bg-amber-500/20 hover:text-amber-200 disabled:opacity-50 group-hover:opacity-100"
                              title="Restart / resume job"
                              aria-label={`Restart job ${job.name}`}
                            >
                              {restartMut.isPending &&
                                restartMut.variables?.id === job.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteJob(job)}
                            className="rounded p-1 text-slate-400 opacity-70 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                            title="Delete job & CSV"
                            aria-label={`Delete job ${job.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {confirmingThis && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200">
                          <span>Remove this job & raw CSV?</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => deleteMut.mutate(job)}
                              disabled={deleteMut.isPending}
                              className="rounded bg-rose-600 px-1.5 py-0.5 font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteJobId(null)}
                              className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {job.error && (
                        <p className="mt-1.5 line-clamp-2 text-[10px] text-rose-300/90">
                          {job.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Saved CSVs */}
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Saved CSV Files ({csvFiles.filter((f) => f.source === "workspace").length})
            </h3>
            <div className="space-y-1.5">
              {csvFiles
                .filter((f) => f.source === "workspace")
                .map((file) => {
                  const active = selectedCsvPath === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => handleSelectPath(file.path, null)}
                      className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition ${active
                          ? "border-emerald-500/70 bg-emerald-500/10"
                          : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                        }`}
                    >
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-100">
                          {file.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {file.rowCount} rows · {(file.sizeBytes / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      </aside>

      {/* Main CSV Table Pane */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        {/* Active Running Job Alert Banner */}
        {activeRunningJob && (selectedCsvPath || selectedJob?.id !== activeRunningJob.id) && (
          <div className="m-3 mb-0 flex items-center justify-between gap-3 rounded-xl border border-sky-500/40 bg-sky-500/15 p-3 text-xs text-sky-200 shadow-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
              </span>
              <div className="truncate">
                <span className="font-semibold text-white">Scrape Running in Background:</span>{" "}
                <span className="text-sky-300 font-medium">"{activeRunningJob.name}"</span>
                <span className="ml-2 font-mono text-[11px] text-sky-200/80">
                  ({liveProgress[activeRunningJob.id]?.places ?? activeRunningJob.places} places so far)
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSelectJob(activeRunningJob)}
              className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 font-semibold text-slate-950 hover:bg-sky-400 transition flex items-center gap-1.5 shadow"
            >
              <Activity className="h-3.5 w-3.5" />
              View Live Progress
            </button>
          </div>
        )}

        {actionErr && (
          <div className="m-3 mb-0 flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <span>{actionErr}</span>
            <button
              type="button"
              onClick={() => setActionErr(null)}
              className="text-rose-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {restartMsg && (
          <div className="m-3 mb-0 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <span>{restartMsg}</span>
            <button
              type="button"
              onClick={() => setRestartMsg(null)}
              className="text-emerald-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {!selectedCsvPath ? (
          selectedJob ? (
            isJobWorking ? (
              <div className="flex flex-1 flex-col items-center justify-center p-6 max-w-2xl mx-auto w-full overflow-y-auto">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Live Scraping In Progress
                  </span>
                </div>

                <h2 className="text-xl font-bold text-slate-100 text-center mb-1">
                  {selectedJob.name}
                </h2>
                <p className="text-xs text-slate-400 text-center mb-6">
                  Started {formatDate(selectedJob.date)} · Stage:{" "}
                  <span className="text-emerald-300 font-mono font-medium capitalize">
                    {currentStage}
                  </span>
                </p>

                {/* Progress Bar & Percentage Done vs Pending */}
                <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-5 mb-5 shadow-lg">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200">
                        Job Progress
                      </span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                        {percentDone}% Done
                      </span>
                    </div>
                    <span className="text-xs font-mono text-amber-300 font-medium bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {percentPending}% Pending
                    </span>
                  </div>

                  <div className="h-3 w-full bg-slate-800/80 rounded-full overflow-hidden p-0.5 border border-slate-700/80">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(4, percentDone)}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center mt-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                      Live scraping in engine
                    </span>
                    <span className="font-mono">
                      Keywords: {keywordsDone}/{keywordsTotal} done · {keywordsPending} pending
                    </span>
                  </div>
                </div>

                {/* 4 Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full mb-5">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-center shadow-sm">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                      Places Scraped
                    </div>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                      {placesScraped}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">collected so far</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-center shadow-sm">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                      Completed
                    </div>
                    <div className="text-2xl font-bold font-mono text-teal-300 mt-1">
                      {percentDone}%
                    </div>
                    <div className="text-[10px] text-emerald-400/80 mt-0.5">progress</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-center shadow-sm">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                      Pending
                    </div>
                    <div className="text-2xl font-bold font-mono text-amber-300 mt-1">
                      {percentPending}%
                    </div>
                    <div className="text-[10px] text-amber-400/80 mt-0.5">remaining</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-center shadow-sm">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                      Keywords
                    </div>
                    <div className="text-2xl font-bold font-mono text-sky-400 mt-1">
                      {keywordsDone}/{keywordsTotal}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {keywordsPending} pending
                    </div>
                  </div>
                </div>

                {/* Target Keywords List */}
                {selectedJob.keywords && selectedJob.keywords.length > 0 && (
                  <div className="w-full bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 mb-5 text-left">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Target Keywords ({selectedJob.keywords.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedJob.keywords.map((kw, i) => (
                        <span
                          key={i}
                          className="rounded-lg bg-slate-800/90 border border-slate-700/70 px-2.5 py-1 text-xs text-slate-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live CSV / Status Note */}
                {selectedJob.csvExists ? (
                  <button
                    type="button"
                    onClick={() => openCsvInViewer(selectedJob.csvPath, null)}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Open Live CSV Table ({placesScraped} places)
                  </button>
                ) : (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    <span>
                      Writing data from Chrome... CSV table will appear here automatically when the first batch is ready.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusBadge(
                      displayJobStatus(selectedJob.status, engineRunning),
                    )}`}
                  >
                    {displayJobStatus(selectedJob.status, engineRunning)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {selectedJob.places} places · {formatDate(selectedJob.date)}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-100">
                  {selectedJob.name}
                </h3>
                <p className="max-w-md text-xs text-slate-400">
                  {displayJobStatus(selectedJob.status, engineRunning) === "stopped"
                    ? "This job stopped before finishing when the engine or app was closed. Restart it to start the engine and resume scraping."
                    : selectedJob.status === "failed"
                      ? "This job failed before completing and has no CSV on disk yet."
                      : "This job has no CSV file on disk yet."}
                </p>
                {selectedJob.error && (
                  <div className="max-w-md rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {selectedJob.error}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {isIncompleteJob(selectedJob, engineRunning) && (
                    <button
                      type="button"
                      onClick={() => restartMut.mutate(selectedJob)}
                      disabled={restartMut.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
                    >
                      {restartMut.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Restart Job
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <FileSpreadsheet className="h-10 w-10 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-200">
                Click any job in jobs.db or CSV file on the left
              </h3>
              <p className="max-w-md text-xs text-slate-400">
                View, search, filter phone numbers, toggle columns, and export clean
                CSV or JSON files right inside the app.
              </p>
            </div>
          )
        ) : (
          <>
            {/* Table Toolbar */}
            <div className="flex flex-col gap-2.5 border-b border-slate-800 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-slate-100">
                      {selectedCsvPath.split(/[\\/]/).pop()}
                    </h2>
                    {tableData && (
                      <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
                        {tableData.filteredRows} / {tableData.totalRows} rows
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[10px] text-slate-500">
                    {selectedCsvPath}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isJobWorking && (
                    <button
                      type="button"
                      onClick={() => clearSelectedCsv()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                      title="Switch to Live Progress view"
                    >
                      <Activity className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
                      Live Progress ({percentDone}%)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleOpenExternal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                    title="Open CSV in Excel / default spreadsheet app"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open App
                  </button>
                  <button
                    type="button"
                    onClick={handleReveal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                    title="Reveal file in Explorer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Reveal
                  </button>
                  <button
                    type="button"
                    onClick={handleExport}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export Filtered
                  </button>
                </div>
              </div>

              {selectedJob && isIncompleteJob(selectedJob, engineRunning) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {displayJobStatus(selectedJob.status, engineRunning) ===
                        "stopped"
                        ? `This job stopped mid-run (${selectedJob.places} places scraped so far).`
                        : "This job failed before completing."}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => restartMut.mutate(selectedJob)}
                    disabled={restartMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    {restartMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Restart Job
                  </button>
                </div>
              )}

              {selectedJobError && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Job note: {selectedJobError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelectedJobError}
                    className="shrink-0 text-amber-300 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {exportMsg && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
                  {exportMsg}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    id="csv-rows-search"
                    name="csv-rows-search"
                    aria-label="Search rows"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search rows…"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {[
                  { label: "Has Phone", val: hasPhone, set: setHasPhone },
                  { label: "Has Email", val: hasEmail, set: setHasEmail },
                  { label: "No Website", val: noWebsite, set: setNoWebsite },
                ].map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() => f.set(!f.val)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${f.val
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                        : "border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200"
                      }`}
                  >
                    {f.label}
                  </button>
                ))}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowColPicker((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                    Columns ({visibleHeaders.length}/{allHeaders.length})
                  </button>

                  {showColPicker && (
                    <div className="absolute right-0 top-9 z-30 w-64 rounded-lg border border-slate-700 bg-slate-900 p-2.5 shadow-2xl">
                      <div className="mb-2 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedCols(["title", "phone"])}
                          className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                        >
                          Name & Phone
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCols(
                              LEAD_8.filter((c) => allHeaders.includes(c)),
                            )
                          }
                          className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                        >
                          8 Lead Fields
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCols(undefined)}
                          className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                        >
                          All
                        </button>
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {allHeaders.map((col) => {
                          const colInputId = `col-toggle-${col.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
                          return (
                            <label
                              key={col}
                              htmlFor={colInputId}
                              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                            >
                              <input
                                id={colInputId}
                                name={colInputId}
                                aria-label={`Toggle column ${col}`}
                                type="checkbox"
                                checked={visibleHeaders.includes(col)}
                                onChange={() => toggleColumn(col)}
                                className="accent-emerald-500"
                              />
                              <span className="truncate font-mono text-[11px]">
                                {col}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Table Area */}
            {tableError ? (
              <div className="p-6 text-sm text-rose-300">
                {formatError(tableError)}
              </div>
            ) : (
              <div
                ref={tableParentRef}
                className="relative flex-1 overflow-auto"
              >
                {loadingTable && !tableData ? (
                  <div className="flex h-40 items-center justify-center text-xs text-slate-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
                    Loading CSV…
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-950 shadow-sm">
                      {table.getHeaderGroups().map((hg) => (
                        <tr key={hg.id}>
                          <th className="w-12 border-b border-slate-800 px-3 py-2 font-mono text-[10px] text-slate-500">
                            #
                          </th>
                          {hg.headers.map((header) => (
                            <th
                              key={header.id}
                              onClick={header.column.getToggleSortingHandler()}
                              className="cursor-pointer select-none whitespace-nowrap border-b border-slate-800 px-3 py-2 font-semibold text-slate-300 hover:text-white"
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              {{
                                asc: " ▲",
                                desc: " ▼",
                              }[header.column.getIsSorted() as string] ?? ""}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {sortedRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={visibleHeaders.length + 1}
                            className="px-4 py-8 text-center text-xs text-slate-500"
                          >
                            No rows match the current file or filters.
                          </td>
                        </tr>
                      ) : (
                        pagedRows.map((row, idx) => {
                          const rowNum = currentPage * pageSize + idx + 1;
                          return (
                            <tr
                              key={row.id}
                              className="h-10 border-b border-slate-800/70 hover:bg-slate-800/40"
                            >
                              <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                                {rowNum}
                              </td>
                              {row.getVisibleCells().map((cell) => {
                                const val = String(cell.getValue() ?? "");
                                const cKey = `${rowNum}-${cell.column.id}`;
                                const isUrl =
                                  val.startsWith("https://") ||
                                  val.startsWith("http://");
                                return (
                                  <td
                                    key={cell.id}
                                    className="max-w-[280px] truncate px-3 py-1.5 text-slate-200"
                                    title={val}
                                  >
                                    <div className="flex items-center justify-between gap-1.5">
                                      {isUrl ? (
                                        <button
                                          type="button"
                                          onClick={() => openUrl(val)}
                                          className="inline-flex items-center gap-1 truncate text-sky-400 hover:underline"
                                        >
                                          <span className="truncate">{val}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </button>
                                      ) : (
                                        <span className="truncate">{val}</span>
                                      )}
                                      {val && (
                                        <button
                                          type="button"
                                          onClick={() => copyCell(val, cKey)}
                                          className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                                          title="Copy cell"
                                        >
                                          {copiedKey === cKey ? (
                                            <Check className="h-3 w-3 text-emerald-400" />
                                          ) : (
                                            <Copy className="h-3 w-3" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Pagination Controls */}
            {sortedRows.length > pageSize && (
              <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-4 py-2 text-xs text-slate-400">
                <span>
                  Showing {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, sortedRows.length)} of{" "}
                  {sortedRows.length} rows
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPage((p) => Math.max(0, p - 1));
                      if (tableParentRef.current) tableParentRef.current.scrollTop = 0;
                    }}
                    disabled={currentPage === 0}
                    className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="font-mono text-[11px] text-slate-300">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPage((p) => Math.min(totalPages - 1, p + 1));
                      if (tableParentRef.current) tableParentRef.current.scrollTop = 0;
                    }}
                    disabled={currentPage >= totalPages - 1}
                    className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
