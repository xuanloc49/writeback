import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importDocumentSchema, normalizeHeadword } from '@writeback/shared';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const raw = JSON.parse(
    readFileSync(join(__dirname, 'seed', 'learner-fixture.json'), 'utf8'),
  ) as unknown;
  const fixture = importDocumentSchema.parse(raw);
  const topics = fixture.topics ?? [];
  const lemmas = fixture.lemmas ?? [];
  const prompts = fixture.prompts ?? [];

  const topicIds = new Map<string, string>();
  for (const topic of topics) {
    const existing = await prisma.topic.findFirst({
      where: { slug: topic.slug, deletedAt: null },
    });
    const row = existing
      ? await prisma.topic.update({
          where: { id: existing.id },
          data: { nameVi: topic.name_vi, status: 'published' },
        })
      : await prisma.topic.create({
          data: { slug: topic.slug, nameVi: topic.name_vi, status: 'published' },
        });
    topicIds.set(topic.slug, row.id);
  }

  const lemmaIds = new Map<string, string>();
  for (const lemma of lemmas) {
    const topicId = topicIds.get(lemma.topic_slug);
    if (topicId === undefined) {
      throw new Error(`Unknown topic_slug ${lemma.topic_slug}`);
    }
    const headwordNormalized = normalizeHeadword(lemma.headword);
    const existing = await prisma.lemma.findFirst({
      where: { headwordNormalized, deletedAt: null },
    });
    const data = {
      headword: lemma.headword,
      headwordNormalized,
      pos: lemma.pos ?? null,
      phonetic: lemma.phonetic ?? null,
      senseVi: lemma.sense_vi,
      exampleEn: lemma.example_en ?? null,
      notesVi: lemma.notes_vi ?? null,
      topicId,
      includedInFree: lemma.included_in_free,
      cefr: lemma.cefr ?? null,
      status: 'published' as const,
    };
    const row = existing
      ? await prisma.lemma.update({ where: { id: existing.id }, data })
      : await prisma.lemma.create({ data });
    lemmaIds.set(headwordNormalized, row.id);
  }

  for (const prompt of prompts) {
    const topicId = topicIds.get(prompt.topic_slug);
    if (topicId === undefined) {
      throw new Error(`Unknown topic_slug ${prompt.topic_slug}`);
    }
    const existing = await prisma.prompt.findFirst({
      where: { externalKey: prompt.external_key, deletedAt: null },
    });
    const data = {
      externalKey: prompt.external_key,
      textVi: prompt.text_vi,
      topicId,
      sampleEn: prompt.sample_en ?? null,
      hintsVi: prompt.hints_vi ?? null,
      status: 'published' as const,
    };
    const row = existing
      ? await prisma.prompt.update({ where: { id: existing.id }, data })
      : await prisma.prompt.create({ data });
    await prisma.promptLemma.deleteMany({ where: { promptId: row.id } });
    await prisma.promptLemma.createMany({
      data: prompt.target_headwords.map((headword, sortOrder) => {
        const lemmaId = lemmaIds.get(normalizeHeadword(headword));
        if (lemmaId === undefined) {
          throw new Error(`Unknown target ${headword}`);
        }
        return { promptId: row.id, lemmaId, sortOrder };
      }),
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
