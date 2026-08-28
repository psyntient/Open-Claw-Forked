// Project selector: the Slack-style scope switcher.
//
// Selecting a Project scopes the sidebar to its threads (the filter lives in
// filterVisibleSessionRows via readSelectedProjectId). Threads with no
// category resolve to the Default Project, so nothing is ever hidden by a
// filter the user did not set.
//
// This is a scope switcher, not an agent switcher: there is exactly one
// Cortex. See PROJECT_AS_AGENT_RESEARCH.md for why separate agents were
// rejected.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";
import {
  DEFAULT_PROJECT_ID,
  createProject,
  loadProjects,
  readSelectedProjectId,
  writeSelectedProjectId,
  type PsyntientProject,
} from "../lib/psyntient-projects.ts";
import "./psyntient-project-remove.ts";

@customElement("psyntient-project-select")
export class PsyntientProjectSelect extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;

  @state() private projects: PsyntientProject[] = [];
  @state() private selectedId = readSelectedProjectId();
  @state() private open = false;
  /** The Project whose removal dialog is open, if any. */
  @state() private removing: PsyntientProject | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  override updated(changed: Map<string, unknown>) {
    // The token is not present on first connect; load once it arrives.
    if (changed.has("authToken") && this.authToken && this.projects.length === 0) {
      void this.refresh();
    }
  }

  private async refresh() {
    this.projects = await loadProjects(this.authToken);
  }

  /**
   * After a removal, reload so the id cache drops the removed Project -- that
   * cache is what makes its orphaned threads resolve back to General.
   * Selecting Default also navigates, which reloads the sidebar; doing it in
   * the other order would leave the user scoped to a Project that is gone.
   */
  private async finishRemoval(removedId: string) {
    this.removing = null;
    await this.refresh();
    if (this.selectedId === removedId) {
      this.select(DEFAULT_PROJECT_ID);
    }
  }

  private select(projectId: string) {
    this.selectedId = projectId;
    writeSelectedProjectId(projectId);
    this.open = false;
    // Leave the current thread behind.
    //
    // Reloading in place kept the open conversation on screen while the
    // sidebar switched Projects, so the user was looking at (and sending
    // into) a thread that does not belong to the selected Project -- it then
    // vanished from the list, which reads as "I cannot submit anything".
    //
    // "/" is not neutral: Home opens the main session, which belongs to the
    // Default Project, so switching to any other Project still landed on a
    // General thread. The new-thread draft belongs to no Project until it is
    // sent, and it gives the user somewhere to type immediately -- which
    // matters most for a Project that has no threads yet.
    location.href = "/new";
  }

  private async promptNewProject() {
    const title = globalThis.prompt(t("projects.newPrompt"))?.trim();
    if (!title) {
      return;
    }
    const created = await createProject(this.authToken, title);
    if (created) {
      this.select(created.projectId);
    }
  }

  private activeTitle(): string {
    return (
      this.projects.find((p) => p.projectId === this.selectedId)?.title ??
      t("projects.defaultTitle")
    );
  }

  override render() {
    return html`
      <div class="psy-project-select">
        <button
          type="button"
          class="psy-project-select__trigger"
          aria-haspopup="listbox"
          aria-expanded=${String(this.open)}
          @click=${() => (this.open = !this.open)}
        >
          <span class="psy-project-select__label">${t("projects.label")}</span>
          <span class="psy-project-select__name">${this.activeTitle()}</span>
          <span class="psy-project-select__chevron" aria-hidden="true">⌄</span>
        </button>
        ${this.open
          ? html`
              <ul class="psy-project-select__menu" role="listbox">
                ${this.projects.map(
                  (p) => html`
                    <li class="psy-project-select__row">
                      <button
                        type="button"
                        role="option"
                        aria-selected=${String(p.projectId === this.selectedId)}
                        class="psy-project-select__option ${p.projectId === this.selectedId
                          ? "is-selected"
                          : ""}"
                        @click=${() => this.select(p.projectId)}
                      >
                        ${p.title}
                      </button>
                      ${p.projectId === DEFAULT_PROJECT_ID
                        ? nothing
                        : html`
                            <button
                              type="button"
                              class="psy-project-select__manage"
                              aria-label=${t("projects.manage")}
                              title=${t("projects.manage")}
                              @click=${(event: MouseEvent) => {
                                // Without this the row's select() fires too and
                                // navigates away from the dialog being opened.
                                event.stopPropagation();
                                this.open = false;
                                this.removing = p;
                              }}
                            >
                              ⋯
                            </button>
                          `}
                    </li>
                  `,
                )}
                <li>
                  <button
                    type="button"
                    class="psy-project-select__option psy-project-select__option--new"
                    @click=${() => this.promptNewProject()}
                  >
                    ${t("projects.new")}
                  </button>
                </li>
              </ul>
            `
          : nothing}
        ${this.removing
          ? html`
              <psyntient-project-remove
                .authToken=${this.authToken}
                .projectId=${this.removing.projectId}
                .projectTitle=${this.removing.title}
                .onDone=${() => void this.finishRemoval(this.removing?.projectId ?? "")}
                .onCancel=${() => (this.removing = null)}
              ></psyntient-project-remove>
            `
          : nothing}
      </div>
    `;
  }
}
