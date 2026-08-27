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
  createProject,
  loadProjects,
  readSelectedProjectId,
  writeSelectedProjectId,
  type PsyntientProject,
} from "../lib/psyntient-projects.ts";

@customElement("psyntient-project-select")
export class PsyntientProjectSelect extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;

  @state() private projects: PsyntientProject[] = [];
  @state() private selectedId = readSelectedProjectId();
  @state() private open = false;

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

  private select(projectId: string) {
    this.selectedId = projectId;
    writeSelectedProjectId(projectId);
    this.open = false;
    // The sidebar reads the selection synchronously while filtering rows, so a
    // reload is the honest way to re-scope every dependent view at once.
    location.reload();
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
                    <li>
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
      </div>
    `;
  }
}
