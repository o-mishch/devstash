'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useIntersectionObserver } from '@/hooks/ui/use-intersection-observer';

interface FadeInProps {
  children: ReactNode;
  index?: number;
  className?: string;
}

export function FadeIn({ children, index = 0, className }: FadeInProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const { ref: observerRef, inView } = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px',
    triggerOnce: true,
  });

  // observerRef itself is a new function on every render of useIntersectionObserver (it
  // isn't memoized inside that hook), so wrapping this in useCallback doesn't stabilize
  // the reference across renders — it only satisfies the lint rule syntactically. The
  // real fix would live in use-intersection-observer.ts, which is out of scope here.
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      nodeRef.current = node;
      observerRef(node);
    },
    [observerRef],
  );

  // mounted tracks whether JS has hydrated. Before that no opacity class is applied,
  // so server-rendered content stays visible even before the IntersectionObserver fires.
  const [mounted, setMounted] = useState(false);
  const [alreadyVisible, setAlreadyVisible] = useState(false);

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    // Elements already in the viewport on mount are shown immediately to avoid a
    // flash where content becomes invisible briefly before fading back in.
    const { top, bottom } = el.getBoundingClientRect();
    const visible = top < window.innerHeight && bottom >= 0;

    setMounted(true);
    if (visible) {
      setAlreadyVisible(true);
    }
  }, []);

  const visible = alreadyVisible || inView;

  const style = useMemo(() => ({ transitionDelay: `${(index % 6) * 80}ms` }), [index]);

  return (
    <div
      ref={setRefs}
      className={cn(
        'transition-all duration-700',
        mounted && !visible && 'opacity-0 translate-y-4',
        mounted && visible && 'opacity-100 translate-y-0',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
