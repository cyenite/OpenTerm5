import { useLayoutEffect, useRef, useState } from 'react';

// A row that sheds detail in steps instead of overflowing. While it would overflow, the level rises
// (up to `levels`); each step comes back once the row regains the width that step needed. The row
// and its direct children are observed, so content growing inside a fixed-width row is noticed, and
// a new `contentKey` (different content, such as another mode) starts over from level 0.
export function useCompactLevel<T extends HTMLElement>(levels: number, contentKey?: unknown) {
  const element = useRef<T>(null);
  const neededWidths = useRef<number[]>([]);
  const [level, setLevel] = useState(0);
  const [measuredKey, setMeasuredKey] = useState(contentKey);

  if (measuredKey !== contentKey) {
    setMeasuredKey(contentKey);
    setLevel(0);
  }

  useLayoutEffect(() => {
    const row = element.current;
    if (!row) return;
    const measure = () => {
      if (level < levels && row.scrollWidth > row.clientWidth + 1) {
        neededWidths.current[level] = row.scrollWidth;
        setLevel(level + 1);
      } else if (level > 0 && row.clientWidth >= neededWidths.current[level - 1]) setLevel(level - 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of row.children) observer.observe(child);
    return () => observer.disconnect();
  }, [level, levels, contentKey]);

  return { element, level };
}
