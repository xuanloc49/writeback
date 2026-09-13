import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 pl-12">
      <p className="text-sm">
        <Link href="/">← WriteBack</Link>
      </p>
      <h1 className="font-serif mt-4 text-3xl">Quyền riêng tư</h1>
      <p className="text-sm text-muted">Phiên bản hiện tại (cập nhật khi PRIVACY_VERSION đổi).</p>
      <div className="mt-6 grid gap-3 text-sm leading-relaxed">
        <p>
          <strong>Dữ liệu người dùng:</strong> email và tên từ Google; bài viết tiếng Anh; phản hồi
          chấm; thẻ SRS; nhật ký kiểm toán. Analytics không gửi nội dung câu.
        </p>
        <p>
          <strong>Bên xử lý:</strong> Google (đăng nhập), OpenAI (chấm bài), Neon (cơ sở dữ liệu),
          Fly (API), Vercel (giao diện), Sentry (lỗi), Upstash (giới hạn tốc độ).
        </p>
        <p>Cookie phiên HttpOnly. Không bán dữ liệu. Tuổi 15+ theo checkbox tự khai.</p>
        <p>
          Xóa tài khoản xóa PII học liệu. Nhật ký kiểm toán được ẩn danh và giữ theo chính sách lưu
          trữ.
        </p>
      </div>
    </main>
  );
}
