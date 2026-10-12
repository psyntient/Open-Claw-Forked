import { inferControlUiPublicAssetPath } from "../../../app/public-assets.ts";
import { html, nothing } from "lit";
import "../../../components/elapsed-time.ts";
import "../../../components/working-phrase.ts";
import { t } from "../../../i18n/index.ts";
import type { ChatItem } from "../../../lib/chat/chat-types.ts";
import { fnv1aUtf16 } from "../../../lib/fnv1a.ts";
import { formatCompactTokenCount, formatDurationCompact } from "../../../lib/format.ts";
import type { TurnRecap } from "../chat-progress.ts";
import type { ChatRunStartupPhase } from "../chat-run-startup.ts";

// One salt per page load keeps each run stable while varying the animation between visits.
// The default stance just claws in place; the busier stances stay rare on purpose.
const STANCE_SALT = Math.trunc(Math.random() * 0xffffffff);
const STANCES: Array<[stance: string, weight: number]> = [
  ["", 63],
  ["chat-reading-indicator--southpaw", 19],
  ["chat-reading-indicator--flurry", 5],
  ["chat-reading-indicator--spin", 4],
  ["chat-reading-indicator--shadowbox", 3],
  ["chat-reading-indicator--backflip", 2],
  ["chat-reading-indicator--zen", 2],
  ["chat-reading-indicator--drummer", 1],
  ["chat-reading-indicator--peekaboo", 1],
];
const STARTUP_STATUS_LABEL_KEYS = {
  preparing_workspace: "chat.startupStatus.preparingWorkspace",
  provisioning_environment: "chat.startupStatus.provisioningEnvironment",
  preparing_context: "chat.startupStatus.preparingContext",
  starting_model: "chat.startupStatus.startingModel",
} as const satisfies Record<ChatRunStartupPhase, Parameters<typeof t>[0]>;

function startupStatusLabel(phase: ChatRunStartupPhase): string {
  return t(STARTUP_STATUS_LABEL_KEYS[phase]);
}

function renderLiveOutputTokens(outputTokens: number | null | undefined) {
  if (outputTokens === null || outputTokens === undefined) {
    return nothing;
  }
  return html`
    <span aria-hidden="true">·</span>
    <span class="chat-working-indicator__tokens">
      ${t("chat.outputTokens", { count: formatCompactTokenCount(outputTokens) })}
    </span>
  `;
}

function stanceClass(key: string): string {
  const total = STANCES.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = ((((fnv1aUtf16(key) ^ STANCE_SALT) >>> 0) % 1000) / 1000) * total;
  for (const [stance, weight] of STANCES) {
    roll -= weight;
    if (roll <= 0) {
      return stance;
    }
  }
  return "";
}

export function renderChatWorkingIndicator(
  part: Extract<ChatItem, { kind: "reading-indicator" }>,
  waitingApproval = false,
  startupPhase?: ChatRunStartupPhase,
  outputTokens?: number | null,
) {
  // The animated claw stays decorative; the text status exposes progress without
  // announcing every elapsed-time tick to screen readers.
  return html`
    <div class="chat-working-indicator" role="status" aria-live="off">
      <div class="chat-bubble chat-reading-indicator ${stanceClass(part.key)}" aria-hidden="true">
        <span class="psy-elf psy-elf--indicator">
          <img class="psy-elf__idle" src=${inferControlUiPublicAssetPath("brand/elf/elf-chat-idle-64.png")} alt="" />
          <span class="psy-elf__blink"></span>
          <span class="psy-elf__talk"></span>
          <span class="psy-elf__sparks"><i></i><i></i><i></i><i></i></span>
        </span>
      </div>
      <span class="chat-working-indicator__status">
        ${waitingApproval
          ? html`<span>${t("chat.waitingForApproval")}</span>`
          : startupPhase
            ? html`
                <span>${startupStatusLabel(startupPhase)}</span>
                <openclaw-elapsed-time
                  class="chat-working-indicator__elapsed"
                  .startMs=${part.startedAt}
                ></openclaw-elapsed-time>
                ${renderLiveOutputTokens(outputTokens)}
              `
            : html`
                <span class="agent-chat__sr-only">${t("common.working")}</span>
                <openclaw-elapsed-time
                  class="chat-working-indicator__elapsed"
                  .startMs=${part.startedAt}
                ></openclaw-elapsed-time>
                <openclaw-working-phrase
                  aria-hidden="true"
                  .startMs=${part.startedAt}
                  .seed=${part.key}
                ></openclaw-working-phrase>
                ${renderLiveOutputTokens(outputTokens)}
              `}
      </span>
    </div>
  `;
}

/** Post-turn recap row: once the run settles, the parked claw reports how
 * long the turn took (and its output tokens when the terminal patch carried
 * them). Sticky until the next run replaces it. */
export function renderTurnRecapRow(recap: TurnRecap) {
  // Sub-second turns still read "1s"; the clamp also keeps the type a string.
  const clampedMs = Math.max(1_000, recap.runtimeMs);
  const duration = formatDurationCompact(clampedMs, { spaced: true }) ?? "1s";
  // 0 is a valid count (command-only turns); only null means "unknown".
  const tokens =
    typeof recap.outputTokens === "number"
      ? recap.outputTokens === 1
        ? t("chat.turnRecap.tokensOne")
        : t("chat.turnRecap.tokens", { count: formatCompactTokenCount(recap.outputTokens) })
      : null;
  return html`
    <div class="chat-tasks-status chat-turn-recap" role="status">
      <span class="chat-tasks-status__claw psy-architect" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" role="img">
          <style>
            .psy-arc-o1 { transform-origin: 12px 12px;
              animation: psy-arc-spin 7s linear infinite; }
            .psy-arc-o2 { transform-origin: 12px 12px;
              animation: psy-arc-spin 4.5s linear infinite reverse; }
            .psy-arc-core { transform-origin: 12px 12px;
              animation: psy-arc-pulse 2.8s ease-in-out infinite; }
            @keyframes psy-arc-spin { to { transform: rotate(360deg); } }
            @keyframes psy-arc-pulse {
              0%, 100% { opacity: .95; transform: scale(1); }
              50%      { opacity: .62; transform: scale(.86); }
            }
            @media (prefers-reduced-motion: reduce) {
              .psy-arc-o1, .psy-arc-o2, .psy-arc-core { animation: none; }
            }
          </style>
          <circle cx="12" cy="12" r="11" fill="#141021" />
          <circle cx="12" cy="12" r="10.4" fill="none" stroke="#c9a24a"
                  stroke-width="1" opacity=".55" />
          <ellipse class="psy-arc-o1" cx="12" cy="12" rx="8.6" ry="3.5"
                   fill="none" stroke="#f5c76a" stroke-width="1.25"
                   opacity=".9" />
          <ellipse class="psy-arc-o2" cx="12" cy="12" rx="3.3" ry="8.2"
                   fill="none" stroke="#f5d9a8" stroke-width="1"
                   opacity=".55" />
          <circle class="psy-arc-core" cx="12" cy="12" r="2.5" fill="#f5c76a" />
        </svg>
      </span>
      <span>${t("chat.turnRecap.doneIn", { duration })}</span>
      ${tokens === null
        ? nothing
        : html`
            <span class="chat-tasks-status__sep" aria-hidden="true">·</span>
            <span>${tokens}</span>
          `}
    </div>
  `;
}
