import { resolveControlUiBasePath } from "../app/browser.ts";

/**
 * Resolve a Psyntient gateway-plugin route against the Control UI's base path.
 *
 * WHY THIS EXISTS. These routes were written as absolute origin paths
 * ("/__openclaw__/psyntient/projects"), which is correct only when the
 * dashboard is mounted at the origin root — true on a Node and false on a
 * Psyntient Cloud instance, where the shell is served under /workspace and the
 * gateway is a different droplet reached by a prefix-matched proxy rule. There
 * the request went to the Archive's own site instead of the gateway, came back
 * 404, and loadProjectsAndTypes()'s never-throws contract turned that into an
 * empty project list with nothing anywhere saying why.
 *
 * The prefix cannot be dropped at the proxy either: two gateways are served
 * from that host, and a root-level /__openclaw__/ would be ambiguous between
 * the Architect's and the researcher's.
 */
export function psyntientRoute(name: string): string {
  // No SSR guard: every caller is a fetch from a rendered page, and
  // resolveControlUiBasePath already prefers the document's own declaration
  // over the pathname it is handed.
  return `${resolveControlUiBasePath(location.pathname)}/__openclaw__/psyntient/${name}`;
}
