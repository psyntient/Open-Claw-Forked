// One-shot handoff of a question from a reading surface into the composer.
//
// The Archive viewer writes here and navigates to /new, which reads it once and
// clears it. sessionStorage rather than a `?prompt=` query param because the
// router normalizes search params off /new before the page element connects --
// the param is gone before anything can read it.
export const PSYNTIENT_PROMPT_HANDOFF_KEY = "psyntient.promptHandoff";

/** Never throws: a blocked storage must not break the button that calls it. */
export function handOffPrompt(prompt: string): void {
  try {
    sessionStorage.setItem(PSYNTIENT_PROMPT_HANDOFF_KEY, prompt);
  } catch {
    // Prefill is a convenience; navigation still happens without it.
  }
}
