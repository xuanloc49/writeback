import type { ReactNode } from 'react';
import { LearnerShell } from '../../components/learner-shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <LearnerShell>{children}</LearnerShell>;
}
