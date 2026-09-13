import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Figtree, Source_Serif_4 } from 'next/font/google';
import './globals.css';

const sans = Figtree({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-figtree',
});

const serif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-source',
});

export const metadata: Metadata = {
  title: 'WriteBack',
  description: 'Viết lại câu để dùng từ — luyện từ vựng tiếng Anh cho người tự học.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className={`${sans.variable} ${serif.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
