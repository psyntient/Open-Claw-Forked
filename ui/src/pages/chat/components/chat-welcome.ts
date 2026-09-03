// Control UI chat module implements chat welcome behavior.
import { html, nothing } from "lit";
import type { GatewaySessionRow, SessionsListResult } from "../../../api/types.ts";
import { t } from "../../../i18n/index.ts";
import "../../../components/openclaw-mascot.ts";
import { resolveAssistantTextAvatar, resolveChatAvatarRenderUrl } from "../../../lib/avatar.ts";
import { formatRelativeTimestamp } from "../../../lib/format.ts";
import { readSelectedProjectId } from "../../../lib/psyntient-projects.ts";
import {
  resolveChannelSessionInfo,
  resolveSessionDisplayName,
  resolveSessionWorkSubtitle,
} from "../../../lib/session-display.ts";
import { getVisibleSessionRows } from "../../../lib/sessions/navigation.ts";
import {
  areUiSessionKeysEquivalent,
  parseAgentSessionKey,
  resolveUiSelectedGlobalAgentId,
  type UiSessionDefaultsHost,
} from "../../../lib/sessions/session-key.ts";

type ChatWelcomeProps = {
  assistantName: string;
  assistantAvatar: string | null;
  assistantAvatarUrl?: string | null;
  /** Hero hint override; defaults to the chat slash-command hint. */
  hint?: unknown;
  /** Rendered between the hero and the recents (the new-session draft composer). */
  composer?: unknown;
  sessions?: SessionsListResult | null;
  sessionKey?: string;
  sessionHost?: UiSessionDefaultsHost | null;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onOpenSession?: (sessionKey: string) => void;
};

type WelcomeMascot = HTMLElement & { tease: boolean; catchOnce: () => void };

// Psyntient starter prompts. Each maps to a capability that is genuinely
// built and documented in Cortex_Agent/CAPABILITIES.md -- research agent,
// memory_search, Vault read, plain chat. Nothing aspirational: a chip that
// suggests something the agent cannot do is worse than no chip.
// Upstream's defaults were operator tasks (configure a channel, check system
// health) for surfaces this product drops.
const WELCOME_SUGGESTION_KEYS = [
  "chat.welcome.suggestions.startResearchProject",
  "chat.welcome.suggestions.searchPastWork",
  "chat.welcome.suggestions.readVault",
  "chat.welcome.suggestions.thinkAloud",
];

const WELCOME_RECENT_SESSION_LIMIT = 5;

function resolveAssistantAvatarUrl(
  props: Pick<ChatWelcomeProps, "assistantAvatar" | "assistantAvatarUrl">,
): string | null {
  return resolveChatAvatarRenderUrl(props.assistantAvatarUrl, {
    identity: {
      avatar: props.assistantAvatar ?? undefined,
      avatarUrl: props.assistantAvatarUrl ?? undefined,
    },
  });
}

export function resolveAssistantDisplayAvatar(
  props: Pick<ChatWelcomeProps, "assistantAvatar" | "assistantAvatarUrl">,
): string | null {
  return resolveAssistantAvatarUrl(props) ?? resolveAssistantTextAvatar(props.assistantAvatar);
}

/**
 * Recent user-created chats for the welcome screen: the sidebar's visible-row
 * rules (no archived/cron/subagent/spawned rows, scoped to the active agent)
 * minus channel-originated sessions — those live in their channel sections and
 * are not something the user "starts" from here.
 */
function selectWelcomeRecentSessions(
  props: Pick<ChatWelcomeProps, "sessions" | "sessionKey" | "sessionHost">,
): GatewaySessionRow[] {
  if (!props.sessions) {
    return [];
  }
  const host = props.sessionHost ?? {};
  // Bare global keys carry no agent; the selected agent lives in host state
  // (assistantAgentId). Mirrors resolveSessionNavigation's agent resolution.
  const defaultAgentId = resolveUiSelectedGlobalAgentId(host);
  const agentId = parseAgentSessionKey(props.sessionKey)?.agentId ?? defaultAgentId;
  return (
    getVisibleSessionRows(props.sessions, {
      agentId,
      defaultAgentId,
      filterByAgent: true,
      // Recent chats must respect the Project scope like the sidebar does;
      // otherwise the new-thread page lists threads from every Project while
      // the selector claims to be scoped to one.
      projectId: readSelectedProjectId(),
    })
      .filter(
        (row) =>
          !areUiSessionKeysEquivalent(row.key, props.sessionKey) &&
          !resolveChannelSessionInfo(row.key, row.channel).channelSession,
      )
      // Pure recency, unlike the sidebar's pin-aware sort: a "Recent chats"
      // list capped at five must not let stale pinned rows hide newer chats.
      .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.key.localeCompare(b.key))
      .slice(0, WELCOME_RECENT_SESSION_LIMIT)
  );
}

function renderWelcomeClawd() {
  // Cortex, not Clawd. The welcome hero is the most prominent persona slot in
  // the product, so it must not fall back to OpenClaw's mascot. Kept under the
  // original function name and wrapper class so the drag/drop mascot lookups
  // in renderWelcomeState keep resolving.
  return html`
    <div class="agent-chat__welcome-clawd psy-elf-hero" aria-hidden="true">
      <span class="psy-elf psy-elf--hero">
        <img
          class="psy-elf__idle"
          src="/brand/elf/elf-chat-idle-256.png"
          alt=""
          width="112"
          height="112"
        />
        <span class="psy-elf__blink"></span>
      </span>
    </div>
  `;
}

function renderWelcomeRecentSessions(
  rows: GatewaySessionRow[],
  onOpenSession: ((sessionKey: string) => void) | undefined,
) {
  return html`
    <div class="agent-chat__recents">
      <div class="agent-chat__recents-title">${t("chat.welcome.recentSessions")}</div>
      ${rows.map((row) => {
        const subtitle = resolveSessionWorkSubtitle(row);
        return html`
          <button type="button" class="agent-chat__recent" @click=${() => onOpenSession?.(row.key)}>
            <span class="agent-chat__recent-name">${resolveSessionDisplayName(row.key, row)}</span>
            ${subtitle ? html`<span class="agent-chat__recent-sub">${subtitle}</span>` : nothing}
            <span class="agent-chat__recent-time">
              ${formatRelativeTimestamp(row.updatedAt, { fallback: "" })}
            </span>
          </button>
        `;
      })}
    </div>
  `;
}

function renderWelcomeSuggestions(props: Pick<ChatWelcomeProps, "onDraftChange" | "onSend">) {
  return html`
    <div class="agent-chat__suggestions">
      ${WELCOME_SUGGESTION_KEYS.map((key) => {
        const text = t(key);
        return html`
          <button
            type="button"
            class="agent-chat__suggestion"
            @click=${() => {
              props.onDraftChange(text);
              props.onSend();
            }}
          >
            ${text}
          </button>
        `;
      })}
    </div>
  `;
}

function renderWelcomeHero(
  props: Pick<ChatWelcomeProps, "assistantName" | "assistantAvatar" | "assistantAvatarUrl"> & {
    hint: unknown;
  },
) {
  const name = props.assistantName || "Assistant";
  const avatar = resolveAssistantAvatarUrl(props);
  // A real avatar image wins. A TEXT avatar does not.
  //
  // IDENTITY.md gives Cortex an emoji and no avatar image, and the gateway
  // syncs that emoji into the agent's avatar field -- so this slot rendered a
  // sparkle tile and the elf below was unreachable. The elf still appeared on
  // the new-session page, which calls this from a different site without the
  // avatar props, which is how one product ended up with two answers for its
  // own mascot.
  //
  // An emoji is the stand-in for an agent that has no artwork. This one has
  // artwork, and this slot is the most prominent persona surface in the
  // product, so the artwork wins here. The emoji is still right everywhere it
  // is used at text size -- session rows, notifications -- and is untouched
  // there.
  return html`
    ${avatar
      ? html`<img class="agent-chat__welcome-avatar" src=${avatar} alt=${name} />`
      : renderWelcomeClawd()}
    <h2>${name}</h2>
    <p class="agent-chat__hint">${props.hint}</p>
  `;
}

/** The start-screen welcome block, shared by the empty chat and the new-session draft. */
export function renderWelcomeState(props: ChatWelcomeProps) {
  const recentSessions = selectWelcomeRecentSessions(props);
  let fileDragDepth = 0;
  const mascotFor = (event: DragEvent): WelcomeMascot | null => {
    const target = event.currentTarget;
    return target instanceof HTMLElement
      ? target.querySelector<WelcomeMascot>(".agent-chat__welcome-clawd openclaw-mascot")
      : null;
  };

  return html`
    <div
      class="agent-chat__welcome"
      style="--agent-color: var(--accent)"
      @dragenter=${(event: DragEvent) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
          return;
        }
        fileDragDepth += 1;
        const mascot = mascotFor(event);
        if (mascot) {
          mascot.tease = true;
        }
      }}
      @dragleave=${(event: DragEvent) => {
        fileDragDepth = Math.max(0, fileDragDepth - 1);
        const mascot = mascotFor(event);
        if (mascot && fileDragDepth === 0) {
          mascot.tease = false;
        }
      }}
      @drop=${(event: DragEvent) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
          return;
        }
        fileDragDepth = 0;
        const mascot = mascotFor(event);
        if (mascot) {
          mascot.tease = false;
          mascot.catchOnce();
        }
      }}
    >
      ${renderWelcomeHero({
        assistantName: props.assistantName,
        assistantAvatar: props.assistantAvatar,
        assistantAvatarUrl: props.assistantAvatarUrl,
        hint:
          props.hint ??
          html`${t("chat.welcome.hintBeforeShortcut")} <kbd>/</kbd> ${t(
              "chat.welcome.hintAfterShortcut",
            )}`,
      })}
      ${props.composer ?? nothing} ${renderWelcomeSuggestions(props)}
      ${recentSessions.length > 0
        ? renderWelcomeRecentSessions(recentSessions, props.onOpenSession)
        : nothing}
    </div>
  `;
}
