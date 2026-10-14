const paths = {
  newChart: <><path d="M4 4v16h16" /><path d="m7 15 4-4 3 3 5-6" /><path d="M17 3v5M14.5 5.5h5" /></>,
  marketWatch: <><path d="M4 6h9M4 12h9M4 18h9" /><path d="m17 8 2.5-3L22 8" /><path d="m17 16 2.5 3 2.5-3" /></>,
  navigator: <><path d="M3 5h6l2 2h10v12H3z" /><path d="M7 12h10M7 15.5h6" /></>,
  dataWindow: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.5h18M10 9.5V20" /></>,
  toolbox: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" /><path d="M6.5 17h5" /></>,
  depth: <><path d="M12 4v16" /><path d="M11 6.5H6M11 10H3.5M11 13.5H7" /><path d="M13 10.5h4.5M13 14h7M13 17.5h3.5" /></>,
  oneClick: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />,
  bars: <><path d="M8 4v16M5 8h3M8 15h3" /><path d="M16 6v13M13 10h3M16 16h3" /></>,
  candles: <><path d="M8 3v3M8 17v4M16 5v4M16 15v3" /><rect x="5.5" y="6" width="5" height="11" rx="1" /><rect x="13.5" y="9" width="5" height="6" rx="1" /></>,
  line: <><path d="M3 20h18" /><path d="m3 15 5-6 4 4 4-7 5 5" /></>,
  area: <><path d="M3 20h18" /><path d="m3 15 5-6 4 4 4-7 5 5v9H3z" fill="currentColor" fillOpacity="0.18" /></>,
  baseline: <><path d="M3 12h18" strokeDasharray="2 2" /><path d="m3 15 4-6 4 5 4-8 3 4 3-2" /></>,
  hollow: <><path d="M8 3v3M8 17v4M16 5v4M16 15v3" /><rect x="5.5" y="6" width="5" height="11" rx="1" /><rect x="13.5" y="9" width="5" height="6" rx="1" fill="currentColor" /></>,
  heikinashi: <><path d="M8 4v16M16 6v12" /><rect x="5.5" y="7" width="5" height="9" rx="1" fill="currentColor" fillOpacity="0.3" /><rect x="13.5" y="9" width="5" height="5" rx="1" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" /></>,
  cursor: <path d="m5 3 14 7.5-6.2 1.6L10 18.5z" />,
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 2v6M12 16v6M2 12h6M16 12h6" /></>,
  hline: <><path d="M3 12h18" /><circle cx="12" cy="12" r="1.6" /></>,
  trend: <><path d="M4 19 20 5" /><circle cx="5.5" cy="17.7" r="1.8" /><circle cx="18.5" cy="6.3" r="1.8" /></>,
  vline: <><path d="M12 3v18" /><circle cx="12" cy="12" r="1.6" /></>,
  ray: <><path d="M5 12h16" /><path d="m17.5 8.5 3.5 3.5-3.5 3.5" /><circle cx="4.5" cy="12" r="1.6" /></>,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1" />,
  fibonacci: <><path d="M3 4h18M3 9.5h18M3 14h18M3 20h18" /><path d="m5 20 14-16" strokeDasharray="2 2" /></>,
  riskOrder: <><path d="M3 7h18" /><path d="M3 12h18" strokeDasharray="2.5 2" /><path d="M3 17h18" /><path d="M20 3.5v3M20 17.5v3" /></>,
  analysis: <><path d="M3 20h18" /><path d="m4 15 4.5-5 3.5 3 4-6 4 4" /><circle cx="17" cy="7" r="3.2" /><path d="m19.3 9.3 2.2 2.2" /></>,
  indicators: <><path d="M3 20h18" /><path d="M3 16c3-8 5-8 7-3s4 5 7-5l4-4" /></>,
  alert: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  camera: <><path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  positions: <><path d="M3 8h12" /><path d="M3 16h18" strokeDasharray="2.5 2" /><path d="m17 5 3 3-3 3" /></>,
  objects: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7" /><path d="M6 7l1 13h10l1-13" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  replay: <><path d="M5 4v16" /><path d="m9 6 10 6-10 6z" /></>,
  objectTree: <><path d="M4 5h6M4 5v14M4 12h5M4 19h5" /><rect x="12" y="3" width="8" height="4" rx="1" /><rect x="11" y="10" width="9" height="4" rx="1" /><rect x="11" y="17" width="9" height="4" rx="1" /></>,
  chartSettings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  exit: <><path d="M14 4h6v16h-6" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
} as const;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
