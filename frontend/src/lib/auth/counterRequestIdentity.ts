import { getCandidateApiUrls, getResolvedApiBaseUrl } from "../../config/env";

/**
 * PRF-003 — every call the till makes names the counter making it.
 *
 * The profile is applied by the server, so the server has to know which
 * counter is asking. The claim, context, sequence and sync paths already send
 * `X-Device-Token`; the older terminal routes (billing, bills, held bills,
 * settings, stock, reports) only ever named a store, so a profile could not
 * reach them. Signing the request here puts the counter in front of those
 * routes without rewriting every service.
 *
 * Two things are deliberately left alone:
 *  - `/api/admin/*` — an owner's console, answered by a person. Where the till
 *    needs one of those it has a `/api/till/*` twin (A16b), and handing a
 *    device token to admin routes would quietly widen what a counter reaches.
 *  - any request that already carries a device token, and any host that is not
 *    this counter's own server — a LAN peer must never be given our credential.
 */

let installed = false;
let signed: Record<string, string> = {};
let signedAt = 0;

/** The token lives in this machine's own vault; re-reading it per call is waste. */
const RESIGN_AFTER_MS = 15_000;

export function installCounterRequestIdentity(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }

  installed = true;

  const native = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isCounterScoped(input)) {
      return native(input as RequestInfo, init);
    }

    const identity = await deviceHeaders();

    if (!identity["X-Device-Token"] || sendsDeviceToken(input, init)) {
      return native(input as RequestInfo, init);
    }

    return native(...withIdentity(input, init, identity));
  }) as typeof window.fetch;
}

/** Called when the counter this machine works for changes, or is let go. */
export function resetCounterRequestIdentity(): void {
  signed = {};
  signedAt = 0;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.toString() : input.url;
}

function isCounterScoped(input: RequestInfo | URL): boolean {
  let target: URL;

  try {
    target = new URL(urlOf(input), window.location.origin);
  } catch {
    return false;
  }

  if (!target.pathname.startsWith("/api/") || target.pathname.startsWith("/api/admin/")) {
    return false;
  }

  return ourOrigins().includes(target.origin);
}

function ourOrigins(): string[] {
  const origins: string[] = [window.location.origin];

  for (const candidate of [getResolvedApiBaseUrl(), ...getCandidateApiUrls()]) {
    try {
      origins.push(new URL(candidate).origin);
    } catch {
      // A half-configured base URL is not a server to hand a credential to.
    }
  }

  return Array.from(new Set(origins));
}

async function deviceHeaders(): Promise<Record<string, string>> {
  if (signed["X-Device-Token"] && Date.now() - signedAt < RESIGN_AFTER_MS) {
    return signed;
  }

  const { storeDeviceService } = await import("./storeDeviceService");

  signed = await storeDeviceService.getDeviceAuthHeaders();
  // An unsigned read is a machine that has not claimed a counter yet; caching
  // it would keep the till anonymous for the whole window after a claim.
  signedAt = signed["X-Device-Token"] ? Date.now() : 0;

  return signed;
}

function sendsDeviceToken(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.headers) {
    return headerNames(init.headers).includes("x-device-token");
  }

  if (typeof input !== "string" && !(input instanceof URL)) {
    return headerNames(input.headers).includes("x-device-token");
  }

  return false;
}

function headerNames(source: HeadersInit): string[] {
  if (source instanceof Headers) {
    const names: string[] = [];

    source.forEach((_value, name) => names.push(name.toLowerCase()));

    return names;
  }

  if (Array.isArray(source)) {
    return source.map(([name]) => name.toLowerCase());
  }

  return Object.keys(source).map((name) => name.toLowerCase());
}

/**
 * Only the keys the caller left unset are added: a service that named its own
 * store or device header meant it.
 */
function withIdentity(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  identity: Record<string, string>
): [RequestInfo, RequestInit] {
  const base: Record<string, string> = {};

  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, name) => {
        base[name] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [name, value] of init.headers) {
        base[name] = value;
      }
    } else {
      Object.assign(base, init.headers);
    }
  } else if (typeof input !== "string" && !(input instanceof URL)) {
    input.headers.forEach((value, name) => {
      base[name] = value;
    });
  }

  const taken = Object.keys(base).map((name) => name.toLowerCase());

  for (const [name, value] of Object.entries(identity)) {
    if (!taken.includes(name.toLowerCase())) {
      base[name] = value;
    }
  }

  if (typeof input !== "string" && !(input instanceof URL)) {
    // A Request carries its own method and body; only the headers change.
    return [new Request(input, { headers: base }) as unknown as RequestInfo, {}];
  }

  return [input as RequestInfo, { ...(init ?? {}), headers: base }];
}
