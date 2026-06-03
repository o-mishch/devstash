import type { ReactNode, ElementType } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const gradientCtaBase = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 px-6 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50';
const gradientCtaHover = 'hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95';

interface GradientCtaProps {
  href?: string;
  children: ReactNode;
  className?: string;
  as?: ElementType;
  onClick?: (e: any) => void;
}

export function GradientCta({ href, children, className, as, onClick }: GradientCtaProps) {
  const Component = as || (href ? Link : 'span');
  const baseClassName = cn(
    gradientCtaBase,
    as !== 'span' && gradientCtaHover,
    !className?.includes('h-') && 'h-11',
    className
  );

  return (
    <Component href={href} className={baseClassName} onClick={onClick}>
      {children}
    </Component>
  );
}
