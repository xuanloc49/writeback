'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { apiGetMe } from '../../lib/api';
import { googleSignInUrl } from '../../lib/auth-urls';
import { API_URL, APP_ORIGIN } from '../../lib/config';
import { afterAuthPath } from '../../lib/learner-gate';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    void apiGetMe().then((me) => {
      if (me !== null) {
        router.replace(afterAuthPath(me));
      }
    });
  }, [router]);

  return (
    <main className="mx-auto max-w-md px-4 py-16 pl-12">
      <h1 className="font-serif text-3xl">Đăng nhập</h1>
      <p className="mt-3 text-muted">WriteBack dùng Google. Email Google là tài khoản của bạn.</p>
      <p className="mt-8">
        <a
          className="inline-flex rounded-md bg-accent px-4 py-2 text-accent-ink no-underline"
          href={googleSignInUrl(API_URL, APP_ORIGIN)}
        >
          Tiếp tục với Google
        </a>
      </p>
      <p className="mt-6 text-sm">
        <Link href="/">Về trang chủ</Link>
      </p>
    </main>
  );
}
