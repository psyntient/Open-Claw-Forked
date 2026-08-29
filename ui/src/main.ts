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
async function installPsyntientOnboardingGate() {
  const CACHE_KEY = "psyntient-onboarding-complete";
  try {
    if (sessionStorage.getItem(CACHE_KEY) === "1") {
      return;
    }
  } catch {
    // Private mode or blocked storage: fall through and just ask the gateway.
  }

  const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let status: { hasProvider?: boolean; isPaired?: boolean; completed?: boolean };
  try {
    const res = await fetch("/__openclaw__/psyntient/onboarding", { headers });
    if (!res.ok) {
      return; // Routes unavailable (plain OpenClaw gateway): never block the app.
    }
    status = await res.json();
  } catch {
    return;
  }

  if (status.hasProvider && status.isPaired && status.completed) {
    try {
      sessionStorage.setItem(CACHE_KEY, "1");
    } catch {
      // Cache is an optimisation, not a requirement.
    }
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
