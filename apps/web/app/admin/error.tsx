'use client';

import { Button, ErrorBanner } from '../../components/ui';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid gap-3">
      <h1 className="font-serif text-2xl">Không tải được trang quản trị</h1>
      <ErrorBanner message={error.message} />
      <Button type="button" onClick={reset}>
        Thử lại
      </Button>
    </div>
  );
}
