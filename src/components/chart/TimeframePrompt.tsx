import { useLayoutEffect, useRef, useState } from 'react';
import { parseTimeframe, timeframeDescription } from '../../lib/mt5-timeframes';
import { useStore } from '../../lib/store';
import { closeTimeframePrompt, timeframePrompt, type TimeframePromptState } from '../../lib/timeframe-prompt';
import { setChartTimeframe } from '../../lib/workspace';
import { SurfacePortal } from '../ui/Surface';

interface TimeframePromptBoxProps {
  prompt: TimeframePromptState;
}

// Centred on the chart it changes, as TradingView places it.
function TimeframePromptBox({ prompt }: TimeframePromptBoxProps) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(prompt.text);
  const [center, setCenter] = useState<{ left: number; top: number } | null>(null);
  const timeframe = parseTimeframe(text);

  useLayoutEffect(() => {
    const chart = prompt.view.document.querySelector(`[data-chart-id="${prompt.chartId}"]`)?.getBoundingClientRect();
    setCenter(chart ? { left: chart.left + chart.width / 2, top: chart.top + chart.height / 2 } : null);
    const field = input.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, [prompt]);

  const apply = () => {
    if (!timeframe) return;
    closeTimeframePrompt();
    setChartTimeframe(prompt.chartId, timeframe);
  };

  const hint = timeframe ? `${timeframeDescription(timeframe)} (${timeframe})` : text.trim() ? 'Not a timeframe this terminal offers' : 'Type a timeframe: 15, 4h, 1D, M15';
  return (
    <div className="timeframe-prompt" role="dialog" aria-label="Change timeframe" style={center ?? undefined}>
      <div className="timeframe-prompt-title">Change timeframe</div>
      <input
        ref={input}
        value={text}
        spellCheck={false}
        aria-label="Timeframe"
        aria-invalid={!timeframe}
        onChange={(event) => setText(event.target.value)}
        onBlur={closeTimeframePrompt}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply();
          else if (event.key === 'Escape') closeTimeframePrompt();
          else return;
          event.preventDefault();
        }}
      />
      <div className={`timeframe-prompt-hint${timeframe || !text.trim() ? '' : ' is-invalid'}`}>{hint}</div>
    </div>
  );
}

export function TimeframePromptHost() {
  const prompt = useStore(timeframePrompt, (state) => state.prompt);
  if (!prompt) return null;
  return <SurfacePortal view={prompt.view}><TimeframePromptBox key={`${prompt.chartId}-${prompt.text}`} prompt={prompt} /></SurfacePortal>;
}
