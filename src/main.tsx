import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router';
import { App } from './App';
import { TouchTerminal } from './TouchTerminal';
import './styles.css';
import './touch.css';

function RoutedApp() {
  const { pathname } = useLocation();
  return pathname === '/touch' || pathname === '/extension' ? <TouchTerminal /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  </React.StrictMode>,
);
