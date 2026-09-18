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
//
// IT SELECTS AND IT DOES NOT MANAGE, deliberately. Creating and removing
// projects used to live in this dropdown, and it was the wrong home twice
// over. A project carries a description, data types, a licence, a publication
// state and eventually a DOI; the dialog here could only ever set a title and
// some types, so a project made from it still had to be finished on the Repo's
// own page. That is two places to answer one question, and the weaker one was
// a worse copy of a page that already exists and has to be kept in sync with
// it.
//
// So management leaves entirely -- removed rather than hidden -- and the menu
// ends with a link to My projects, which the Archive rail already carries.
import { goToRoute } from "../lib/psyntient-navigate.ts";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";
import {
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
  /** The list could not be fetched -- which is not the same as having none. */
  @state() private loadFailed = false;

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
    const out = await loadProjects(this.authToken);
    this.projects = out.projects;
    this.loadFailed = out.failed;
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
    goToRoute("new-session");
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
                    </li>
                  `,
                )}
                ${this.loadFailed
                  ? html`<li class="psy-project-select__empty">${t("projects.loadFailed")}</li>`
                  : this.projects.filter((p) => p.projectId !== "default").length === 0
                    ? html`<li class="psy-project-select__empty">${t("projects.noneYet")}</li>`
                    : nothing}
                <li>
                  <a
                    class="psy-project-select__option psy-project-select__option--manage"
                    href="/repo/mine"
                  >
                    ${t("projects.manageAll")}
                  </a>
                </li>
              </ul>
            `
          : nothing}

      </div>
    `;
  }
}
