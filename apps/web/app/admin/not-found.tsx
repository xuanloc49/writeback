import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <section className="grid gap-2">
      <h1 className="font-serif text-2xl">Không tìm thấy</h1>
      <p>Trang quản trị này không tồn tại.</p>
      <p>
        <Link href="/admin">Về tổng quan</Link>
      </p>
    </section>
  );
}
