import React from 'react';
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRouter, RouterProvider, useLocation, useNavigate } from '@tanstack/react-router';
import WorkflowStudio from './WorkflowStudio';
import './styles.css';
function Standalone() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <WorkflowStudio
      search={location.searchStr}
      onNavigate={(search) => void navigate({ to: '.', search: Object.fromEntries(new URLSearchParams(search)) })}
    />
  );
}
const route = createRootRoute({
  component: Standalone,
  validateSearch: (value: Record<string, unknown>) => value,
});
const router = createRouter({ routeTree: route, basepath: '/workflow' });
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
