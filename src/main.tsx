import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router';
import './styles.css';
import './touch.css';

const App = lazy(() => import('./App').then((module) => ({ default: module.App })));
const TouchTerminal = lazy(() => import('./TouchTerminal').then((module) => ({ default: module.TouchTerminal })));

function RoutedApp() {
  const { pathname } = useLocation();
  return (
    <Suspense fallback={<div role="status" className="touch-empty" style={{ minHeight: '100dvh' }}>Carregando ShellConductor…</div>}>
      {pathname === '/touch' || pathname === '/extension' ? <TouchTerminal /> : <App />}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  </React.StrictMode>,
);
