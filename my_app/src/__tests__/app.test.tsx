import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../api";
import { AiChat } from "../components/AiChat";
import { DbCsvExplorer } from "../components/DbCsvExplorer";
import { SearchBuilder } from "../components/SearchBuilder";
import { useAppStore } from "../store";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => true),
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
}));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useAppStore.setState({
    activeTab: "search",
    selectedCsvPath: null,
    selectedJobError: null,
    liveProgress: {},
    activeChatId: null,
    chatMessages: [],
    toolStream: [],
  });
});

describe("SearchBuilder", () => {
  test("defaults to Name & Phone Only and runs scrape with phone-only fields", async () => {
    vi.spyOn(api, "listBusinessTypes").mockResolvedValue([
      "Coffee shop",
      "Clothing store",
    ]);
    const scrapeSpy = vi.spyOn(api, "startScrapeJob").mockResolvedValue({
      jobIds: ["job-1"],
      primaryCsvPath: "C:\\kali\\product\\scraper\\.engine\\data\\job-1.csv",
      exportedCsvPath: "C:\\kali\\product\\scraper\\leads.csv",
      exportedRows: 42,
      totalPlaces: 55,
      warnings: [],
    });

    renderWithQuery(<SearchBuilder />);

    const emailCheckbox = screen.getByLabelText("Collect Emails") as HTMLInputElement;
    const phoneCheckbox = screen.getByLabelText("Must Have Phone") as HTMLInputElement;
    expect(emailCheckbox.checked).toBe(false);
    expect(phoneCheckbox.checked).toBe(true);

    fireEvent.click(screen.getByText("Full Outreach"));
    expect(emailCheckbox.checked).toBe(true);
    expect(phoneCheckbox.checked).toBe(false);

    fireEvent.click(screen.getByText("Name & Phone Only"));
    expect(emailCheckbox.checked).toBe(false);
    expect(phoneCheckbox.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Start Scrape/i }));

    await waitFor(() => expect(scrapeSpy).toHaveBeenCalledTimes(1));
    expect(scrapeSpy.mock.calls[0][0]).toMatchObject({
      keywords: ["coffee shops", "dress shops"],
      collectEmails: false,
      collectSocials: false,
      hasPhone: true,
      fields: ["title", "phone"],
    });

    const openBtn = await screen.findByRole("button", {
      name: /Open CSV in Viewer/i,
    });
    fireEvent.click(openBtn);
    expect(useAppStore.getState().activeTab).toBe("explorer");
    expect(useAppStore.getState().selectedCsvPath).toBe(
      "C:\\kali\\product\\scraper\\leads.csv",
    );
  });
});

describe("DbCsvExplorer", () => {
  test("lists jobs.db and workspace CSVs and opens table rows on click", async () => {
    vi.spyOn(api, "listDbJobs").mockResolvedValue([
      {
        id: "530effce-6451-4671-a0f9-e683c6e5972b",
        name: "coffee shops @ Thane, India",
        date: "2026-11-11T08:37:58+00:00",
        status: "ok",
        error: "",
        keywords: ["coffee shops", "dress shops"],
        depth: 5,
        lang: "en",
        country: "in",
        emailEnabled: false,
        socialsEnabled: false,
        places: 160,
        percent: 100,
        stage: "done",
        csvPath:
          "C:\\kali\\product\\scraper\\.engine\\data\\530effce-6451-4671-a0f9-e683c6e5972b.csv",
        csvExists: true,
        csvSizeBytes: 24000,
      },
    ]);
    const firstCsvPath =
      "C:\\kali\\product\\scraper\\navi-mumbai-thane-leads.csv";
    const secondCsvPath =
      "C:\\kali\\product\\scraper\\real-estate-leads.csv";
    vi.spyOn(api, "listCsvFiles").mockResolvedValue([
      {
        name: "navi-mumbai-thane-leads.csv",
        path: firstCsvPath,
        source: "workspace",
        sizeBytes: 5120,
        modifiedMs: 1700000000000,
        rowCount: 177,
        jobId: null,
        jobStatus: null,
      },
      {
        name: "real-estate-leads.csv",
        path: secondCsvPath,
        source: "workspace",
        sizeBytes: 4096,
        modifiedMs: 1600000000000,
        rowCount: 53,
        jobId: null,
        jobStatus: null,
      },
    ]);
    const readSpy = vi
      .spyOn(api, "readCsvTable")
      .mockImplementation(async (path) => ({
        path,
        headers: ["title", "phone"],
        allHeaders: ["title", "phone"],
        rows:
          path === firstCsvPath
            ? [
                ["Cafe 131", "079001 73219"],
                ["Legends Cafe", "083697 25820"],
              ]
            : [["Real Estate Agency", "090000 11111"]],
        totalRows: path === firstCsvPath ? 177 : 53,
        filteredRows: path === firstCsvPath ? 177 : 53,
      }));

    renderWithQuery(<DbCsvExplorer />);

    const csvItems = await screen.findAllByText("navi-mumbai-thane-leads.csv");
    fireEvent.click(csvItems[0]);

    await waitFor(() => expect(readSpy).toHaveBeenCalled());
    expect(await screen.findByText("Cafe 131")).toBeInTheDocument();
    expect(screen.getByText("079001 73219")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /real-estate-leads\.csv/i }));
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(
      secondCsvPath,
      expect.objectContaining({ maxRows: 5000 }),
    ));
    expect(await screen.findByText("Real Estate Agency")).toBeInTheDocument();
    expect(useAppStore.getState().selectedCsvPath).toBe(secondCsvPath);

    fireEvent.click(screen.getByRole("button", { name: "Has Phone" }));
    await waitFor(() =>
      expect(readSpy).toHaveBeenLastCalledWith(
        secondCsvPath,
        expect.objectContaining({ hasPhone: true }),
      ),
    );
  });

  test("switches between multiple jobs in dbJobs when clicked", async () => {
    const jobRealEstate = {
      id: "job-re",
      name: "Real Estate Agents",
      date: "2026-11-14T16:22:56+00:00",
      status: "ok",
      error: "",
      keywords: ["Real Estate Agents"],
      depth: 1,
      lang: "en",
      country: "",
      emailEnabled: false,
      socialsEnabled: false,
      places: 62,
      percent: 100,
      stage: "done",
      csvPath: "C:\\kali\\product\\scraper\\.engine\\data\\job-re.csv",
      csvExists: true,
      csvSizeBytes: 138000,
    };
    const jobCoffee = {
      id: "job-coffee",
      name: "coffee shops",
      date: "2026-11-14T15:25:41+00:00",
      status: "ok",
      error: "",
      keywords: ["coffee shops"],
      depth: 1,
      lang: "en",
      country: "",
      emailEnabled: false,
      socialsEnabled: false,
      places: 73,
      percent: 100,
      stage: "done",
      csvPath: "C:\\kali\\product\\scraper\\.engine\\data\\job-coffee.csv",
      csvExists: true,
      csvSizeBytes: 177000,
    };

    vi.spyOn(api, "listDbJobs").mockResolvedValue([jobRealEstate, jobCoffee]);
    vi.spyOn(api, "listCsvFiles").mockResolvedValue([]);
    const readSpy = vi.spyOn(api, "readCsvTable").mockImplementation(async (path) => ({
      path,
      headers: ["title", "phone"],
      allHeaders: ["title", "phone"],
      rows: path.includes("job-re")
        ? [["ITS Properties Consultant", "088797 87778"]]
        : [["abcoffee Airoli Sector 6", "099999 88888"]],
      totalRows: path.includes("job-re") ? 62 : 73,
      filteredRows: path.includes("job-re") ? 62 : 73,
    }));

    // Initially selected: Real Estate
    useAppStore.setState({
      selectedJobId: "job-re",
      selectedCsvPath: jobRealEstate.csvPath,
    });

    renderWithQuery(<DbCsvExplorer />);

    expect(await screen.findByText("ITS Properties Consultant")).toBeInTheDocument();

    // Click coffee shops card
    const coffeeCard = screen.getByText("coffee shops");
    fireEvent.click(coffeeCard);

    await waitFor(() => {
      expect(useAppStore.getState().selectedJobId).toBe("job-coffee");
      expect(useAppStore.getState().selectedCsvPath).toBe(jobCoffee.csvPath);
    });

    expect(await screen.findByText("abcoffee Airoli Sector 6")).toBeInTheDocument();
    expect(readSpy).toHaveBeenCalled();
  });

  test("deletes an individual job and clears failed jobs via inline confirm", async () => {
    vi.spyOn(api, "listDbJobs").mockResolvedValue([
      {
        id: "530effce-6451-4671-a0f9-e683c6e5972b",
        name: "coffee shops @ Thane, India",
        date: "2026-11-11T08:37:58+00:00",
        status: "ok",
        error: "",
        keywords: ["coffee shops"],
        depth: 5,
        lang: "en",
        country: "in",
        emailEnabled: false,
        socialsEnabled: false,
        places: 160,
        percent: 100,
        stage: "done",
        csvPath:
          "C:\\kali\\product\\scraper\\.engine\\data\\530effce-6451-4671-a0f9-e683c6e5972b.csv",
        csvExists: true,
        csvSizeBytes: 24000,
      },
      {
        id: "6937bd0f-9655-4141-8b3c-4dee20980534",
        name: "coffee shops in Austin TX @ Austin, TX",
        date: "2026-11-10T16:01:50+00:00",
        status: "failed",
        error: "no Page.loadEventFired event within 45 s",
        keywords: ["coffee shops"],
        depth: 2,
        lang: "en",
        country: "",
        emailEnabled: false,
        socialsEnabled: false,
        places: 0,
        percent: 0,
        stage: "failed",
        csvPath:
          "C:\\kali\\product\\scraper\\.engine\\data\\6937bd0f-9655-4141-8b3c-4dee20980534.csv",
        csvExists: true,
        csvSizeBytes: 395,
      },
    ]);
    vi.spyOn(api, "listCsvFiles").mockResolvedValue([]);
    const deleteSpy = vi.spyOn(api, "deleteDbJob").mockResolvedValue();
    const clearSpy = vi.spyOn(api, "clearDbJobs").mockResolvedValue(1);

    renderWithQuery(<DbCsvExplorer />);

    const deleteIcon = await screen.findByRole("button", {
      name: "Delete job coffee shops @ Thane, India",
    });
    fireEvent.click(deleteIcon);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith(
        "530effce-6451-4671-a0f9-e683c6e5972b",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Failed" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(true));
  });

  test("shows stopped badge and Restart Job action for incomplete working jobs when engine is stopped", async () => {
    vi.spyOn(api, "getEngineStatus").mockResolvedValue({
      running: false,
      managedByApp: false,
      foreignPortBusy: false,
      port: 8080,
      url: "http://127.0.0.1:8080",
      engineVersion: null,
      python: null,
      chromePath: null,
    });
    vi.spyOn(api, "listDbJobs").mockResolvedValue([
      {
        id: "c399598b-38d2-451b-85ab-56ee2b28bc6d",
        name: "Medical Spas",
        date: "2026-11-12T07:30:26+00:00",
        status: "working",
        error: "",
        keywords: ["Medical Spas", "Dentists"],
        depth: 5,
        lang: "en",
        country: "",
        emailEnabled: false,
        socialsEnabled: false,
        places: 20,
        percent: 10,
        stage: "scraping",
        csvPath:
          "C:\\kali\\product\\scraper\\.engine\\data\\c399598b-38d2-451b-85ab-56ee2b28bc6d.csv",
        csvExists: false,
        csvSizeBytes: 0,
      },
    ]);
    vi.spyOn(api, "listCsvFiles").mockResolvedValue([]);
    const restartSpy = vi
      .spyOn(api, "restartDbJob")
      .mockResolvedValue("c399598b-38d2-451b-85ab-56ee2b28bc6d");

    renderWithQuery(<DbCsvExplorer />);

    await waitFor(() =>
      expect(screen.getAllByText("Medical Spas")[0]).toBeInTheDocument(),
    );
    expect(screen.getAllByText("stopped")[0]).toBeInTheDocument();
    expect(screen.queryByText("working")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Medical Spas")[0]);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Restart Job" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart Job" }));

    await waitFor(() =>
      expect(restartSpy).toHaveBeenCalledWith(
        "c399598b-38d2-451b-85ab-56ee2b28bc6d",
      ),
    );
  });

  test("shows live progress and pending metrics when clicking a working job", async () => {
    vi.spyOn(api, "getEngineStatus").mockResolvedValue({
      running: true,
      managedByApp: true,
      foreignPortBusy: false,
      port: 8080,
      url: "http://127.0.0.1:8080",
      engineVersion: "1.0",
      python: null,
      chromePath: null,
    });
    vi.spyOn(api, "listDbJobs").mockResolvedValue([
      {
        id: "live-job-123",
        name: "coffee shops",
        date: "2026-11-14T09:55:00.000Z",
        status: "working",
        error: "",
        keywords: ["coffee shops", "cafes"],
        depth: 2,
        lang: "en",
        country: "in",
        emailEnabled: false,
        socialsEnabled: false,
        places: 24,
        percent: 60,
        stage: "detail",
        csvPath: "C:\\kali\\product\\scraper\\.engine\\jobs\\live-job-123.csv",
        csvExists: false,
        csvSizeBytes: 0,
      },
    ]);
    vi.spyOn(api, "listCsvFiles").mockResolvedValue([]);

    renderWithQuery(<DbCsvExplorer />);

    expect(
      await screen.findByText(/Scrape Running in Background/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /View Live Progress/i }));

    await waitFor(() =>
      expect(screen.getByText("Live Scraping In Progress")).toBeInTheDocument(),
    );
    expect(screen.getByText("60% Done")).toBeInTheDocument();
    expect(screen.getByText("40% Pending")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("Places Scraped")).toBeInTheDocument();
  });
});

describe("AiChat", () => {
  test("warns when Groq key is missing and handles tool-calling response with CSV artifact", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue({
      config: {
        kitRoot: "C:\\kali\\product\\scraper",
        pythonOverride: null,
        groqModel: "qwen/qwen3.8-27b",
      },
      kitEnv: {
        port: 8080,
        apiKey: "",
        headless: true,
        navTimeout: 90,
        noUpdateCheck: false,
      },
      hasGroqKey: false,
      groqKeyMasked: "",
    });
    const chatSpy = vi.spyOn(api, "chatWithGroq").mockResolvedValue({
      assistantMessage: "Found 177 businesses with phone numbers.",
      toolTraces: [
        {
          toolName: "run_scrape_job",
          arguments: { keywords: ["coffee shops", "dress shops"] },
          summary: "Scraped 252 total places, exported 177 rows",
          ok: true,
        },
      ],
      artifacts: [
        {
          path: "C:\\kali\\product\\scraper\\navi-mumbai-thane-leads.csv",
          name: "navi-mumbai-thane-leads.csv",
          rowCount: 177,
          columns: ["title", "phone"],
        },
      ],
    });

    renderWithQuery(<AiChat />);

    expect(
      await screen.findByText(/Add your Groq API key in Settings/i),
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText(
      /Type what you want to search or inspect/i,
    );
    fireEvent.change(input, {
      target: {
        value: "search coffee shops in Navi Mumbai, phone only",
      },
    });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => expect(chatSpy).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Found 177 businesses with phone numbers\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Used 1 tool step\(s\)/i)).toBeInTheDocument();

    const artifactBtn = screen.getByRole("button", {
      name: /Open navi-mumbai-thane-leads\.csv \(177 rows\)/i,
    });
    fireEvent.click(artifactBtn);
    expect(useAppStore.getState().activeTab).toBe("explorer");
    expect(useAppStore.getState().selectedCsvPath).toBe(
      "C:\\kali\\product\\scraper\\navi-mumbai-thane-leads.csv",
    );
  });

  test("renders Tauri string rejections instead of Error: undefined", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue({
      config: {
        kitRoot: "C:\\kali\\product\\scraper",
        pythonOverride: null,
        groqModel: "qwen/qwen3.8-27b",
      },
      kitEnv: {
        port: 8080,
        apiKey: "",
        headless: true,
        navTimeout: 90,
        noUpdateCheck: false,
      },
      hasGroqKey: true,
      groqKeyMasked: "gsk_••••••••NhU",
    });
    vi.spyOn(api, "chatWithGroq").mockRejectedValue(
      "Groq API returned HTTP 401: Invalid API Key",
    );

    renderWithQuery(<AiChat />);

    const input = screen.getByPlaceholderText(
      /Type what you want to search or inspect/i,
    );
    fireEvent.change(input, { target: { value: "hey" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(
      await screen.findByText(
        "Error: Groq API returned HTTP 401: Invalid API Key",
      ),
    ).toBeInTheDocument();
  });

  test("loads and switches persistent chat history sessions and starts a new chat", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue({
      config: {
        kitRoot: "C:\\kali\\product\\scraper",
        pythonOverride: null,
        groqModel: "qwen/qwen3.8-27b",
      },
      kitEnv: {
        port: 8080,
        apiKey: "",
        headless: true,
        navTimeout: 90,
        noUpdateCheck: false,
      },
      hasGroqKey: true,
      groqKeyMasked: "gsk_••••••••NhU",
    });
    vi.spyOn(api, "loadChatHistory").mockResolvedValue([
      {
        id: "sess-1",
        title: "Real estate leads",
        updatedAt: 2000,
        messages: [
          {
            id: "u1",
            role: "user",
            content: "Find real estate companies in Navi Mumbai",
            createdAt: 1990,
          },
          {
            id: "a1",
            role: "assistant",
            content: "Found 20 real estate leads.",
            createdAt: 2000,
          },
        ],
      },
      {
        id: "sess-2",
        title: "Dentists in Thane",
        updatedAt: 1000,
        messages: [
          {
            id: "u2",
            role: "user",
            content: "Find dentists in Thane",
            createdAt: 1000,
          },
        ],
      },
    ]);
    const saveSpy = vi.spyOn(api, "saveChatHistory").mockResolvedValue();

    renderWithQuery(<AiChat />);

    expect(
      await screen.findByText("Found 20 real estate leads."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Chat History \(2\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dentists in Thane"));
    expect(
      await screen.findByText("Find dentists in Thane"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
    expect(
      await screen.findByText(/Ask in plain English to search/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Delete chat Real estate leads"));
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
  });
});

