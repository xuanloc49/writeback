import type { QuotaView } from '../lib/api-types';

export function QuotaLine({ quota }: { quota: QuotaView }) {
  return (
    <p className="text-sm text-muted">
      Còn {quota.rewriteNewLeft} lượt viết lại · {quota.retryLeft} lần sửa hôm nay
    </p>
  );
}
