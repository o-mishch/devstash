'use client';

import { useEffect, useRef } from 'react';
import { loadCanvasIcons } from '@/lib/canvas-icons';

interface FloatingIcon {
  img: HTMLImageElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotV: number;
  scale: number;
  scaleT: number;
}

const ICON_R = 22;
const SPEED = 0.6;

export function ChaosCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const rawCanvas = canvasRef.current;
    if (!rawCanvas) return;
    const canvas = rawCanvas;
    const rawCtx = canvas.getContext('2d');
    if (!rawCtx) return;
    const ctx = rawCtx;

    let icons: FloatingIcon[] = [];
    const mouse = { x: -9999, y: -9999 };
    let raf = 0;
    let cancelled = false;

    function resize() {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = canvas.offsetHeight || 240;
      icons.forEach(ic => {
        ic.x = Math.min(Math.max(ic.x, ICON_R), canvas.width - ICON_R);
        ic.y = Math.min(Math.max(ic.y, ICON_R), canvas.height - ICON_R);
      });
    }

    function spawn(images: HTMLImageElement[]) {
      const W = canvas.width || 400;
      const H = canvas.height || 240;
      icons = images.map((img) => {
        return {
          img,
          x: ICON_R * 2 + Math.random() * (W - ICON_R * 4),
          y: ICON_R * 2 + Math.random() * (H - ICON_R * 4),
          vx: (Math.random() - 0.5) * SPEED * 2,
          vy: (Math.random() - 0.5) * SPEED * 2,
          rot: Math.random() * Math.PI * 2,
          rotV: (Math.random() - 0.5) * 0.015,
          scale: 1,
          scaleT: Math.random() * Math.PI * 2,
        };
      });
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const S = ICON_R * 2;

      icons.forEach(ic => {
        const dx = ic.x - mouse.x;
        const dy = ic.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const repelRadius = 100;
        if (dist < repelRadius && dist > 0) {
          const force = ((repelRadius - dist) / repelRadius) * 3;
          ic.vx += (dx / dist) * force * 0.04;
          ic.vy += (dy / dist) * force * 0.04;
        }

        ic.vx *= 0.985;
        ic.vy *= 0.985;

        const cx = W / 2;
        const cy = H / 2;
        const fromCenter = Math.sqrt((ic.x - cx) ** 2 + (ic.y - cy) ** 2);
        if (fromCenter > Math.sqrt((W / 2) ** 2 + (H / 2) ** 2) * 0.85) {
          ic.vx += (cx - ic.x) * 0.002;
          ic.vy += (cy - ic.y) * 0.002;
        }

        if (Math.abs(ic.vx) < 0.1 && Math.abs(ic.vy) < 0.1) {
          ic.vx += (Math.random() - 0.5) * 0.3;
          ic.vy += (Math.random() - 0.5) * 0.3;
        }

        const speed = Math.sqrt(ic.vx * ic.vx + ic.vy * ic.vy);
        if (speed > 3) {
          ic.vx = (ic.vx / speed) * 3;
          ic.vy = (ic.vy / speed) * 3;
        }

        ic.x += ic.vx;
        ic.y += ic.vy;

        if (ic.x < ICON_R) { ic.x = ICON_R; ic.vx = Math.abs(ic.vx); }
        if (ic.x > W - ICON_R) { ic.x = W - ICON_R; ic.vx = -Math.abs(ic.vx); }
        if (ic.y < ICON_R) { ic.y = ICON_R; ic.vy = Math.abs(ic.vy); }
        if (ic.y > H - ICON_R) { ic.y = H - ICON_R; ic.vy = -Math.abs(ic.vy); }

        ic.rot += ic.rotV;
        ic.scaleT += 0.025;
        ic.scale = 1 + Math.sin(ic.scaleT) * 0.06;

        ctx.save();
        ctx.translate(ic.x, ic.y);
        ctx.rotate(ic.rot);
        ctx.scale(ic.scale, ic.scale);
        ctx.drawImage(ic.img, -ICON_R, -ICON_R, S, S);
        ctx.restore();
      });
    }

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    const onMouseLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    const onTouchMove = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches[0];
      mouse.x = (t.clientX - rect.left) * (canvas.width / rect.width);
      mouse.y = (t.clientY - rect.top) * (canvas.height / rect.height);
    };

    const resizeObserver = new ResizeObserver(() => resize());
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });

    loadCanvasIcons().then(images => {
      if (cancelled) return;
      resize();
      spawn(images);
      tick();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}
