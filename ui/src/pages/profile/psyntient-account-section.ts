// Psyntient Account — real psyntient.io pairing state on the Profile page.
//
// Data comes from the Psyntient gateway plugin route, which is backed by
// daemon/pairing.mjs reading ~/.psyntient/node.key. See
// Noetic_Interface/gateway-plugin/index.js.
//
// DELIBERATELY SEPARATE FROM THE LLM KEY. CLAUDE.md is explicit that pairing
// and the provider key stay decoupled: a bad API key must never surface as an
// account problem, and an unpaired Node must never look like a key problem.
// Two sections, two error states. Do not merge them.
import { html, nothing } from "lit";
import { renderSettingsRow, renderSettingsSection } from "../../components/settings-ui.ts";
import { t } from "../../i18n/index.ts";

export type PsyntientAccountState = {
  status: "loading" | "paired" | "unpaired" | "error";
  nodeId?: string | null;
  contextId?: string | null;
  pairedAt?: string | null;
  error?: string | null;
};

const PAIRING_ROUTE = "/__openclaw__/psyntient/pairing";

/** Never throws: an unreachable route degrades to an "unknown" row, not a broken page. */
export async function loadPsyntientAccount(): Promise<PsyntientAccountState> {
  try {
    const res = await fetch(PAIRING_ROUTE, { credentials: "same-origin" });
    if (!res.ok) {
      return { status: "error", error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      isPaired?: boolean;
      nodeId?: string;
      contextId?: string;
      pairedAt?: string;
      error?: string;
    };
    if (!body.ok) {
      return { status: "error", error: body.error ?? "unknown error" };
    }
    return body.isPaired
      ? {
          status: "paired",
          nodeId: body.nodeId ?? null,
          contextId: body.contextId ?? null,
          pairedAt: body.pairedAt ?? null,
        }
      : { status: "unpaired" };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function statusRow(state: PsyntientAccountState) {
  if (state.status === "loading") {
    return renderSettingsRow({
      title: t("psyntientAccount.status"),
      description: t("psyntientAccount.checking"),
    });
  }
  if (state.status === "paired") {
    return renderSettingsRow({
      title: t("psyntientAccount.status"),
      description: t("psyntientAccount.pairedDesc"),
      control: html`<span class="settings-badge settings-badge--ok"
        >${t("psyntientAccount.paired")}</span
      >`,
    });
  }
  if (state.status === "unpaired") {
    return renderSettingsRow({
      title: t("psyntientAccount.status"),
      description: t("psyntientAccount.unpairedDesc"),
      control: html`<span class="settings-badge">${t("psyntientAccount.unpaired")}</span>`,
    });
  }
  return renderSettingsRow({
    title: t("psyntientAccount.status"),
    description: state.error ?? t("psyntientAccount.unknown"),
  });
}

export function renderPsyntientAccountSection(state: PsyntientAccountState) {
  const details =
    state.status === "paired"
      ? html`
          ${state.nodeId
            ? renderSettingsRow({ title: t("psyntientAccount.nodeId"), description: state.nodeId })
            : nothing}
          ${state.contextId
            ? renderSettingsRow({
                title: t("psyntientAccount.contextId"),
                description: state.contextId,
              })
            : nothing}
          ${state.pairedAt
            ? renderSettingsRow({
                title: t("psyntientAccount.pairedAt"),
                description: state.pairedAt,
              })
            : nothing}
        `
      : nothing;

  return renderSettingsSection(
    { title: t("psyntientAccount.title") },
    html`${statusRow(state)}${details}`,
  );
}
