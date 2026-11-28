import type { ReactNode } from 'react';
import { Button } from '../ui/button';

export type PanelNavigationItem = {
  id: string;
  label: string;
  icon?: ReactNode;
};

export function PanelNavigation({
  items,
  value,
  onChange,
  label = 'Panels',
}: {
  items: readonly PanelNavigationItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto pb-1">
      {items.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="sm"
          variant={value === item.id ? 'default' : 'ghost'}
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
          className="shrink-0 whitespace-nowrap gap-1"
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
    </nav>
  );
}
