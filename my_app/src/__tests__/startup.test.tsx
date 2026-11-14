import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { EngineStatus } from "../types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const STOPPED_STATUS: EngineStatus = {
  running: false,
  managedByApp: false,
  foreignPortBusy: false,
  port: 8080,
  url: "http://127.0.0.1:8080",
  engineVersion: null,
  python: {
    executable: "python",
    version: "Python 3.14.6",
  },
  chromePath: null,
};

const RUNNING_STATUS: EngineStatus = {
  ...STOPPED_STATUS,
  running: true,
  managedByApp: true,
  engineVersion: "0.2.0",
};

function renderApp() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App engine startup behavior", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === "get_engine_status") return STOPPED_STATUS;
      if (cmd === "start_engine") return RUNNING_STATUS;
      if (cmd === "list_business_types") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("keeps the engine stopped on app open until the user clicks Start Engine", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Engine Stopped")).toBeInTheDocument();
    });

    const startCallsBeforeClick = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "start_engine",
    );
    expect(startCallsBeforeClick).toHaveLength(0);

    const startBtn = screen.getByRole("button", { name: /start engine/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "start_engine"),
      ).toHaveLength(1);
    });
  });
});

