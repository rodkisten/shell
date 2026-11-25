import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...values: Parameters<typeof clsx>) => twMerge(clsx(...values));
const variants = cva('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', {variants:{variant:{default:'bg-primary text-primary-foreground hover:opacity-90',outline:'border border-border bg-background hover:bg-muted',ghost:'hover:bg-muted'},size:{default:'h-9 px-3',sm:'h-8 px-2'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({asChild=false,variant,size,className,...props}: React.ComponentProps<'button'> & VariantProps<typeof variants> & {asChild?:boolean}) {
 const Component=asChild?Slot:'button'; return <Component className={cn(variants({variant,size}),className)} {...props}/>;
}
export function Input({className,...props}:React.ComponentProps<'input'>){return <input autoCapitalize="none" autoCorrect="off" className={cn('h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring',className)} {...props}/>;}

export {Sheet} from './sheet';
