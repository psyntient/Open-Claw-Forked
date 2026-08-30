// Control UI module implements main behavior.
import "./styles.css";
import "./app/app-host.ts";
import { inferControlUiPublicAssetPath } from "./app/public-assets.ts";
import {
  installMissingStylesheetRecovery,
  installStaleChunkReloadListener,
} from "./app/stale-chunk-reload.ts";
import { CONTROL_UI_BUILD_INFO } from "./build-info.ts";

type ViteImportMeta = ImportMeta & {
  readonly env?: {
    readonly PROD?: boolean;
  };
};

const isProd = (import.meta as ViteImportMeta).env?.PROD === true;
const currentControlUiBuildId = CONTROL_UI_BUILD_INFO.buildId;

syncDocumentPublicAssetLinks();
void installPsyntientOnboardingGate();
installStaleChunkReloadListener();
installMissingStylesheetRecovery();

if (isProd && "serviceWorker" in navigator) {
  const swUrl = new URL(inferControlUiPublicAssetPath("sw.js"), window.location.origin);
  swUrl.searchParams.set("v", currentControlUiBuildId);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "sw-updated" && event.data.version !== currentControlUiBuildId) {
      window.location.reload();
    }
  });
  void navigator.serviceWorker.register(swUrl, { updateViaCache: "none" });
} else if (!isProd && "serviceWorker" in navigator) {
  // Unregister any leftover dev SW to avoid stale cache issues.
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) {
      void r.unregister();
    }
  });
}

function syncDocumentPublicAssetLinks() {
  setDocumentLinkHref('link[rel="icon"][type="image/svg+xml"]', "favicon.svg");
  setDocumentLinkHref('link[rel="icon"][type="image/png"]', "favicon-32.png");
  setDocumentLinkHref('link[rel="apple-touch-icon"]', "apple-touch-icon.png");
  setDocumentLinkHref('link[rel="manifest"]', "manifest.webmanifest");
}

function setDocumentLinkHref(
  selector: string,
  asset: Parameters<typeof inferControlUiPublicAssetPath>[0],
) {
  const link = document.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    return;
  }
  link.href = inferControlUiPublicAssetPath(asset);
}

/**
 * Shows the Psyntient onboarding wizard until setup is complete.
 *
 * Mounted here rather than as a route so it does not have to fight the router
 * or the Control UI's own model-setup redirect: it simply replaces the app
 * shell while the Node is unconfigured, and reloads into the real app when the
 * user finishes.
 *
 * The status call is the expensive one (hasAnyProvider shells out to the CLI,
 * ~10s), so the result is cached in sessionStorage. Without that cache a user
 * pays it on every page load -- the same regression the WebClaw build hit.
 * A cached "complete" is never re-checked for the rest of the browser session.
 */
/**
 * The credential the Control UI itself authenticates with.
 *
 * The hash carries a token only on the first load -- the app exchanges it for
 * a per-device operator token, persists that, and strips the hash -- so
 * reading only the hash leaves every later launch unauthenticated. The
 * persisted token is NOT in the settings blob (that holds gatewayUrl and
 * display preferences, no token); it lives under
 * openclaw.device.auth.v1:<gatewayUrl> as tokens.<role>.token.
 */
function deviceToken(): string | null {
  const safe = (value: unknown): string | null =>
    typeof value === "string" && value !== "" && !/[\r\n]/.test(value) ? value : null;

  const fromHash = safe(new URLSearchParams(location.hash.replace(/^#/, "")).get("token"));
  if (fromHash) {
    return fromHash;
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("openclaw.device.auth.v1")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const stored = JSON.parse(raw) as { tokens?: Record<string, { token?: unknown }> };
      for (const entry of Object.values(stored.tokens ?? {})) {
        const token = safe(entry?.token);
        if (token) return token;
      }
    }
  } catch {
    // Blocked or unparseable storage: fall through unauthenticated, which
    // fails open rather than blocking a working app.
  }
  return null;
}

async function installPsyntientOnboardingGate() {
  // The Control UI's own bootstrap config, NOT a Psyntient plugin route.
  //
  // Plugin routes registered `auth: "gateway"` accept only the gateway's
  // shared secret. The browser trades that secret for a per-device operator
  // token at first load and strips it from the URL, precisely so the secret
  // never sits in browser storage -- so this request answered 401 on every
  // launch that did not carry a token in the fragment, and the handler below
  // could not tell that from "this is a plain OpenClaw gateway". A Node with
  // unfinished setup showed no wizard, silently, and a user who reached the
  // app from a bookmark or the installed PWA never saw setup at all.
  //
  // The bootstrap endpoint is served by the handler that DOES accept device
  // tokens, so the credential problem disappears rather than being worked
  // around. It is also computed from two file checks instead of a 10-15s
  // shell-out, which is why no cache is needed here any more.
  let bootstrap: { psyntient?: { onboarding?: string } };
  try {
    // The endpoint accepts the per-device operator token -- but it still
    // REQUIRES one. An earlier version dropped the credential entirely on the
    // reasoning that "the credential problem is gone". It was not: that
    // endpoint had been verified reachable by passing an explicit bearer
    // token, and the conclusion drawn was that no token was needed. Without
    // the header it answers 401, the handler below fails open, and the wizard
    // never appears -- the exact bug this was meant to fix, through a
    // different door.
    //
    // What changed is WHICH credential works: plugin routes want the gateway's
    // shared secret, which the browser deliberately does not keep; this
    // endpoint takes the device token, which it does.
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = deviceToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(controlUiBootstrapConfigPath(), {
      headers,
      credentials: "same-origin",
    });
    if (!res.ok) {
      return; // Cannot ask: never block a working app.
    }
    bootstrap = await res.json();
  } catch {
    return;
  }

  // Absent block = a plain OpenClaw gateway. Only an explicit "pending" gates.
  if (bootstrap.psyntient?.onboarding !== "pending") {
    return;
  }

  // Loaded HERE, not at module top level. Onboarding runs once in an
  // install's life, but a static import puts the whole wizard -- element,
  // styles and its share of the i18n table -- into the startup bundle that
  // every launch pays for afterwards. That is what pushed startup JS past its
  // budget and failed the build.
  await import("./pages/onboarding/onboarding-page.ts");
  document.body.replaceChildren(document.createElement("psyntient-onboarding"));
}

/** The bootstrap endpoint, relative to whatever base path this page was served
 *  under. The default `/__openclaw__/` entry infers its own base path, so a
 *  hardcoded absolute path 404s there. */
function controlUiBootstrapConfigPath(): string {
  const prefix = location.pathname.replace(/\/[^/]*$/, "");
  return `${prefix}/control-ui-config.json`;
}
