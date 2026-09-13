import {
  ClozeSourceService,
  collectSentenceSources,
  selectClozeSource,
  type AttemptForSources,
} from './cloze-source.service';

const lemma = { id: 'l-submit', headword: 'submit', exampleEn: 'Please submit the form.' };

function attempt(
  userEn: string,
  used: boolean,
  modelRewriteEn: string,
  lemmaId = lemma.id,
): AttemptForSources {
  return {
    userEn,
    targetsSnapshot: [{ lemmaId, headword: 'submit', pos: 'verb', senseVi: 'nộp' }],
    feedback: {
      overall_score: 60,
      idea_match: { status: 'enough', comment_vi: '' },
      used_required_words: [{ headword: 'Submit', used, natural: used, comment_vi: '' }],
      grammar_issues: [],
      lexical_issues: [],
      naturalness_note_vi: '',
      model_rewrite_en: modelRewriteEn,
      encouragement_vi: '',
    },
  };
}

describe('collectSentenceSources (PRD §10.6 source order)', () => {
  it('(a) picks user_en of the most recent attempt with used:true (case-insensitive headword)', () => {
    const sources = collectSentenceSources(
      [
        attempt('I gave it away.', false, 'Model newest'),
        attempt('I submitted it on Monday.', true, 'Model middle'),
        attempt('I submitted it long ago.', true, 'Model oldest'),
      ],
      lemma,
    );
    expect(sources.usedSentence).toBe('I submitted it on Monday.');
    expect(sources.modelRewrite).toBe('Model newest');
    expect(sources.exampleEn).toBe('Please submit the form.');
  });

  it('(b) keeps the most recent model_rewrite_en when the user never used the word', () => {
    const sources = collectSentenceSources(
      [attempt('Nope.', false, 'You should submit it.'), attempt('Nope again.', false, 'Older')],
      lemma,
    );
    expect(sources.usedSentence).toBeNull();
    expect(sources.modelRewrite).toBe('You should submit it.');
  });

  it('ignores attempts targeting other lemmas and attempts with invalid feedback', () => {
    const broken: AttemptForSources = {
      userEn: 'x',
      feedback: { nope: true },
      targetsSnapshot: [],
    };
    const sources = collectSentenceSources(
      [broken, attempt('I submitted other.', true, 'Other', 'l-other')],
      lemma,
    );
    expect(sources).toEqual({
      usedSentence: null,
      modelRewrite: null,
      exampleEn: 'Please submit the form.',
    });
  });
});

describe('selectClozeSource', () => {
  it('blanks every headword / inflection occurrence of the first usable source', () => {
    const source = selectClozeSource(
      { usedSentence: 'She submits; I submitted.', modelRewrite: 'm', exampleEn: 'e' },
      'submit',
    );
    expect(source).toEqual({
      sentence: 'She submits; I submitted.',
      text: 'She ____; I ____.',
      blanked: ['submits', 'submitted'],
    });
  });

  it('skips sources that do not contain the word (word boundary) and falls through in order', () => {
    const source = selectClozeSource(
      {
        usedSentence: 'The submission was late.',
        modelRewrite: '   ',
        exampleEn: 'Please submit the form.',
      },
      'submit',
    );
    expect(source?.text).toBe('Please ____ the form.');
  });

  it('returns null when no source is usable → caller falls back to type mode', () => {
    expect(
      selectClozeSource({ usedSentence: null, modelRewrite: null, exampleEn: null }, 'submit'),
    ).toBeNull();
    expect(
      selectClozeSource(
        { usedSentence: 'No match here.', modelRewrite: null, exampleEn: null },
        'submit',
      ),
    ).toBeNull();
  });
});

describe('ClozeSourceService.sourcesFor (mocked Prisma)', () => {
  it('loads scored attempts of the user targeting the lemma, most recent first', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([attempt('I submitted the report.', true, 'Model')]);
    const tx = { rewriteAttempt: { findMany } } as never;
    const sources = await new ClozeSourceService().sourcesFor(tx, 'u1', lemma);
    expect(sources.usedSentence).toBe('I submitted the report.');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          status: 'scored',
          targetsSnapshot: { array_contains: [{ lemmaId: 'l-submit' }] },
        },
        orderBy: [{ scoredAt: 'desc' }, { revision: 'desc' }],
      }),
    );
  });
});
