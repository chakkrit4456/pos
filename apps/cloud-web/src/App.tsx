import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@/components/ui/core';
import { useSession } from '~/lib/session';
import { Shell } from '~/components/Shell';
import Login from '~/pages/Login';
import Stores from '~/pages/Stores';
import StorePage from '~/pages/Store';
import Admin from '~/pages/Admin';
import Account from '~/pages/Account';

export function App() {
  const { user, loading } = useSession();
  if (loading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!user) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Stores />} />
        <Route path="/s/:tid" element={<StorePage />} />
        <Route path="/account" element={<Account />} />
        {user.isSuperadmin && <Route path="/admin" element={<Admin />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
