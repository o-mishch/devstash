'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FadeInProps {
  children: ReactNode;
  index?: number;
  className?: string;
}

export function FadeIn({ children, index = 0, className }: FadeInProps) {
  const ref = useRef<HTMLDivElement>(null);
  // mounted tracks whether JS has hydrated. Before that no opacity class is applied,
  // so server-rendered content stays visible even before the IntersectionObserver fires.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Elements already in the viewport on mount are shown immediately to avoid a
    // flash where content becomes invisible briefly before fading back in.
    const { top, bottom } = el.getBoundingClientRect();
    const alreadyVisible = top < window.innerHeight && bottom >= 0;

    setMounted(true);
    if (alreadyVisible) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-700',
        mounted && !visible && 'opacity-0 translate-y-4',
        mounted && visible && 'opacity-100 translate-y-0',
        className,
      )}
      style={{ transitionDelay: `${(index % 6) * 80}ms` }}
    >
      {children}
    </div>
  );
}
