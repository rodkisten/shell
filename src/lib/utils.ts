import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function truncate(value: string, max = 70) { return value.length > max ? value.slice(0, max - 1) + '…' : value; }
