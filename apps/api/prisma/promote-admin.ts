import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error('Cách dùng: pnpm --filter @writeback/api promote-admin -- you@gmail.com');
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (user === null) {
    throw new Error(`Không có user ${email}. Đăng nhập Google một lần rồi chạy lại.`);
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'admin' },
  });
  process.stdout.write(`Đã nâng ${updated.email} lên role=${updated.role}\n`);
  process.stdout.write('Đăng nhập Google lại (nếu cần) rồi mở /admin.\n');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
