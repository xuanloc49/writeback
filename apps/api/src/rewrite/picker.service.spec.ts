import type { User } from '@prisma/client';
import { PICKER } from '@writeback/shared';
import type { PromptWithLemmas } from '../catalog/visibility.service';
import { AppError } from '../common/app-error';
import type { Random } from '../common/random';
import {
  applyNoRepeat,
  chooseFromTop,
  PickerService,
  rankCandidates,
  scorePrompt,
  type PickerSignals,
} from './picker.service';

const DAY = 86_400_000;
const NOW = new Date('2026-09-13T10:00:00.000Z');

function prompt(id: string, lemmaIds: string[], topicId = 'topic-a'): PromptWithLemmas {
  return {
    id,
    topicId,
    lemmaLinks: lemmaIds.map((lemmaId) => ({ lemmaId, promptId: id, lemma: { id: lemmaId } })),
    topic: { id: topicId, nameVi: 'T', status: 'published', deletedAt: null },
  } as unknown as PromptWithLemmas;
}

function signals(partial: Partial<PickerSignals> = {}): PickerSignals {
  return {
    dueOrLearningLemmaIds: new Set(),
    recentMisuseLemmaIds: new Set(),
    onboardingTopicIds: new Set(),
    scoredPromptIds: new Set(),
    ...partial,
  };
}

const fixedRandom = (value: number): Random => ({ next: () => value });

describe('scorePrompt (design §8.2 weights)', () => {
  it('adds WEIGHT_DUE_OR_LEARNING per due/learning target lemma', () => {
    const p = prompt('p1', ['l1', 'l2', 'l3']);
    const s = signals({ dueOrLearningLemmaIds: new Set(['l1', 'l2']), scoredPromptIds: new Set(['p1']) });
    expect(scorePrompt(p, s)).toBe(2 * PICKER.WEIGHT_DUE_OR_LEARNING);
  });

  it('adds WEIGHT_RECENT_MISUSE per recently misused lemma', () => {
    const p = prompt('p1', ['l1', 'l2']);
    const s = signals({ recentMisuseLemmaIds: new Set(['l2']), scoredPromptIds: new Set(['p1']) });
    expect(scorePrompt(p, s)).toBe(PICKER.WEIGHT_RECENT_MISUSE);
  });

  it('adds WEIGHT_ONBOARDING_TOPIC when the prompt topic is an onboarding topic', () => {
    const p = prompt('p1', ['l1'], 'topic-x');
    const s = signals({ onboardingTopicIds: new Set(['topic-x']), scoredPromptIds: new Set(['p1']) });
    expect(scorePrompt(p, s)).toBe(PICKER.WEIGHT_ONBOARDING_TOPIC);
  });

  it('adds WEIGHT_NEVER_DONE only when the prompt was never scored', () => {
    const p = prompt('p1', ['l1']);
    expect(scorePrompt(p, signals())).toBe(PICKER.WEIGHT_NEVER_DONE);
    expect(scorePrompt(p, signals({ scoredPromptIds: new Set(['p1']) }))).toBe(0);
  });

  it('sums all signals together', () => {
    const p = prompt('p1', ['l1', 'l2'], 'topic-x');
    const s = signals({
      dueOrLearningLemmaIds: new Set(['l1']),
      recentMisuseLemmaIds: new Set(['l1', 'l2']),
      onboardingTopicIds: new Set(['topic-x']),
    });
    expect(scorePrompt(p, s)).toBe(
      PICKER.WEIGHT_DUE_OR_LEARNING +
        2 * PICKER.WEIGHT_RECENT_MISUSE +
        PICKER.WEIGHT_ONBOARDING_TOPIC +
        PICKER.WEIGHT_NEVER_DONE,
    );
  });
});

describe('rankCandidates', () => {
  it('sorts by score desc with id tiebreak and keeps only TOP_N', () => {
    const pool = Array.from({ length: PICKER.TOP_N + 4 }, (_, i) =>
      prompt(`p${String(i).padStart(2, '0')}`, [`l${i}`]),
    );
    const s = signals({
      dueOrLearningLemmaIds: new Set(['l11']),
      scoredPromptIds: new Set(pool.slice(0, 5).map((p) => p.id)),
    });
    const ranked = rankCandidates(pool, s);
    expect(ranked).toHaveLength(PICKER.TOP_N);
    expect(ranked[0]?.id).toBe('p11'); // due lemma (+3, +1 never done) beats everyone
    // remaining never-done prompts (score 1) come before scored ones (score 0), id-ordered
    expect(ranked.slice(1).map((p) => p.id)).toEqual(['p05', 'p06', 'p07', 'p08', 'p09', 'p10', 'p00']);
  });
});

describe('chooseFromTop', () => {
  it('uses the injected Random deterministically', () => {
    const top = [prompt('a', ['l']), prompt('b', ['l']), prompt('c', ['l'])];
    expect(chooseFromTop(top, fixedRandom(0)).id).toBe('a');
    expect(chooseFromTop(top, fixedRandom(0.5)).id).toBe('b');
    expect(chooseFromTop(top, fixedRandom(0.999)).id).toBe('c');
  });

  it('throws NO_PROMPT on an empty list', () => {
    expect(() => chooseFromTop([], fixedRandom(0))).toThrow(AppError);
    try {
      chooseFromTop([], fixedRandom(0));
    } catch (error) {
      expect((error as AppError).code).toBe('NO_PROMPT');
    }
  });
});

describe('applyNoRepeat (7-day exclusion)', () => {
  it('excludes prompts scored within NO_REPEAT_DAYS', () => {
    const candidates = [prompt('recent', ['l']), prompt('old', ['l']), prompt('never', ['l'])];
    const last = new Map<string, Date>([
      ['recent', new Date(NOW.getTime() - (PICKER.NO_REPEAT_DAYS - 1) * DAY)],
      ['old', new Date(NOW.getTime() - (PICKER.NO_REPEAT_DAYS + 1) * DAY)],
    ]);
    expect(applyNoRepeat(candidates, last, NOW).map((p) => p.id)).toEqual(['old', 'never']);
  });

  it('falls back to the single oldest-scored prompt when everything is recent', () => {
    const candidates = [prompt('a', ['l']), prompt('b', ['l']), prompt('c', ['l'])];
    const last = new Map<string, Date>([
      ['a', new Date(NOW.getTime() - 1 * DAY)],
      ['b', new Date(NOW.getTime() - 5 * DAY)],
      ['c', new Date(NOW.getTime() - 3 * DAY)],
    ]);
    expect(applyNoRepeat(candidates, last, NOW).map((p) => p.id)).toEqual(['b']);
  });
});

describe('PickerService.pick', () => {
  const user = { id: 'u1', role: 'user', plan: 'free' } as unknown as User;

  function build(candidates: PromptWithLemmas[], random: Random = fixedRandom(0)) {
    const prisma = {
      rewriteAttempt: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      srsCard: { findMany: jest.fn().mockResolvedValue([]) },
      userOnboardingTopic: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const visibility = { visiblePromptCandidates: jest.fn().mockResolvedValue(candidates) };
    const config = { businessTz: 'Asia/Ho_Chi_Minh' };
    const service = new PickerService(
      prisma as never,
      visibility as never,
      config as never,
      random,
    );
    return { service, prisma, visibility };
  }

  it('throws NO_PROMPT when there are no visible candidates', async () => {
    const { service } = build([]);
    await expect(service.pick(user, {}, NOW)).rejects.toMatchObject({ code: 'NO_PROMPT' });
  });

  it('passes the lemmaId filter to visibility and picks among returned candidates', async () => {
    const { service, visibility } = build([prompt('p1', ['l1'])]);
    const chosen = await service.pick(user, { lemmaId: 'l1' }, NOW);
    expect(chosen.id).toBe('p1');
    expect(visibility.visiblePromptCandidates).toHaveBeenCalledWith(user, { lemmaId: 'l1' });
  });

  it('ranks a prompt with a learning card above a never-done-only prompt', async () => {
    const { service, prisma } = build([prompt('zz-plain', ['l0']), prompt('aa-learning', ['l1'])]);
    prisma.srsCard.findMany.mockResolvedValue([
      { lemmaId: 'l1', status: 'learning', nextReviewAt: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    const chosen = await service.pick(user, {}, NOW);
    expect(chosen.id).toBe('aa-learning');
  });

  it('applies the no-repeat exclusion from quota-charged attempts', async () => {
    const { service, prisma } = build([prompt('aa-recent', ['l1']), prompt('zz-fresh', ['l2'])]);
    prisma.rewriteAttempt.groupBy.mockResolvedValue([
      { promptId: 'aa-recent', _max: { scoredAt: new Date(NOW.getTime() - DAY) } },
    ]);
    const chosen = await service.pick(user, {}, NOW);
    expect(chosen.id).toBe('zz-fresh');
  });
});
