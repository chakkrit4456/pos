import '@/lib/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/ui/dialog';
import { ApiError } from '~/lib/api';
import { SessionProvider } from '~/lib/session';
import { App } from './App';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SessionProvider>
          <ConfirmProvider>
            <App />
            <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit', fontSize: 15 } }} />
          </ConfirmProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
