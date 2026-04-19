"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Size = { width: number; height: number };

/**
 * Measures the container and passes pixel width/height into the render prop so
 * Recharts `ResponsiveContainer` never sees -1 (common when parent flex/grid
 * has not laid out yet).
 */
export default function ChartSizeGate({
  children,
  className = "",
  fallbackClassName = "min-h-[200px] w-full",
}: {
  children: (size: Size) => ReactNode;
  className?: string;
  fallbackClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(0, Math.floor(rect.width));
      const h = Math.max(0, Math.floor(rect.height));
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={`min-w-0 ${className}`}>
      {size.width > 0 && size.height > 0 ? (
        children(size)
      ) : (
        <div className={fallbackClassName} aria-hidden />
      )}
    </div>
  );
}
