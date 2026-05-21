import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isPublicHost } from '@/lib/public-host';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (isPublicHost(headers().get('host'))) redirect('/');
  return <>{children}</>;
}
