import type { ErrorCode } from '@writeback/shared';

/** Business error carrying a design §5.3 code; rendered by AppExceptionFilter. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Vietnamese user-facing messages per error code (design §5.2). */
export const ERROR_MESSAGES_VI: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Bạn cần đăng nhập để tiếp tục.',
  TOS_REQUIRED: 'Bạn cần chấp nhận Điều khoản và Quyền riêng tư phiên bản mới nhất.',
  BETA_BLOCKED: 'Tài khoản của bạn chưa được mời vào bản beta.',
  ONBOARDING_REQUIRED: 'Bạn cần chọn 1–3 chủ đề để bắt đầu học.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu.',
  NO_PROMPT: 'Hiện chưa có bài phù hợp. Hãy ôn tập hoặc đổi chủ đề.',
  VALIDATION: 'Dữ liệu gửi lên không hợp lệ.',
  COPY_BLOCKED: 'Câu của bạn trùng với câu mẫu. Hãy viết theo cách của riêng bạn.',
  UNPUBLISHED: 'Bài này không còn khả dụng. Hãy lấy bài khác.',
  SCORING_IN_PROGRESS: 'Bài đang được chấm, vui lòng chờ một chút.',
  CONFLICT: 'Dữ liệu đã tồn tại hoặc đang xung đột với trạng thái hiện tại.',
  // Generic fallback; throw sites build the concrete message with the reset time (quota-reset.ts).
  QUOTA_EXCEEDED: 'Bạn đã hết lượt viết lại hôm nay. Lượt mới vào ngày mai.',
  RATE_LIMITED: 'Bạn gửi quá nhanh. Vui lòng thử lại sau ít phút.',
  LLM_TIMEOUT: 'Hệ thống chấm bài đang bận. Vui lòng nộp lại.',
  LLM_INVALID_SCHEMA: 'Kết quả chấm không hợp lệ. Vui lòng nộp lại.',
  PAYLOAD_TOO_LARGE: 'Dữ liệu gửi lên quá lớn.',
  INTERNAL: 'Có lỗi xảy ra. Vui lòng thử lại sau.',
};

export function appError(code: ErrorCode, details?: Record<string, unknown>): AppError {
  return new AppError(code, ERROR_MESSAGES_VI[code], details);
}
