export function formatDateTimeVi(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function srsStatusVi(status: string): string {
  switch (status) {
    case 'new':
      return 'Mới';
    case 'learning':
      return 'Đang học';
    case 'review':
      return 'Ôn';
    case 'mastered':
      return 'Thuộc';
    default:
      return status;
  }
}
