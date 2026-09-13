import { CONTENT } from '@writeback/shared';

function isBlank(text: string | null | undefined): boolean {
  return text === null || text === undefined || text.trim().length === 0;
}

/** Publish uses the saved row; gate the button on that row, not unsaved form fields. */
export function lemmaPublishDisabled(exampleEn: string | null | undefined): boolean {
  return isBlank(exampleEn);
}

export function promptPublishMessages(input: {
  sampleEn: string | null | undefined;
  targetLemmaIds: readonly string[];
  lemmas: readonly { id: string; status: string }[];
  lemmasMatchTopic: boolean;
}): string[] {
  const messages: string[] = [];
  if (isBlank(input.sampleEn)) {
    messages.push('Xuất bản cần sample_en.');
  }
  const n = input.targetLemmaIds.length;
  if (n < CONTENT.PROMPT_TARGETS_MIN || n > CONTENT.PROMPT_TARGETS_MAX) {
    messages.push(
      `Xuất bản cần ${CONTENT.PROMPT_TARGETS_MIN}–${CONTENT.PROMPT_TARGETS_MAX} target.`,
    );
  }
  if (
    input.lemmasMatchTopic &&
    input.targetLemmaIds.some(
      (id) => input.lemmas.find((lemma) => lemma.id === id)?.status !== 'published',
    )
  ) {
    messages.push('Xuất bản cần mọi target đã published.');
  }
  return messages;
}
