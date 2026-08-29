// Control UI module implements public assets behavior.
import { inferBasePathFromPathname, normalizeBasePath } from "../app-route-paths.ts";
import { resolveControlUiBasePath } from "./browser.ts";

type ControlUiPublicAsset =
  // Psyntient brand assets. The union is the allowlist for
  // controlUiPublicAssetPath, so a new public file must be declared here or
  // it fails typecheck (and, under a base path, would resolve wrongly).
  | "psyntient-mark.png"
  | "brand/psyntient-mark-2026.png"
  | "brand/elf/elf-chat-idle-128.png"
  | "apple-touch-icon.png"
  | "favicon-32.png"
  | "favicon.ico"
  | "favicon.svg"
  | "manifest.webmanifest"
  | "sw.js"
  | `provider-icons/ProviderIcon-${string}.svg`
  | `plugin-art/${string}.webp`
  | `app-art/${string}.webp`;

export function controlUiPublicAssetPath(
  asset: ControlUiPublicAsset,
  basePath: string | null | undefined,
): string {
  const base = normalizeBasePath(basePath ?? "");
  return base ? `${base}/${asset}` : `/${asset}`;
}

export function inferControlUiPublicAssetPath(
  asset: ControlUiPublicAsset,
  params?: {
    basePath?: string | null;
    pathname?: string;
  },
): string {
  const basePath =
    params?.basePath ??
    (params?.pathname === undefined
      ? resolveControlUiBasePath(currentPathname())
      : inferBasePathFromPathname(params.pathname));
  return controlUiPublicAssetPath(asset, basePath);
}

function currentPathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname;
}
