import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>WriteBack — viết lại câu để dùng từ</h1>
      <p>Gói Free có hạn mức viết lại mỗi ngày; gói Premium cho tới 50 lượt/ngày.</p>
      <p>
        <Link href="/login">Đăng nhập để bắt đầu</Link>
      </p>
    </main>
  );
}
