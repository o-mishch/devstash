import type { ReactNode, ElementType, MouseEvent } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface GradientCtaProps {
  href?: string;
  children: ReactNode;
  className?: string;
  as?: ElementType;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}

export function GradientCta({ href, children, className, as, onClick }: GradientCtaProps) {
  const Component = as || (href ? Link : 'span');
  const baseClassName = cn(
    'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 px-6 text-sm font-semibold text-slate-900 shadow-lg shadow-cyan-500/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50',
    as !== 'span' && 'hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95',
    !className?.includes('h-') && 'h-11',
    className
  );

  return (
    <Component href={href} className={baseClassName} onClick={onClick}>
      {children}
    </Component>
  );
}
