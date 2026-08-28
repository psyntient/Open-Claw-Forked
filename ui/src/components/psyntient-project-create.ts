// Creating a Project: a name and its data types, both required.
//
// Replaces a globalThis.prompt() that could only ask for a name. That was not
// merely a nicer-dialog problem: a Project's data types ARE its
// Archive-eligibility decision, and every Project created before this one has
// none, which makes it permanently uncontributable without anyone being told.
//
// The vocabulary is fetched, never hardcoded. daemon/working-memory.mjs's
// DATA_TYPES decides both what is valid and what is eligible; a copy here
// would be a second opinion on what the Archive accepts.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";
import { createProject, type PsyntientDataType } from "../lib/psyntient-projects.ts";
import "./modal-dialog.ts";

@customElement("psyntient-project-create")
export class PsyntientProjectCreate extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;
  @property({ attribute: false }) dataTypes: PsyntientDataType[] = [];
  @property({ attribute: false }) onCreated: ((projectId: string) => void) | null = null;
  @property({ attribute: false }) onCancel: (() => void) | null = null;

  @state() private title = "";
  @state() private selected = new Set<string>();
  @state() private busy = false;
  @state() private errorText: string | null = null;

  private toggle(id: string) {
    const next = new Set(this.selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      // "No recorded data" is not a data type you hold alongside EEG. The
      // backend rejects the combination too; this keeps the form from letting
      // the user build an input it will refuse.
      if (id === "none") next.clear();
      else next.delete("none");
      next.add(id);
    }
    this.selected = next;
  }

  private async submit() {
    if (!this.title.trim() || this.selected.size === 0 || this.busy) return;
    this.busy = true;
    this.errorText = null;
    const { project, error } = await createProject(this.authToken, this.title.trim(), [
      ...this.selected,
    ]);
    this.busy = false;
    if (project) {
      this.onCreated?.(project.projectId);
      return;
    }
    this.errorText = error ?? t("projects.createFailed");
  }

  override render() {
    const eligible = this.dataTypes.some((t) => t.archiveEligible && this.selected.has(t.id));
    const ready = Boolean(this.title.trim()) && this.selected.size > 0 && !this.busy;
    return html`
      <openclaw-modal-dialog
        label=${t("projects.createTitle")}
        description=${t("projects.dataTypesHint")}
        @wa-hide=${() => this.onCancel?.()}
      >
        <div class="psy-project-create">
          <h2 class="psy-project-create__title">${t("projects.createTitle")}</h2>

          <label class="psy-project-create__field">
            <span>${t("projects.nameLabel")}</span>
            <input
              type="text"
              autocomplete="off"
              .value=${this.title}
              @input=${(e: Event) => (this.title = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") void this.submit();
              }}
            />
          </label>

          <fieldset class="psy-project-create__types">
            <legend>${t("projects.dataTypesLabel")}</legend>
            <p class="psy-project-create__hint">${t("projects.dataTypesHint")}</p>
            ${this.dataTypes.map(
              (type) => html`
                <label class="psy-project-create__type">
                  <input
                    type="checkbox"
                    .checked=${this.selected.has(type.id)}
                    @change=${() => this.toggle(type.id)}
                  />
                  <span>${type.label}</span>
                </label>
              `,
            )}
          </fieldset>

          <!-- Stated up front rather than discovered at contribution time:
               most projects are legitimately ineligible, and that should read
               as a normal outcome instead of something having gone wrong. -->
          ${this.selected.size > 0
            ? html`<p class="psy-project-create__eligibility">
                ${eligible ? t("projects.eligibleYes") : t("projects.eligibleNo")}
              </p>`
            : nothing}
          ${this.errorText
            ? html`<p class="psy-project-create__error" role="alert">${this.errorText}</p>`
            : nothing}

          <div class="psy-project-create__actions">
            <button
              type="button"
              class="psy-project-create__cancel"
              @click=${() => this.onCancel?.()}
            >
              ${t("projects.cancel")}
            </button>
            <button
              type="button"
              class="psy-project-create__submit"
              ?disabled=${!ready}
              @click=${() => this.submit()}
            >
              ${this.busy ? t("projects.working") : t("projects.create")}
            </button>
          </div>
        </div>
      </openclaw-modal-dialog>
    `;
  }
}
