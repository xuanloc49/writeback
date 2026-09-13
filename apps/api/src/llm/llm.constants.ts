/**
 * Sampling temperature for the scoring call.
 *
 * Part of the scoring contract together with SCORING_PROMPT_VERSION; changing it requires
 * bumping the prompt version and passing the golden eval (design §11). Deliberately not an
 * env var so it cannot drift per environment.
 */
export const SCORING_TEMPERATURE = 0;
