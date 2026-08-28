// Project removal: three outcomes, framed by risk.
//
// PROJECTS_DESIGN.md settled the shape. The user asked for "delete chats /
// delete Vault data / delete both"; these are the same three outcomes named so
// the safe one reads as safe and the destructive one has to be chosen on
// purpose:
//
//   Archive              sync to Vault, then clear the working copy (the
//                        designed lifecycle -- not a deletion)
//   Remove from device   clear the working copy, Vault copy kept
//   Delete permanently   working copy AND Vault copy, typed confirmation
//
// "Delete Vault data only" is deliberately absent: per CLAUDE.md section 9 the
// Vault copy is the durable artefact and the working copy is disposable, so
// that option destroys the preserved half and keeps the scratch half. It does
// not belong one mis-click away in a project menu.
//
// Threads are never deleted here. They keep their `category`, and
// resolveRowProjectId() falls back to the Default Project once the Project is
// no longer in the known list -- so they reappear under General rather than
// needing a bulk patch across every affected session.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";
import { removeProject, type ProjectRemoval } from "../lib/psyntient-projects.ts";

@customElement("psyntient-project-remove")
export class PsyntientProjectRemove extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;
  @property({ attribute: false }) projectId = "";
  @property({ attribute: false }) projectTitle = "";
  @property({ attribute: false }) onDone: (() => void) | null = null;
  @property({ attribute: false }) onCancel: (() => void) | null = null;

  @state() private busy = false;
  @state() private errorText: string | null = null;
  /** Set when the backend refuses an erase because nothing has been synced. */
  @state() private needsSync = false;
  @state() private confirmText = "";

  private async run(action: ProjectRemoval) {
    this.busy = true;
    this.errorText = null;
    try {
      const result = await removeProject(this.authToken, this.projectId, action);
      if (result.ok) {
        this.onDone?.();
        return;
      }
      // eraseProjectWorkingCopy() refuses without a real prior sync. That guard
      // is protecting unsaved research, so offer the sync rather than showing
      // the raw error.
      if (result.needsSync) {
        this.needsSync = true;
        return;
      }
      this.errorText = result.error ?? "Could not remove this project.";
    } finally {
      this.busy = false;
    }
  }

  private renderChoice(
    action: ProjectRemoval,
    label: string,
    hint: string,
    variant: "safe" | "danger",
  ) {
    return html`
      <button
        type="button"
        class="psy-project-remove__choice psy-project-remove__choice--${variant}"
        ?disabled=${this.busy}
        @click=${() => this.run(action)}
      >
        <span class="psy-project-remove__choice-label">${label}</span>
        <span class="psy-project-remove__choice-hint">${hint}</span>
      </button>
    `;
  }

  override render() {
    // A typed project name is the only gate on the irreversible option; every
    // other choice here is recoverable from the Vault.
    const deleteArmed = this.confirmText.trim() === this.projectTitle.trim();
    return html`
      <div class="psy-project-remove" role="dialog" aria-modal="true">
        <div class="psy-project-remove__panel">
          <h2 class="psy-project-remove__title">
            ${t("projects.removeTitle", { project: this.projectTitle })}
          </h2>
          <p class="psy-project-remove__intro">${t("projects.removeIntro")}</p>

          ${this.needsSync
            ? html`
                <p class="psy-project-remove__warning" role="alert">${t("projects.needsSync")}</p>
                <button
                  type="button"
                  class="psy-project-remove__choice psy-project-remove__choice--safe"
                  ?disabled=${this.busy}
                  @click=${() => this.run("archive")}
                >
                  <span class="psy-project-remove__choice-label"
                    >${t("projects.syncThenArchive")}</span
                  >
                </button>
              `
            : html`
                ${this.renderChoice(
                  "archive",
                  t("projects.archive"),
                  t("projects.archiveHint"),
                  "safe",
                )}
                ${this.renderChoice(
                  "remove",
                  t("projects.remove"),
                  t("projects.removeHint"),
                  "safe",
                )}
                <div class="psy-project-remove__danger">
                  <label class="psy-project-remove__confirm">
                    <span>${t("projects.deleteConfirmLabel", { project: this.projectTitle })}</span>
                    <input
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      .value=${this.confirmText}
                      @input=${(e: Event) =>
                        (this.confirmText = (e.target as HTMLInputElement).value)}
                    />
                  </label>
                  <button
                    type="button"
                    class="psy-project-remove__choice psy-project-remove__choice--danger"
                    ?disabled=${this.busy || !deleteArmed}
                    @click=${() => this.run("delete")}
                  >
                    <span class="psy-project-remove__choice-label">${t("projects.delete")}</span>
                    <span class="psy-project-remove__choice-hint">${t("projects.deleteHint")}</span>
                  </button>
                </div>
              `}
          ${this.errorText
            ? html`<p class="psy-project-remove__error" role="alert">${this.errorText}</p>`
            : nothing}
          <button
            type="button"
            class="psy-project-remove__cancel"
            ?disabled=${this.busy}
            @click=${() => this.onCancel?.()}
          >
            ${this.busy ? t("projects.working") : t("projects.cancel")}
          </button>
        </div>
      </div>
    `;
  }
}
