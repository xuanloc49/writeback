'use client';

import { DeleteAccountForm, OnboardingForm, useMe } from '../../../components/learner-shell';
import { Card } from '../../../components/ui';

export default function AccountPage() {
  const { me } = useMe();
  if (me === null) {
    return null;
  }

  return (
    <div className="grid gap-6">
      <h1 className="font-serif text-3xl">Tài khoản</h1>
      {me.learningBlockedReason === 'BETA_BLOCKED' ? (
        <p role="status">
          Tài khoản của bạn chưa được mời vào bản beta. Bạn chưa vào được luồng học.
        </p>
      ) : null}
      <Card>
        <p>{me.email}</p>
        <p className="text-sm text-muted">
          Gói {me.plan} · tới {me.limits.rewriteNewPerDay} lượt viết lại/ngày
        </p>
        {me.tosAcceptedAt ? (
          <p className="text-sm text-muted">
            Đã chấp nhận điều khoản: {me.tosAcceptedAt.slice(0, 10)}
          </p>
        ) : null}
      </Card>
      {me.learningBlockedReason !== 'BETA_BLOCKED' ? <OnboardingForm me={me} /> : null}
      <DeleteAccountForm />
    </div>
  );
}
