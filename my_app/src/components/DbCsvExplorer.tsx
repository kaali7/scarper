import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Check,
  Columns3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "../api";
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

function statusBadge(status: string) {
  if (status === "ok") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "working") return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  if (status === "failed") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return "bg-slate-700/50 text-slate-300 border-slate-600";
}

export function DbCsvExplorer() {
  const qc = useQueryClient();
  const {
    selectedCsvPath,
    selectedJobError,
    openCsvInViewer,
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

  const tableParentRef = useRef<HTMLDivElement>(null);

  const { data: dbJobs = [], isFetching: loadingJobs } = useQuery({
    queryKey: ["db-jobs"],
    queryFn: api.listDbJobs,
  });

  const { data: csvFiles = [], isFetching: loadingCsvs } = useQuery({
    queryKey: ["csv-files"],
    queryFn: api.listCsvFiles,
  });

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
  });

  const deleteMut = useMutation({
    mutationFn: (jobId: string) => api.deleteDbJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
    },
  });

  const handleBrowseExternal = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "CSV Files", extensions: ["csv"] }],
    });
    if (typeof picked === "string") {
      setSelectedCols(undefined);
      openCsvInViewer(picked, null);
    }
  };

  const handleSelectPath = (path: string, errorNote?: string | null) => {
    setSelectedCols(undefined);
    setExportMsg(null);
    openCsvInViewer(path, errorNote);
  };

  const handleDeleteJob = async (job: DbJobEntry) => {
    const ok = await confirm(
      `Delete job "${job.name}" and its CSV file?`,
      { title: "Delete Job", kind: "warning" },
    );
    if (!ok) return;
    deleteMut.mutate(job.id);
  };

  const handleExport = async () => {
    if (!selectedCsvPath) return;
    const dest = await save({
      defaultPath: "filtered-leads.csv",
      filters: [
        { name: "CSV", extensions: ["csv"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (!dest) return;
    const count = await api.exportCsvFile(selectedCsvPath, dest, filterOptions);
    setExportMsg(`Saved ${count} row(s) to ${dest}`);
    qc.invalidateQueries({ queryKey: ["csv-files"] });
  };

  const copyCell = async (text: string, key: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const columnHelper = createColumnHelper<string[]>();
  const columns = useMemo(() => {
    if (!tableData) return [];
    return tableData.headers.map((header, idx) =>
      columnHelper.accessor((row) => row[idx] ?? "", {
        id: header,
        header: () => header,
        cell: (info) => info.getValue(),
      }),
    );
  }, [tableData, columnHelper]);

  const table = useReactTable({
    data: tableData?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const sortedRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 40,
    overscan: 15,
    initialRect: { width: 1000, height: 600 },
  });

  const refreshAll = () => {
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
                className={`h-3.5 w-3.5 ${
                  loadingJobs || loadingCsvs ? "animate-spin" : ""
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {/* jobs.db list */}
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Engine Jobs (jobs.db · {dbJobs.length})
            </h3>
            {dbJobs.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-xs text-slate-500">
                No jobs recorded in .engine/data/jobs.db yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {dbJobs.map((job) => {
                  const active = selectedCsvPath === job.csvPath;
                  return (
                    <div
                      key={job.id}
                      className={`group rounded-lg border p-2.5 transition ${
                        active
                          ? "border-emerald-500/70 bg-emerald-500/10"
                          : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          disabled={!job.csvExists}
                          onClick={() =>
                            handleSelectPath(job.csvPath, job.error || null)
                          }
                          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <div className="truncate text-xs font-medium text-slate-100">
                            {job.name}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span
                              className={`rounded border px-1.5 py-0.5 font-semibold uppercase ${statusBadge(
                                job.status,
                              )}`}
                            >
                              {job.status}
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
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteJob(job)}
                          className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                          title="Delete job & CSV"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
                      className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition ${
                        active
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
        {!selectedCsvPath ? (
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
                  <button
                    type="button"
                    onClick={() => revealItemInDir(selectedCsvPath)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
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

              {selectedJobError && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Job note: {selectedJobError}</span>
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
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                      f.val
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
                        {allHeaders.map((col) => (
                          <label
                            key={col}
                            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={visibleHeaders.includes(col)}
                              onChange={() => toggleColumn(col)}
                              className="accent-emerald-500"
                            />
                            <span className="truncate font-mono text-[11px]">
                              {col}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Virtualized Table */}
            {tableError ? (
              <div className="p-6 text-sm text-rose-300">
                {(tableError as Error).message}
              </div>
            ) : loadingTable && !tableData ? (
              <div className="p-6 text-xs text-slate-400">Loading CSV…</div>
            ) : (
              <div
                ref={tableParentRef}
                className="relative flex-1 overflow-auto"
              >
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
                    {rowVirtualizer.getVirtualItems().length > 0 && (
                      <tr
                        style={{
                          height: `${rowVirtualizer.getVirtualItems()[0].start}px`,
                        }}
                      />
                    )}
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const row = sortedRows[vRow.index];
                      return (
                        <tr
                          key={row.id}
                          style={{ height: `${vRow.size}px` }}
                          className="border-b border-slate-800/70 hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                            {vRow.index + 1}
                          </td>
                          {row.getVisibleCells().map((cell) => {
                            const val = String(cell.getValue() ?? "");
                            const cKey = `${vRow.index}-${cell.column.id}`;
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
                    })}
                    {rowVirtualizer.getVirtualItems().length > 0 && (
                      <tr
                        style={{
                          height: `${
                            rowVirtualizer.getTotalSize() -
                            rowVirtualizer.getVirtualItems()[
                              rowVirtualizer.getVirtualItems().length - 1
                            ].end
                          }px`,
                        }}
                      />
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

