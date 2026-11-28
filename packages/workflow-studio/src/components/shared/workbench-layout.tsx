import type { ReactNode } from 'react';
export function WorkbenchLayout({
  children,
  activePane,
  className = '',
}: {
  children: ReactNode;
  activePane?: string;
  className?: string;
}) {
  return (
    <div data-pane={activePane} className={'grid min-w-0 grid-cols-1 gap-3 min-[781px]:grid-cols-2 ' + className}>
      {children}
    </div>
  );
}
