import Dashboard from '@/components/dashboard';
import { DemoSignIn } from '@/components/demo-sign-in';
import { demoEnabled } from '@/lib/demo-session';
export const dynamic = 'force-dynamic';
export default function Page() {
  return demoEnabled() ? <DemoSignIn /> : <Dashboard />;
}
