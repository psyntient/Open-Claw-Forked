import { html, nothing } from "lit";
import "./psyntient-project-select.ts";
import type { GatewayControlUiPluginTab } from "../api/gateway.ts";
import {
  serializeSidebarEntry,
  type NavigationRouteId,
  type SidebarZoneEntry,
} from "../app-navigation.ts";
import { pathForRoute } from "../app-route-paths.ts";
import { readPresenceEntries, resolveCurrentSelfUser } from "../app/user-profile.ts";
import { t } from "../i18n/index.ts";
import { pluginTabKey } from "../pages/plugin/route.ts";
import { renderSidebarPluginTab, shouldHandleNavigationClick } from "./app-sidebar-nav-menus.ts";
import type { AppSidebarSessionNavigationElement } from "./app-sidebar-session-navigation.ts";
import type { SidebarRecentSession } from "./app-sidebar-session-types.ts";
import type { SidebarWorkboardBoard } from "./app-sidebar-workboard.ts";
import { icons } from "./icons.ts";

type AppSidebarRenderHost = AppSidebarSessionNavigationElement & {
  /** Declared here because it lives on AppSidebar, not the navigation base. */
  toggleSection(sectionId: string): void;
  activePluginTabId: string;
  activeWorkboardBoardId: string;
  offline: boolean;
  onOpenApprovals?: () => void;
  getRouteSessionKey(): string;
  renderPinnedSidebarSession(session: SidebarRecentSession): unknown;
};

// `authToken` is passed in rather than read off the host: the sidebar's
// `context` is protected, and the Project selector needs a bearer token for the
// gateway plugin route (cookies alone get a 401 there).
export function renderAppSidebarBrand(host: AppSidebarRenderHost, authToken: string | null) {
  // The sidebar action follows gateway availability; collapsed native chrome
  // keeps its separate offline-tolerant ⌘N mirror.
  return html`
    <div class="sidebar-brand">
      <psyntient-project-select .authToken=${authToken}></psyntient-project-select>
      <!-- The agent card and its menu (New agent / What can main do? / Agent
           settings) are removed: Psyntient Node runs exactly one Cortex, and
           Projects are the organising concept. Exposing an agent switcher beside
           a Project selector offered two competing mental models, and "New agent"
           opened the identity editor this product deliberately avoids. -->
      <div class="sidebar-brand__actions">
        <openclaw-tooltip
          .content=${host.connected
            ? t("chat.runControls.newSession")
            : t("chat.runControls.newSessionDisconnected")}
        >
          <button
            class="sidebar-brand__icon sidebar-brand__new-thread"
            type="button"
            @click=${() => host.onOpenNewSession?.(host.expandedAgentId())}
            aria-label=${t("chat.runControls.newSession")}
            ?disabled=${!host.connected}
          >
            ${icons.plus}
          </button>
        </openclaw-tooltip>
      </div>
    </div>
  `;
}

/**
 * Analysis tools: the collapsible section in the slot PAGES used to occupy.
 *
 * A section rather than loose buttons because this is a growing set -- Archive
 * and Vault today, more as features land -- and because these are the only
 * sidebar destinations that are not a conversation, so they want a boundary
 * around them rather than sitting loose above Threads.
 *
 * Collapse state uses the same toggle plumbing as the session groups below, so
 * it persists and behaves identically. Adding a tool is one entry in TOOLS.
 */
const ANALYSIS_TOOLS_SECTION = "psyntient:analysis-tools";

const TOOLS = [
  { routeId: "archive" as const, icon: "archive" as const, labelKey: "nav.archiveViewer" },
  { routeId: "vault" as const, icon: "database" as const, labelKey: "nav.vaultViewer" },
];

export function renderAppSidebarViewers(host: AppSidebarRenderHost) {
  const collapsed = host.collapsedSessionSections.has(ANALYSIS_TOOLS_SECTION);
  return html`
    <div class="sidebar-tools">
      <button
        type="button"
        class="sidebar-session-group-toggle"
        aria-expanded=${String(!collapsed)}
        @click=${() => host.toggleSection(ANALYSIS_TOOLS_SECTION)}
      >
        <span class="sidebar-recent-sessions__label-text">${t("nav.analysisTools")}</span>
        <span class="sidebar-session-group-toggle__icon" aria-hidden="true"
          >${collapsed ? icons.chevronRight : icons.chevronDown}</span
        >
      </button>
      ${collapsed
        ? nothing
        : html`
            <div class="sidebar-tools__items">
              ${TOOLS.map((tool) => {
                const active = host.activeRouteId === tool.routeId;
                return html`
                  <a
                    href=${pathForRoute(tool.routeId, host.basePath)}
                    class="nav-item nav-item--viewer ${active ? "nav-item--active" : ""}"
                    aria-current=${active ? "page" : nothing}
                    @click=${(event: MouseEvent) => {
                      if (!shouldHandleNavigationClick(event)) {
                        return;
                      }
                      event.preventDefault();
                      host.onNavigate?.(tool.routeId, {});
                    }}
                  >
                    <span class="nav-item__icon" aria-hidden="true">${icons[tool.icon]}</span>
                    <span class="nav-item__text">${t(tool.labelKey)}</span>
                  </a>
                `;
              })}
            </div>
          `}
    </div>
  `;
}

/** Zone 5: product chrome recedes to one slim footer bar. */
export function renderAppSidebarFooterBar(host: AppSidebarRenderHost) {
  const selfUser = resolveCurrentSelfUser({
    snapshotUser: host.sessionDataContext?.gateway.snapshot.selfUser,
    presenceEntries: readPresenceEntries(host.sessionData.presencePayload),
    presenceInstanceId: host.sessionData.presenceInstanceId,
  });
  const selfLabel = selfUser?.name ?? selfUser?.email ?? t("nav.account");
  const avatarUser = {
    ...(selfUser ?? { id: "account", name: selfLabel }),
    watchedSessions: [],
  };
  return html`
    <div class="sidebar-footer-bar">
      <openclaw-tooltip .content=${selfLabel}>
        <button
          type="button"
          class="sidebar-identity-card"
          aria-haspopup="menu"
          aria-expanded=${String(host.sidebarMenus.identityMenuPosition !== null)}
          aria-label=${t("profilePage.identity.menuButtonLabel", { name: selfLabel })}
          @click=${(event: MouseEvent) =>
            host.sidebarMenus.toggleIdentityMenu(event.currentTarget as HTMLElement)}
        >
          <openclaw-viewer-avatar .user=${avatarUser} variant="footer"></openclaw-viewer-avatar>
          <span class="sidebar-identity-card__text">
            <span class="sidebar-identity-card__name">${selfLabel}</span>
            ${host.offline
              ? html`<span class="sidebar-identity-card__subtitle" aria-hidden="true"
                  >${t("connection.reconnecting")}</span
                >`
              : nothing}
          </span>
          <span class="sidebar-identity-card__chevron" aria-hidden="true"
            >${icons.chevronDown}</span
          >
        </button>
      </openclaw-tooltip>
      <span class="sidebar-identity-card__status" role="status" aria-live="polite"
        >${host.offline ? t("connection.reconnecting") : ""}</span
      >
    </div>
  `;
}

export function renderAppSidebarZoneEntry(
  host: AppSidebarRenderHost,
  entry: SidebarZoneEntry,
  sessionRows: ReadonlyMap<string, SidebarRecentSession>,
  workboardRows: ReadonlyMap<string, SidebarWorkboardBoard>,
) {
  if (
    (entry.type === "route" && !host.sidebarMenus.isRouteEnabled(entry.route)) ||
    (entry.type === "workboard" && !host.sidebarMenus.isRouteEnabled("workboard"))
  ) {
    return nothing;
  }
  const serialized = serializeSidebarEntry(entry);
  const dropPosition =
    host.sessionOrganizer.sidebarZoneDropTarget?.entry === serialized
      ? host.sessionOrganizer.sidebarZoneDropTarget.position
      : null;
  const content =
    entry.type === "route"
      ? host.sidebarMenus.renderRoute(entry.route)
      : entry.type === "workboard"
        ? renderWorkboardBoard(host, workboardRows.get(entry.boardId))
        : sessionRows.has(entry.key)
          ? host.renderPinnedSidebarSession(sessionRows.get(entry.key)!)
          : nothing;
  const draggable = entry.type === "route" || entry.type === "workboard";
  return html`
    <div
      class="sidebar-zone-entry ${dropPosition
        ? `sidebar-zone-entry--drop-${dropPosition}`
        : ""} ${host.sessionOrganizer.draggingSidebarEntry === serialized
        ? "sidebar-zone-entry--dragging"
        : ""}"
      data-sidebar-entry=${serialized}
      draggable=${draggable ? "true" : "false"}
      @dragstart=${entry.type === "route"
        ? (event: DragEvent) => host.sessionOrganizer.startSidebarRouteDrag(event, entry.route)
        : entry.type === "workboard"
          ? (event: DragEvent) =>
              host.sessionOrganizer.startSidebarWorkboardDrag(event, entry.boardId)
          : nothing}
      @dragend=${draggable ? () => host.sessionOrganizer.finishSidebarEntryDrag() : nothing}
      @dragover=${(event: DragEvent) =>
        host.sessionOrganizer.handleSidebarZoneDragOver(event, serialized)}
      @drop=${(event: DragEvent) => host.sessionOrganizer.handleSidebarZoneDrop(event, serialized)}
    >
      ${content}
    </div>
  `;
}

export function renderAppSidebarPluginTabEntry(
  host: AppSidebarRenderHost,
  tab: GatewayControlUiPluginTab,
) {
  const ref = { pluginId: tab.pluginId, id: tab.id };
  const key = pluginTabKey(ref);
  return html`
    <div class="sidebar-zone-entry" data-sidebar-entry=${`plugin:${key}`}>
      ${renderSidebarPluginTab({
        tab,
        basePath: host.basePath,
        active: host.activeRouteId === "plugin" && host.activePluginTabId === key,
        onNavigate: (search) => host.onNavigate?.("plugin", { search }),
      })}
    </div>
  `;
}

function renderWorkboardBoard(
  host: AppSidebarRenderHost,
  board: SidebarWorkboardBoard | undefined,
) {
  if (!board) {
    return nothing;
  }
  const active = host.activeRouteId === "workboard" && host.activeWorkboardBoardId === board.id;
  return (
    host.workboardRenderers?.renderEntry({
      board,
      basePath: host.basePath,
      active,
      onNavigate: (pathname) => host.onNavigate?.("workboard", { pathname }),
    }) ?? nothing
  );
}

export function renderAppSidebarAttention(host: AppSidebarRenderHost) {
  return html`<openclaw-sidebar-attention
    .onNavigate=${(routeId: NavigationRouteId) => host.onNavigate?.(routeId)}
    .onOpenApprovals=${() => host.onOpenApprovals?.()}
  ></openclaw-sidebar-attention>`;
}
