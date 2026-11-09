import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const variants = cva('btn', {
  variants: {
    variant: { default: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', outline: 'btn-outline', danger: 'btn-danger' },
    size: { default: 'btn-md', sm: 'btn-sm', icon: 'btn-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, ...props }, ref) {
  return <button ref={ref} className={cn(variants({ variant, size }), className)} {...props} />;
});
