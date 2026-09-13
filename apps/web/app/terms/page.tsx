import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 pl-12">
      <p className="text-sm">
        <Link href="/">← WriteBack</Link>
      </p>
      <h1 className="font-serif mt-4 text-3xl">Điều khoản sử dụng</h1>
      <p className="text-sm text-muted">Phiên bản hiện tại (cập nhật khi TOS_VERSION đổi).</p>
      <div className="mt-6 grid gap-3 text-sm leading-relaxed">
        <p>
          WriteBack là dịch vụ tự học: bạn viết lại câu tiếng Việt sang tiếng Anh và ôn từ vựng.
          Dành cho người đủ 15 tuổi (tự khai khi chấp nhận điều khoản).
        </p>
        <p>
          Đăng nhập qua Google. Chúng tôi lưu email, tên, bài viết, kết quả chấm, thẻ ôn và nhật ký
          vận hành cần thiết. Bài viết được gửi tới nhà cung cấp mô hình ngôn ngữ để chấm.
        </p>
        <p>
          Hạn mức viết lại mỗi ngày theo gói. Premium tối đa 50 lượt bài mới/ngày. Không có thanh
          toán tự động trong phiên bản này.
        </p>
        <p>
          Bạn có thể xóa tài khoản trong phần Tài khoản bằng cách gõ XOA. Dữ liệu học cá nhân sẽ bị
          xóa cứng.
        </p>
      </div>
    </main>
  );
}
