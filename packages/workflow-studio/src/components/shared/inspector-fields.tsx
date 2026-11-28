import { useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { ChevronDown } from 'lucide-react';
export function InspectorFields({
  groups,
  values,
  render,
}: {
  groups: { title: string; keys: string[] }[];
  values: Record<string, string>;
  render: (key: string) => ReactNode;
}) {
  const [open, setOpen] = useState<string[]>([groups[0]?.title ?? '']);
  return (
    <div className="grid min-w-0 gap-0">
      {groups.map((group) => (
        <section key={group.title} className="min-w-0 border-b border-border">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between gap-2 px-2 text-left"
            aria-expanded={open.includes(group.title)}
            onClick={() =>
              setOpen((old) =>
                old.includes(group.title) ? old.filter((x) => x !== group.title) : [...old, group.title],
              )
            }
          >
            <span className="flex-1">{group.title}</span>
            <small className="text-muted-foreground">
              {group.keys.filter((k) => values[k]?.trim()).length || ''}
            </small>
            <ChevronDown size={14} className={open.includes(group.title) ? 'rotate-180' : ''} />
          </Button>
          {open.includes(group.title) && (
            <div className="grid min-w-0 gap-2 px-2 pb-3">{group.keys.map(render)}</div>
          )}
        </section>
      ))}
    </div>
  );
}
