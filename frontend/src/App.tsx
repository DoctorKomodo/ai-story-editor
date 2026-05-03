import type { JSX } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DevErrorOverlay } from '@/components/DevErrorOverlay';
import { AppRouter } from '@/router';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRouter />
      <DevErrorOverlay />
    </BrowserRouter>
  );
}
