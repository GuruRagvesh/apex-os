// Tailwind class merging.
//
// Moved verbatim from frontend/lib/utils.ts. clsx resolves conditionals and
// arrays; tailwind-merge then drops earlier classes that a later class
// overrides, so `cn('p-2', 'p-4')` yields 'p-4' rather than both.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
