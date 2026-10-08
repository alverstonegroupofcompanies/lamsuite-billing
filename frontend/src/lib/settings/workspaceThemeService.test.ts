import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  applyWorkspaceTheme,
  applyWorkspaceDensity,
  applyWorkspaceFontSize,
  applyWorkspaceSettings,
  getCachedWorkspaceSettings,
  initWorkspaceSettings,
  clearWorkspaceMemoryCache,
} from "./workspaceThemeService";

describe("Workspace Theme & Appearance Service", () => {
  let mockDocElement: any;

  beforeEach(() => {
    clearWorkspaceMemoryCache();

    const classes = new Set<string>();
    const attributes: Record<string, string> = {};

    mockDocElement = {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
      setAttribute: (k: string, v: string) => {
        attributes[k] = v;
      },
      getAttribute: (k: string) => attributes[k] || null,
      removeAttribute: (k: string) => {
        delete attributes[k];
      },
      style: {
        colorScheme: "light",
      },
    };

    (globalThis as any).document = {
      documentElement: mockDocElement,
    };
  });

  afterEach(() => {
    delete (globalThis as any).document;
  });

  it("applies dark and light theme classes correctly to root element", () => {
    applyWorkspaceTheme("dark");
    expect(mockDocElement.classList.contains("dark")).toBe(true);
    expect(mockDocElement.style.colorScheme).toBe("dark");

    applyWorkspaceTheme("light");
    expect(mockDocElement.classList.contains("dark")).toBe(false);
    expect(mockDocElement.style.colorScheme).toBe("light");
  });

  it("applies density attribute to document element", () => {
    applyWorkspaceDensity("compact");
    expect(mockDocElement.getAttribute("data-density")).toBe("compact");

    applyWorkspaceDensity("comfortable");
    expect(mockDocElement.getAttribute("data-density")).toBe("comfortable");
  });

  it("applies font size attribute to document element", () => {
    applyWorkspaceFontSize("sm");
    expect(mockDocElement.getAttribute("data-font-size")).toBe("sm");

    applyWorkspaceFontSize("lg");
    expect(mockDocElement.getAttribute("data-font-size")).toBe("lg");
  });

  it("persists workspace settings and retrieves them", () => {
    applyWorkspaceSettings({
      theme: "dark",
      density: "compact",
      fontSize: "lg",
      defaultLandingPage: "pos",
    });

    const cached = getCachedWorkspaceSettings();
    expect(cached.theme).toBe("dark");
    expect(cached.density).toBe("compact");
    expect(cached.fontSize).toBe("lg");
    expect(cached.defaultLandingPage).toBe("pos");
  });

  it("initializes workspace settings on boot", () => {
    applyWorkspaceSettings({
      theme: "dark",
      density: "compact",
      fontSize: "sm",
    });

    initWorkspaceSettings();
    expect(mockDocElement.classList.contains("dark")).toBe(true);
    expect(mockDocElement.getAttribute("data-density")).toBe("compact");
    expect(mockDocElement.getAttribute("data-font-size")).toBe("sm");
  });
});
