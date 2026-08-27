// Mounts the Noetic Interface's backend routes onto the gateway's plugin
// route registry.
//
// WHY THIS SHIM EXISTS
// The route *logic* lives outside this tree, at
// <NodeRoot>/Noetic_Interface/gateway-plugin/index.js, so it survives an
// OpenClaw update untouched (CLAUDE.md rule 2). Loading it the intended way
// -- `plugins.load.paths` -- was tried first and does not work for this case:
// the plugin loads, `register()` runs with registrationMode "full", and
// `registerHttpRoute` accepts the routes without error, but they never appear
// in the registry the gateway actually serves from, with no diagnostic. A
// bundled plugin's route (canvas, "/__openclaw__/a2ui") answers 401 JSON on
// the same gateway while ours falls through to the Control UI SPA catch-all.
// Rather than keep reverse-engineering that, this pushes the same route
// objects the plugin already produces straight into the serving registry, so
// all of the existing dispatch, auth, and scope machinery still applies.
//
// The `/__openclaw__/` prefix is required, not cosmetic: the SPA catch-all
// answers any ordinary path with index.html before plugin routes are
// consulted.
//
// This file is the ONLY Psyntient code inside the OpenClaw tree. Keep it thin
// -- new endpoints belong in the external plugin module, not here.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginRegistry } from "../plugins/registry.js";

type MinimalRouteInput = {
  path: string;
  auth: "gateway" | "plugin";
  match?: "exact" | "prefix";
  handler: unknown;
};

let mounted = false;

/**
 * Locates the external plugin module.
 *
 * Do NOT count directory levels from process.cwd(): the gateway runs with
 * WorkingDirectory=~/.psyntient/openclaw-state (set by the LaunchAgent), so
 * cwd-relative guesses land in the home directory. Walk up from this module's
 * own location instead, which is inside the OpenClaw checkout regardless of
 * how the bundle is laid out, and stop at whichever ancestor actually holds
 * the Interface. PSYNTIENT_NODE_ROOT overrides everything for installs that
 * put the Node somewhere unusual.
 */
function candidatePaths(): string[] {
  const suffix = path.join("Noetic_Interface", "gateway-plugin", "index.js");
  const candidates: string[] = [];
  const fromEnv = process.env.PSYNTIENT_NODE_ROOT?.trim();
  if (fromEnv) {
    candidates.push(path.join(fromEnv, suffix));
  }
  const seeds = [import.meta.dirname, process.cwd()].filter(
    (seed): seed is string => typeof seed === "string" && seed.length > 0,
  );
  for (const seed of seeds) {
    let dir = seed;
    for (let up = 0; up < 6; up += 1) {
      candidates.push(path.join(dir, suffix));
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return [...new Set(candidates)];
}

/**
 * Idempotent. Never throws: a missing or broken Interface plugin must degrade
 * to "those routes 404", never take the gateway down with it.
 */
export async function ensurePsyntientRoutes(
  registry: PluginRegistry,
  log?: (message: string) => void,
): Promise<void> {
  if (mounted) {
    return;
  }
  mounted = true;
  for (const modPath of candidatePaths()) {
    try {
      const mod = (await import(pathToFileURL(modPath).href)) as {
        default?: { register?: (api: unknown) => void };
      };
      const register = mod.default?.register;
      if (typeof register !== "function") {
        continue;
      }
      const routes = registry.httpRoutes ?? [];
      registry.httpRoutes = routes;
      register({
        registerHttpRoute: (route: MinimalRouteInput) => {
          routes.push({
            pluginId: "psyntient",
            source: modPath,
            match: route.match ?? "exact",
            ...route,
          } as (typeof routes)[number]);
        },
      });
      log?.(`psyntient: mounted ${routes.length} interface route(s) from ${modPath}`);
      return;
    } catch (err) {
      log?.(
        `psyntient: interface plugin not loaded from ${modPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  log?.("psyntient: no interface plugin found; interface routes are unavailable");
}
