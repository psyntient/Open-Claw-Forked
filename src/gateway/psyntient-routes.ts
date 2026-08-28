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

/**
 * The shape the plugin hands us. Structural rather than imported: this file is
 * the only Psyntient code inside the OpenClaw tree and stays deliberately thin,
 * and the registry validates the real contract when the tool is used.
 */
type MinimalToolInput = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (...args: never[]) => unknown;
};

// Mounted per REGISTRY, not once per process. `resolvePluginRouteRegistry()`
// can be re-pinned after bootstrap (see server-runtime-state.ts), and a single
// global flag meant the routes were pushed into whichever registry object
// happened to be current on the first request and then stranded there when a
// new one replaced it -- the plugin logs "mounted" while every route falls
// through to the Control UI catch-all and answers HTML. A WeakSet re-mounts
// into each new registry and lets old ones be collected.
const mountedRegistries = new WeakSet<PluginRegistry>();

/** Cached after the first successful import so re-mounting costs no disk work. */
let loadedPlugin: { register: (api: unknown) => void; modPath: string } | null = null;
/** A failed search is not retried on every request; it is a missing file, not a race. */
let loadFailed = false;

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
  if (mountedRegistries.has(registry)) {
    return;
  }
  if (loadedPlugin) {
    mountedRegistries.add(registry);
    mountInto(registry, loadedPlugin.register, loadedPlugin.modPath, log);
    return;
  }
  if (loadFailed) {
    return;
  }
  mountedRegistries.add(registry);
  for (const modPath of candidatePaths()) {
    try {
      const mod = (await import(pathToFileURL(modPath).href)) as {
        default?: { register?: (api: unknown) => void };
      };
      const register = mod.default?.register;
      if (typeof register !== "function") {
        continue;
      }
      // Mount BEFORE caching: if mountInto throws (a plugin calling an api
      // method this shim does not provide), the catch below tries the next
      // candidate rather than caching a plugin that cannot mount.
      mountInto(registry, register, modPath, log);
      loadedPlugin = { register, modPath };
      return;
    } catch (err) {
      log?.(
        `psyntient: interface plugin not loaded from ${modPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  loadFailed = true;
  log?.("psyntient: no interface plugin found; interface routes are unavailable");
}

function mountInto(
  registry: PluginRegistry,
  register: (api: unknown) => void,
  modPath: string,
  log?: (message: string) => void,
): void {
  const routes = registry.httpRoutes ?? [];
  registry.httpRoutes = routes;
  const tools = registry.tools ?? [];
  registry.tools = tools;
  let toolCount = 0;
  register({
    registerHttpRoute: (route: MinimalRouteInput) => {
      routes.push({
        pluginId: "psyntient",
        source: modPath,
        match: route.match ?? "exact",
        ...route,
      } as (typeof routes)[number]);
    },
    // Agent tools go into the same registry the loader fills, so the
    // normal tool plumbing (naming, allowlists, result middleware) applies
    // unchanged. `factory` is what the registry stores -- a function
    // returning the tool -- not the tool object itself.
    //
    // Every capability the plugin uses must be provided here. This object
    // IS the plugin's whole API surface, so a plugin calling anything
    // absent throws during register(), the catch below logs it as "not
    // loaded", and the plugin's ROUTES disappear too -- one missing method
    // takes the entire Interface backend down. That is exactly what
    // happened when registerTool was added to the plugin before this.
    registerTool: (tool: MinimalToolInput) => {
      toolCount += 1;
      tools.push({
        pluginId: "psyntient",
        source: modPath,
        factory: () => tool,
        names: [tool.name],
        optional: false,
      } as (typeof tools)[number]);
    },
  });
  log?.(
    `psyntient: mounted ${routes.length} interface route(s) and ${toolCount} tool(s) from ${modPath}`,
  );
}
