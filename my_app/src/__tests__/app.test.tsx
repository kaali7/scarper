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
    vi.spyOn(api, "listCsvFiles").mockResolvedValue([
      {
        name: "navi-mumbai-thane-leads.csv",
        path: "C:\\kali\\product\\scraper\\navi-mumbai-thane-leads.csv",
        source: "workspace",
        sizeBytes: 5120,
        modifiedMs: 1700000000000,
        rowCount: 177,
        jobId: null,
        jobStatus: null,
      },
    ]);
    const readSpy = vi.spyOn(api, "readCsvTable").mockResolvedValue({
      path: "C:\\kali\\product\\scraper\\navi-mumbai-thane-leads.csv",
      headers: ["title", "phone"],
      allHeaders: ["title", "phone"],
      rows: [
        ["Cafe 131", "079001 73219"],
        ["Legends Cafe", "083697 25820"],
      ],
      totalRows: 177,
      filteredRows: 177,
    });

    renderWithQuery(<DbCsvExplorer />);

    const csvItem = await screen.findByText("navi-mumbai-thane-leads.csv");
    fireEvent.click(csvItem);

    await waitFor(() => expect(readSpy).toHaveBeenCalled());
    expect(await screen.findByText("Cafe 131")).toBeInTheDocument();
    expect(screen.getByText("079001 73219")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Has Phone" }));
    await waitFor(() =>
      expect(readSpy).toHaveBeenLastCalledWith(
        "C:\\kali\\product\\scraper\\navi-mumbai-thane-leads.csv",
        expect.objectContaining({ hasPhone: true }),
      ),
    );
  });
});

describe("AiChat", () => {
  test("warns when Groq key is missing and handles tool-calling response with CSV artifact", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue({
      config: {
        kitRoot: "C:\\kali\\product\\scraper",
        pythonOverride: null,
        groqModel: "llama-3.3-70b-versatile",
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
});

