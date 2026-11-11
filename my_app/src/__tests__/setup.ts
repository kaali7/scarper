import "@testing-library/jest-dom/vitest";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  value: 600,
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  value: 1000,
});

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
