import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { api, formatError } from "../api";
import { useAppStore } from "../store";
import type { CityInput, CityMatch, ScrapeRunResult } from "../types";

export type ScrapeTargetSource = "maps" | "social" | "website" | "multichannel";
type ModePreset = "phone_only" | "standard" | "no_website" | "custom";

const LEAD_FIELDS = [
  "title",
  "phone",
  "emails",
  "website",
  "category",
  "address",
  "review_rating",
  "review_count",
];

export function SearchBuilder() {
  const qc = useQueryClient();
  const {
    openCsvInViewer,
    liveProgress,
    clearProgress,
    setSelectedJobId,
    clearSelectedCsv,
  } = useAppStore();
  const [jobSubmitted, setJobSubmitted] = useState(false);

  const [preset, setPreset] = useState<ModePreset>("phone_only");
  const [kwInput, setKwInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([
    "coffee shops",
    "dress shops",
  ]);
  const [cityQuery, setCityQuery] = useState("");
  const [cityMatches, setCityMatches] = useState<CityMatch[]>([]);
  const [cities, setCities] = useState<CityInput[]>([]);
  const [searchingCity, setSearchingCity] = useState(false);

  const [collectEmails, setCollectEmails] = useState(false);
  const [collectSocials, setCollectSocials] = useState(false);
  const [hasPhone, setHasPhone] = useState(true);
  const [noWebsite, setNoWebsite] = useState(false);
  const [verifyEmails, setVerifyEmails] = useState(false);
  const [browserSites, setBrowserSites] = useState(false);
  const [tech, setTech] = useState(false);

  const [fieldsMode, setFieldsMode] = useState<"phone_only" | "lead8" | "all">(
    "phone_only",
  );
  const [outFilename, setOutFilename] = useState("");

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [depth, setDepth] = useState(5);
  const [lang, setLang] = useState("en");
  const [country, setCountry] = useState("");
  const [maxTime, setMaxTime] = useState(600);
  const [reviewsMax, setReviewsMax] = useState(0);
  const [grid, setGrid] = useState<string>("");
  const [deepScan, setDeepScan] = useState(false);
  const [proxiesText, setProxiesText] = useState("");

  const [confirmLarge, setConfirmLarge] = useState(false);
  const [lastResult, setLastResult] = useState<ScrapeRunResult | null>(null);

  // Target source selector
  const [targetSource, setTargetSource] = useState<ScrapeTargetSource>("maps");

  // Social media inspector state
  const [socialPlatform, setSocialPlatform] = useState<
    "instagram" | "linkedin" | "twitter" | "sherlock"
  >("instagram");
  const [socialTarget, setSocialTarget] = useState("");
  const [socialLocation, setSocialLocation] = useState("");
  const [socialResult, setSocialResult] = useState<any>(null);
  const [socialError, setSocialError] = useState<string | null>(null);

  // Website lead enricher state
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteResult, setWebsiteResult] = useState<any>(null);
  const [websiteError, setWebsiteError] = useState<string | null>(null);

  const socialMut = useMutation({
    mutationFn: () =>
      api.runSocialLookup({
        platform: socialPlatform,
        target: socialTarget.trim(),
        location: socialLocation.trim() || undefined,
      }),
    onSuccess: (raw) => {
      try {
        setSocialResult(JSON.parse(raw));
        setSocialError(null);
      } catch {
        setSocialResult(raw);
        setSocialError(null);
      }
    },
    onError: (err) => {
      setSocialError(formatError(err));
      setSocialResult(null);
    },
  });

  const websiteMut = useMutation({
    mutationFn: () =>
      api.runWebsiteEnrich({
        url: websiteUrl.trim(),
      }),
    onSuccess: (raw) => {
      try {
        setWebsiteResult(JSON.parse(raw));
        setWebsiteError(null);
      } catch {
        setWebsiteResult(raw);
        setWebsiteError(null);
      }
    },
    onError: (err) => {
      setWebsiteError(formatError(err));
      setWebsiteResult(null);
    },
  });

  const { data: businessTypes = [] } = useQuery({
    queryKey: ["business-types"],
    queryFn: api.listBusinessTypes,
  });

  const filteredSuggestions = kwInput.trim()
    ? businessTypes
        .filter(
          (t) =>
            t.toLowerCase().includes(kwInput.trim().toLowerCase()) &&
            !keywords.includes(t),
        )
        .slice(0, 8)
    : [];

  const applyPreset = (p: ModePreset) => {
    setPreset(p);
    if (p === "phone_only") {
      setCollectEmails(false);
      setCollectSocials(false);
      setHasPhone(true);
      setNoWebsite(false);
      setFieldsMode("phone_only");
    } else if (p === "standard") {
      setCollectEmails(true);
      setCollectSocials(true);
      setHasPhone(false);
      setNoWebsite(false);
      setFieldsMode("lead8");
    } else if (p === "no_website") {
      setCollectEmails(false);
      setCollectSocials(false);
      setHasPhone(false);
      setNoWebsite(true);
      setFieldsMode("lead8");
    }
  };

  const addKeyword = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed || keywords.includes(trimmed)) return;
    setKeywords((prev) => [...prev, trimmed]);
    setKwInput("");
  };

  const handleLookupCity = async () => {
    const q = cityQuery.trim();
    if (!q) return;
    setSearchingCity(true);
    try {
      const hits = await api.lookupCity(q);
      setCityMatches(hits);
    } catch {
      setCityMatches([]);
    } finally {
      setSearchingCity(false);
    }
  };

  const addCity = (match: CityMatch) => {
    if (!cities.some((c) => c.label === match.label)) {
      setCities((prev) => [
        ...prev,
        { label: match.label, lat: match.lat, lon: match.lon },
      ]);
    }
    if (!country && match.country) {
      setCountry(match.country);
    }
    setCityQuery("");
    setCityMatches([]);
  };

  const addRawCity = () => {
    const q = cityQuery.trim();
    if (!q || cities.some((c) => c.label === q)) return;
    setCities((prev) => [...prev, { label: q }]);
    setCityQuery("");
    setCityMatches([]);
  };

  const scrapeMut = useMutation({
    mutationFn: async () => {
      clearProgress();
      setLastResult(null);
      setJobSubmitted(false);
      const parsedGrid = grid.trim() ? Number(grid.trim()) : undefined;
      const fields =
        fieldsMode === "phone_only"
          ? ["title", "phone"]
          : fieldsMode === "lead8"
            ? LEAD_FIELDS
            : undefined;
      const proxies = proxiesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      return api.startScrapeJob(
        {
          keywords,
          cities,
          depth,
          lang: lang.trim() || "en",
          country: country.trim() || undefined,
          maxTime,
          collectEmails,
          collectSocials,
          verifyEmails,
          browserSites,
          reviewsMax,
          proxies: proxies.length ? proxies : undefined,
          hasPhone,
          noWebsite,
          fields,
          outFilename: outFilename.trim() || undefined,
          grid: parsedGrid,
          deepScan,
          tech,
        },
        false,  // Don't block the Tauri thread waiting for completion — progress arrives via scrape://progress events
      );
    },
    onSuccess: (res) => {
      setConfirmLarge(false);
      // For CLI-mode jobs (grid/deepScan/tech/browserSites), the backend still
      // runs synchronously and returns a full result with exportedCsvPath — show it.
      if (res.exportedCsvPath) {
        setLastResult(res);
        setJobSubmitted(false);
      } else {
        // Engine-API job submitted asynchronously; progress arrives via
        // scrape://progress events. Show live progress until allDone fires.
        setJobSubmitted(true);
        if (res.jobIds && res.jobIds.length > 0) {
          setSelectedJobId(res.jobIds[0]);
          clearSelectedCsv();
        }
      }
      qc.invalidateQueries({ queryKey: ["db-jobs"] });
      qc.invalidateQueries({ queryKey: ["csv-files"] });
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
  });

  const parsedGridNum = grid.trim() ? Number(grid.trim()) : 0;
  const isLargeJob =
    depth >= 15 || parsedGridNum >= 2 || deepScan || keywords.length >= 5;

  const handleStart = () => {
    if (isLargeJob && !confirmLarge) {
      setConfirmLarge(true);
      return;
    }
    scrapeMut.mutate();
  };

  const progressList = Object.values(liveProgress);

  // When all submitted jobs have finished (ok/failed), refresh and show result.

  // Detect completion: all progress events reached a terminal status
  const allDone =
    jobSubmitted &&
    progressList.length > 0 &&
    progressList.every((p) => p.status === "ok" || p.status === "failed");

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (!allDone) return;
    setJobSubmitted(false);
    qc.invalidateQueries({ queryKey: ["db-jobs"] });
    qc.invalidateQueries({ queryKey: ["csv-files"] });
    qc.invalidateQueries({ queryKey: ["engine-status"] });
    // Build a summary result from live progress data
    const totalPlaces = progressList.reduce((sum, p) => sum + Number(p.places), 0);
    const warnings = progressList
      .filter((p) => p.error)
      .map((p) => `${p.cityLabel || p.jobId.slice(0, 8)}: ${p.error}`);
    setLastResult({
      jobIds: progressList.map((p) => p.jobId),
      primaryCsvPath: null,
      exportedCsvPath: null,
      exportedRows: totalPlaces,
      totalPlaces,
      warnings,
    });
  }, [allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Target Data Source Selector */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              Scrape Target & Data Source
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Decide where you want to scrape data from: Google Maps, Social Media, Direct Websites, or Multi-Channel.
            </p>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
            Active: {targetSource.toUpperCase()}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              id: "maps" as const,
              title: "Google Maps",
              desc: "Local businesses, addresses, ratings & phone leads via CDP",
              icon: MapPin,
              badge: "Local",
            },
            {
              id: "social" as const,
              title: "Social Media",
              desc: "Instagram, LinkedIn, Twitter/X, Reddit & Sherlock 400+",
              icon: Share2,
              badge: "Public & Safe",
            },
            {
              id: "website" as const,
              title: "Direct Websites",
              desc: "Extract emails, phones, WhatsApp & socials from any domain",
              icon: Globe,
              badge: "Enricher",
            },
            {
              id: "multichannel" as const,
              title: "All-in-One Multi-Channel",
              desc: "Maps search + website email crawl + social cross-reference",
              icon: Sparkles,
              badge: "All Tools",
            },
          ].map(({ id, title, desc, icon: Icon, badge }) => {
            const isSelected = targetSource === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTargetSource(id);
                  if (id === "multichannel") {
                    setCollectEmails(true);
                    setCollectSocials(true);
                  }
                }}
                className={`flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition ${
                  isSelected
                    ? "border-emerald-500 bg-emerald-500/15 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/50"
                    : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <div
                    className={`flex items-center gap-2 text-xs font-semibold ${
                      isSelected ? "text-emerald-300" : "text-slate-200"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{title}</span>
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                      isSelected
                        ? "bg-emerald-500/25 text-emerald-200"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {badge}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">{desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ======================================================== */}
      {/* 1. SOCIAL MEDIA SCRAPER VIEW                             */}
      {/* ======================================================== */}
      {targetSource === "social" && (
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">
              Social Media Inspector & Search Dorker
            </h3>
            <span className="text-xs text-slate-400">
              Zero login required · 100% legal public intelligence · Ban-proof
            </span>
          </div>

          {/* Platform Pills */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: "instagram" as const, label: "📸 Instagram", hint: "Public bio, followers, contact email" },
              { id: "linkedin" as const, label: "💼 LinkedIn", hint: "Company profile, employee count, HQ dorking" },
              { id: "twitter" as const, label: "🐦 Twitter / X", hint: "Account bio, handle verification via twscrape" },
              { id: "sherlock" as const, label: "🔍 Sherlock 400+", hint: "Scan 400+ platforms across the web" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSocialPlatform(p.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  socialPlatform === p.id
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                    : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={socialPlatform === "linkedin" ? "sm:col-span-2" : "sm:col-span-3"}>
              <label htmlFor="social-target-input" className="mb-1 block text-xs font-medium text-slate-400">
                {socialPlatform === "instagram" && "Instagram Username or Profile URL"}
                {socialPlatform === "linkedin" && "Company Name"}
                {socialPlatform === "twitter" && "Twitter / X Handle (e.g. realtordotcom)"}
                {socialPlatform === "sherlock" && "Username or Brand Handle to Find across 400+ Sites"}
              </label>
              <input
                id="social-target-input"
                name="social-target-input"
                aria-label="Social media target input"
                value={socialTarget}
                onChange={(e) => setSocialTarget(e.target.value)}
                placeholder={
                  socialPlatform === "instagram"
                    ? "e.g. starbucks or https://instagram.com/starbucks"
                    : socialPlatform === "linkedin"
                    ? "e.g. Blue Tokai Coffee Roasters or CBRE Real Estate"
                    : socialPlatform === "twitter"
                    ? "e.g. Zillow or realtordotcom"
                    : "e.g. bluetokaicoffee"
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {socialPlatform === "linkedin" && (
              <div>
                <label htmlFor="social-loc-input" className="mb-1 block text-xs font-medium text-slate-400">
                  Location Filter (optional)
                </label>
                <input
                  id="social-loc-input"
                  name="social-loc-input"
                  aria-label="Location filter"
                  value={socialLocation}
                  onChange={(e) => setSocialLocation(e.target.value)}
                  placeholder="e.g. Mumbai, India or New York"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={socialMut.isPending || !socialTarget.trim()}
              onClick={() => socialMut.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {socialMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scraping Social Data…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Run Social Lookup
                </>
              )}
            </button>
          </div>

          {socialError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-200">
              {socialError}
            </div>
          )}

          {socialResult && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Scraped Social Result
                </span>
                <span className="text-[11px] text-slate-400">Live JSON response</span>
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-200">
                {typeof socialResult === "string" ? socialResult : JSON.stringify(socialResult, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* ======================================================== */}
      {/* 2. DIRECT WEBSITE ENRICHER VIEW                          */}
      {/* ======================================================== */}
      {targetSource === "website" && (
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">
              Website & Contact Lead Enricher
            </h3>
            <span className="text-xs text-slate-400">
              Powered by Crawl4AI + Fast Contact Extractor
            </span>
          </div>

          <div>
            <label htmlFor="website-url-input" className="mb-1 block text-xs font-medium text-slate-400">
              Website Domain or URL
            </label>
            <input
              id="website-url-input"
              name="website-url-input"
              aria-label="Website URL to enrich"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="e.g. https://www.cbre.com or https://bluetokaicoffee.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-4 pt-1">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Contact Emails</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Phone Numbers</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>WhatsApp Chat Links</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Social Profiles</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={websiteMut.isPending || !websiteUrl.trim()}
              onClick={() => websiteMut.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {websiteMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enriching Leads…
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4" />
                  Enrich Website Leads
                </>
              )}
            </button>
          </div>

          {websiteError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-200">
              {websiteError}
            </div>
          )}

          {websiteResult && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Enriched Contact Details
                </span>
                <span className="text-[11px] text-slate-400">Live JSON response</span>
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-200">
                {typeof websiteResult === "string" ? websiteResult : JSON.stringify(websiteResult, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* ======================================================== */}
      {/* 3. GOOGLE MAPS & MULTI-CHANNEL VIEW                      */}
      {/* ======================================================== */}
      {(targetSource === "maps" || targetSource === "multichannel") && (
        <>
          {targetSource === "multichannel" && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Multi-Channel Mode Active:</strong> Scrapes Google Maps local businesses, then automatically crawls their websites for verified contact emails, WhatsApp numbers, and discovers their social profiles!
              </span>
            </div>
          )}

          {/* Mode Presets */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Quick Scrape Mode
              </h2>
              <span className="text-xs text-slate-400">
                One click sets email, phone filter & output columns
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                {
                  id: "phone_only" as const,
                  title: "Name & Phone Only",
                  desc: "Fastest: skips emails & socials, keeps phone leads",
                  icon: Phone,
                },
                {
                  id: "standard" as const,
                  title: "Full Outreach",
                  desc: "8 lead fields + email crawl + socials",
                  icon: Sparkles,
                },
                {
                  id: "no_website" as const,
                  title: "No Website Leads",
                  desc: "Only businesses missing a website",
                  icon: Search,
                },
                {
                  id: "custom" as const,
                  title: "Custom",
                  desc: "Configure every toggle manually",
                  icon: Plus,
                },
              ].map(({ id, title, desc, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                    preset === id
                      ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon className="h-3.5 w-3.5" />
                    {title}
                  </div>
                  <p className="text-[11px] leading-snug text-slate-400">{desc}</p>
                </button>
              ))}
            </div>
          </section>

      {/* What & Where */}
      <section className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5 md:grid-cols-2">
        {/* Keywords */}
        <div className="flex flex-col gap-2">
          <label htmlFor="what-keywords-input" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            What (Business Keywords)
          </label>
          <div className="relative flex gap-2">
            <input
              id="what-keywords-input"
              name="what-keywords-input"
              aria-label="Business Keywords"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword(kwInput);
                }
              }}
              placeholder="e.g. coffee shops, dress shops"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => addKeyword(kwInput)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Add
            </button>

            {filteredSuggestions.length > 0 && (
              <ul className="absolute left-0 right-16 top-11 z-20 max-h-48 overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                {filteredSuggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => addKeyword(s)}
                      className="w-full rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-emerald-500/15"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200"
              >
                {kw}
                <button
                  type="button"
                  onClick={() =>
                    setKeywords((prev) => prev.filter((k) => k !== kw))
                  }
                  className="text-emerald-300 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Cities */}
        <div className="flex flex-col gap-2">
          <label htmlFor="where-cities-input" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Where (Cities / Areas)
          </label>
          <div className="relative flex gap-2">
            <input
              id="where-cities-input"
              name="where-cities-input"
              aria-label="Cities and Areas"
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleLookupCity();
                }
              }}
              placeholder="e.g. Navi Mumbai, India or Thane"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleLookupCity}
              disabled={searchingCity}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              {searchingCity ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapPin className="h-3.5 w-3.5" />
              )}
              Find
            </button>
            <button
              type="button"
              onClick={addRawCity}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-700"
              title="Add city name as typed without pre-lookup"
            >
              +Raw
            </button>

            {cityMatches.length > 0 && (
              <ul className="absolute left-0 right-0 top-11 z-20 max-h-56 overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                {cityMatches.map((m, i) => (
                  <li key={`${m.label}-${i}`}>
                    <button
                      type="button"
                      onClick={() => addCity(m)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-emerald-500/15"
                    >
                      <span className="truncate">{m.label}</span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">
                        {Number(m.lat).toFixed(3)}, {Number(m.lon).toFixed(3)} ({m.source})
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {cities.length === 0 && (
              <span className="text-xs text-slate-500">
                Optional if area is inside your keyword, or search & add cities above.
              </span>
            )}
            {cities.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-200"
              >
                <span className="max-w-[200px] truncate">{c.label}</span>
                {c.lat && c.lon && (
                  <span className="font-mono text-[10px] text-sky-300/75">
                    {Number(c.lat).toFixed(2)},{Number(c.lon).toFixed(2)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setCities((prev) => prev.filter((x) => x.label !== c.label))
                  }
                  className="text-sky-300 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Collect, Columns & Export */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap gap-3">
          {[
            {
              label: "Collect Emails",
              checked: collectEmails,
              set: (v: boolean) => {
                setCollectEmails(v);
                setPreset("custom");
              },
            },
            {
              label: "Collect Socials",
              checked: collectSocials,
              set: (v: boolean) => {
                setCollectSocials(v);
                setPreset("custom");
              },
            },
            {
              label: "Must Have Phone",
              checked: hasPhone,
              set: (v: boolean) => {
                setHasPhone(v);
                setPreset("custom");
              },
            },
            {
              label: "No Website Only",
              checked: noWebsite,
              set: (v: boolean) => {
                setNoWebsite(v);
                setPreset("custom");
              },
            },
            {
              label: "Verify Email MX",
              checked: verifyEmails,
              set: setVerifyEmails,
            },
            {
              label: "Playwright JS Sites",
              checked: browserSites,
              set: setBrowserSites,
            },
            {
              label: "Tech & Intent Score",
              checked: tech,
              set: setTech,
            },
          ].map((opt, idx) => {
            const optId = `preset-opt-${idx}`;
            return (
              <label
                key={opt.label}
                htmlFor={optId}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-700"
              >
                <input
                  id={optId}
                  name={optId}
                  type="checkbox"
                  checked={opt.checked}
                  onChange={(e) => opt.set(e.target.checked)}
                  className="accent-emerald-500"
                />
                {opt.label}
              </label>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fields-mode-select" className="mb-1 block text-xs font-medium text-slate-400">
              Output Columns
            </label>
            <select
              id="fields-mode-select"
              name="fields-mode-select"
              aria-label="Output Columns"
              value={fieldsMode}
              onChange={(e) => {
                setFieldsMode(e.target.value as "phone_only" | "lead8" | "all");
                setPreset("custom");
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="phone_only">Name & Phone Only (title, phone)</option>
              <option value="lead8">Standard 8 Lead Fields</option>
              <option value="all">All Raw Columns (36+ fields)</option>
            </select>
          </div>
          <div>
            <label htmlFor="out-filename-input" className="mb-1 block text-xs font-medium text-slate-400">
              Output CSV Filename (optional)
            </label>
            <input
              id="out-filename-input"
              name="out-filename-input"
              aria-label="Output CSV Filename"
              value={outFilename}
              onChange={(e) => setOutFilename(e.target.value)}
              placeholder="e.g. navi-mumbai-thane-leads.csv"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white"
          >
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            Advanced Options (Depth, Country, Grid, Proxies)
          </button>

          {showAdvanced && (
            <div className="mt-3 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-3">
              <div>
                <label htmlFor="adv-depth-input" className="mb-1 block text-xs text-slate-400">
                  Depth (~20 places/step)
                </label>
                <input
                  id="adv-depth-input"
                  name="adv-depth-input"
                  aria-label="Depth"
                  type="number"
                  min={1}
                  max={1000}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value) || 5)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="adv-country-input" className="mb-1 block text-xs text-slate-400">
                  Country (2-letter, e.g. in)
                </label>
                <input
                  id="adv-country-input"
                  name="adv-country-input"
                  aria-label="Country"
                  maxLength={2}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="auto"
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="adv-lang-input" className="mb-1 block text-xs text-slate-400">
                  Language (2-letter)
                </label>
                <input
                  id="adv-lang-input"
                  name="adv-lang-input"
                  aria-label="Language"
                  maxLength={2}
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="adv-maxtime-input" className="mb-1 block text-xs text-slate-400">
                  Max Time (seconds)
                </label>
                <input
                  id="adv-maxtime-input"
                  name="adv-maxtime-input"
                  aria-label="Max Time in seconds"
                  type="number"
                  min={30}
                  max={86400}
                  value={maxTime}
                  onChange={(e) => setMaxTime(Number(e.target.value) || 600)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="adv-reviews-input" className="mb-1 block text-xs text-slate-400">
                  Reviews per place (0-5)
                </label>
                <input
                  id="adv-reviews-input"
                  name="adv-reviews-input"
                  aria-label="Reviews per place"
                  type="number"
                  min={0}
                  max={5}
                  value={reviewsMax}
                  onChange={(e) => setReviewsMax(Number(e.target.value) || 0)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="adv-grid-input" className="mb-1 block text-xs text-slate-400">
                  Grid N x N (optional, 1-10)
                </label>
                <input
                  id="adv-grid-input"
                  name="adv-grid-input"
                  aria-label="Grid size"
                  type="number"
                  min={1}
                  max={10}
                  value={grid}
                  onChange={(e) => setGrid(e.target.value)}
                  placeholder="off"
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100"
                />
              </div>
              <label htmlFor="adv-deepscan-checkbox" className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300 sm:col-span-3">
                <input
                  id="adv-deepscan-checkbox"
                  name="adv-deepscan-checkbox"
                  type="checkbox"
                  checked={deepScan}
                  onChange={(e) => setDeepScan(e.target.checked)}
                  className="accent-emerald-500"
                />
                Deep Scan (splits saturated grid tiles into 4 sub-tiles)
              </label>
              <div className="sm:col-span-3">
                <label htmlFor="adv-proxies-input" className="mb-1 block text-xs text-slate-400">
                  Proxies (one URL per line, optional)
                </label>
                <textarea
                  id="adv-proxies-input"
                  name="adv-proxies-input"
                  aria-label="Proxies list"
                  rows={2}
                  value={proxiesText}
                  onChange={(e) => setProxiesText(e.target.value)}
                  placeholder="http://user:pass@host:port"
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
              </div>
            </div>
          )}
        </div>

        {confirmLarge && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>
                Large job heads-up: high depth, grids, or many keywords take longer
                and may trigger temporary Google IP rate limits. Click{" "}
                <strong>Confirm & Start</strong> to proceed.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmLarge(false)}
                className="rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => scrapeMut.mutate()}
                className="rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-500"
              >
                Confirm & Start
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {keywords.length} keyword(s) ·{" "}
            {cities.length ? `${cities.length} city/cities` : "keyword-based area"}
          </span>
          <button
            type="button"
            disabled={scrapeMut.isPending || jobSubmitted || keywords.length === 0}
            onClick={handleStart}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {scrapeMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : jobSubmitted ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Start Scrape
              </>
            )}
          </button>
        </div>
      </section>
      </>
      )}

      {/* Live Progress */}
      {(scrapeMut.isPending || jobSubmitted || progressList.length > 0) && (
        <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Live Scrape Progress
          </h3>
          {progressList.length === 0 && (
            <p className="text-xs text-slate-400">
              {scrapeMut.isPending
                ? "Starting engine / geocoding cities…"
                : "Job submitted — waiting for first progress event…"}
            </p>
          )}
          {progressList.map((p) => (
            <div
              key={p.jobId}
              className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
            >
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200">
                  {p.cityLabel || p.jobId.slice(0, 8)} ·{" "}
                  <span className="text-emerald-400">{p.stage || p.status}</span>
                </span>
                <span className="font-mono text-slate-400">
                  kw {p.keywordsDone}/{p.keywordsTotal} · {p.places} places ({p.percent}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(2, p.percent))}%` }}
                />
              </div>
              {p.error && (
                <p className="mt-1.5 text-xs text-amber-300">{p.error}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Error / Completion */}
      {scrapeMut.error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          {formatError(scrapeMut.error)}
        </div>
      )}

      {lastResult && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <div>
            <h3 className="text-sm font-semibold text-emerald-200">
              Scrape Complete — {lastResult.exportedRows} exported rows ({lastResult.totalPlaces} places found)
            </h3>
            {lastResult.exportedCsvPath && (
              <p className="mt-0.5 font-mono text-xs text-emerald-300/80">
                {lastResult.exportedCsvPath}
              </p>
            )}
            {lastResult.warnings.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4 text-xs text-amber-200">
                {lastResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          {lastResult.exportedCsvPath && (
            <button
              type="button"
              onClick={() =>
                openCsvInViewer(
                  lastResult.exportedCsvPath!,
                  lastResult.warnings.join(" | ") || null,
                )
              }
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <FolderOpen className="h-4 w-4" />
              Open CSV in Viewer
            </button>
          )}
        </section>
      )}
    </div>
  );
}

