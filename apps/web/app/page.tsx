import Link from 'next/link';
import { API_URL, APP_ORIGIN } from '../lib/config';
import { googleSignInUrl } from '../lib/auth-urls';

function PublicHeader() {
  return (
    <header className="border-b border-rule px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <Link href="/" className="font-serif text-lg text-ink">
          WriteBack
        </Link>
        <nav className="ml-auto flex flex-wrap gap-3 text-sm">
          <Link href="/terms">Điều khoản</Link>
          <Link href="/privacy">Quyền riêng tư</Link>
          <Link href="/login">Đăng nhập</Link>
        </nav>
      </div>
    </header>
  );
}

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 pl-12">
        <p className="text-sm uppercase tracking-[0.2em] text-muted">Tự học tiếng Anh</p>
        <h1 className="font-serif mt-2 text-4xl leading-tight">
          Viết lại câu để dùng từ — rồi ôn đúng lúc cần nhớ.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          WriteBack chọn từ và mẫu tiếng Việt đã duyệt. Bạn viết lại bằng tiếng Anh. Hệ thống chấm
          ý, ngữ pháp và cách dùng từ, rồi đưa từ vào bộ ôn SRS (flashcard, gõ từ, cloze).
        </p>
        <p className="mt-3 text-sm text-muted">
          Gói Free có hạn mức mỗi ngày. Premium cho tới 50 lượt viết lại/ngày — không phải không
          giới hạn.
        </p>
        <p className="mt-8">
          <Link
            className="inline-flex rounded-md bg-accent px-4 py-2 text-accent-ink no-underline"
            href={googleSignInUrl(API_URL, APP_ORIGIN)}
          >
            Đăng nhập với Google
          </Link>
        </p>
      </main>
    </>
  );
}
