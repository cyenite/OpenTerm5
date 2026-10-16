import { defaultSizes, layoutCells, layoutOf, type LayoutKey } from '../../lib/chart-layouts';

interface LayoutIconProps {
  layout: LayoutKey;
  size?: number;
}

// The layout's slots at equal sizes, drawn from the same split tree the workspace lays out.
export function LayoutIcon({ layout, size = 18 }: LayoutIconProps) {
  const { tree } = layoutOf(layout);
  const width = 22;
  const height = 18;
  const inset = 0.7;
  return (
    <svg className="layout-icon" width={size * width / height} height={size} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {layoutCells(tree, defaultSizes(tree)).map((cell, slot) => (
        <rect key={slot} x={cell.left * width + inset} y={cell.top * height + inset} width={Math.max(0.6, cell.width * width - inset * 2)} height={Math.max(0.6, cell.height * height - inset * 2)} rx={0.8} />
      ))}
    </svg>
  );
}
