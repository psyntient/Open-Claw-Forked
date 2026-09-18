import { pathForRoute } from "../app-route-paths.ts";
import { resolveControlUiBasePath } from "../app/browser.ts";

/**
 * Navigate to an app route, honouring the Control UI base path.
 *
 * `location.href = "/new"` is origin-absolute. On a Node the dashboard IS the
 * origin so it works; under a base path it leaves the application entirely --
 * /workspace/new becomes archive.psyntient.io/new, which is the Archive's own
 * site and not this app. The symptom is that selecting a project appears to do
 * nothing except throw you off the dashboard.
 *
 * The fetch paths were fixed for exactly this reason and these were missed,
 * because a search for the bug looked for URLs being fetched rather than URLs
 * being navigated to.
 */
export function goToRoute(routeId: Parameters<typeof pathForRoute>[0]): void {
  const base = resolveControlUiBasePath(location.pathname);
  location.href = pathForRoute(routeId, base);
}

/** Same, for a route that carries a query string. */
export function goToPath(path: string): void {
  const base = resolveControlUiBasePath(location.pathname);
  location.href = base ? `${base}${path}` : path;
}
