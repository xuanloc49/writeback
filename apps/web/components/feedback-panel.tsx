import type { IdeaMatchStatus } from '@writeback/shared';
import type { DisplayIssue, UsedWordView } from '../lib/api-types';

const IDEA_LABEL: Record<IdeaMatchStatus, string> = {
  enough: 'Khớp ý',
  missing: 'Thiếu ý',
  off_topic: 'Lệch đề',
};

export function FeedbackPanel({
  ideaMatch,
  usedRequiredWords,
  displayIssues,
  naturalnessNoteVi,
  encouragementVi,
  overallScore,
  modelRewriteEn,
  userEn,
  showModelRewrite,
  modelRewriteCollapsed = false,
}: {
  ideaMatch: { status: IdeaMatchStatus; commentVi: string } | null;
  usedRequiredWords: UsedWordView[];
  displayIssues: DisplayIssue[];
  naturalnessNoteVi: string | null;
  encouragementVi: string | null;
  overallScore: number | null;
  modelRewriteEn: string | null;
  userEn?: string | null;
  showModelRewrite: boolean;
  modelRewriteCollapsed?: boolean;
}) {
  return (
    <div className="grid gap-3">
      {userEn ? (
        <p>
          <span className="text-sm text-muted">Câu của bạn: </span>
          {userEn}
        </p>
      ) : null}
      {ideaMatch ? (
        <div>
          <p className="font-medium">
            {IDEA_LABEL[ideaMatch.status]} — {ideaMatch.commentVi}
          </p>
        </div>
      ) : null}
      {usedRequiredWords.length > 0 ? (
        <ul className="grid gap-2">
          {usedRequiredWords.map((word) => (
            <li key={word.headword} className="rounded-md border border-rule px-3 py-2">
              <strong>{word.headword}</strong>
              <span className="ml-2 text-sm text-muted">
                {word.used ? 'đã dùng' : 'chưa dùng'} ·{' '}
                {word.natural ? 'tự nhiên' : 'chưa tự nhiên'}
              </span>
              <p className="text-sm">{word.commentVi}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {displayIssues.slice(0, 3).map((issue, index) => (
        <p key={`${issue.span}-${index}`} className="text-sm">
          <span className="text-muted">{issue.severity}</span> · {issue.explanationVi}
          {issue.suggestionEn ? ` → ${issue.suggestionEn}` : null}
        </p>
      ))}
      {naturalnessNoteVi ? <p>{naturalnessNoteVi}</p> : null}
      {encouragementVi ? <p>{encouragementVi}</p> : null}
      {overallScore !== null ? <p className="score-aside">Điểm: {overallScore}/100</p> : null}
      {showModelRewrite && modelRewriteEn ? (
        modelRewriteCollapsed ? (
          <details>
            <summary className="cursor-pointer text-sm text-muted">Gợi ý câu mẫu</summary>
            <p className="font-serif mt-2">{modelRewriteEn}</p>
          </details>
        ) : (
          <p className="font-serif">
            <span className="text-sm text-muted">Câu gợi ý: </span>
            {modelRewriteEn}
          </p>
        )
      ) : null}
    </div>
  );
}
