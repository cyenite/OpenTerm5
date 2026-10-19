import { useEffect, useRef, useState } from 'react';
import type { RiskOrderOutcome, RiskOrderRequest } from '../../shared/automation';
import { LatestTask } from '../../shared/latest-task';
import { automation } from './automation';

interface PreviewInput {
  readonly signature: string;
  readonly request: RiskOrderRequest;
}

interface PreviewState {
  readonly signature: string;
  readonly problem: string | null;
  readonly preview: RiskOrderOutcome | null;
}

export type RiskPreviewer = (request: RiskOrderRequest) => Promise<RiskOrderOutcome>;

const livePreview: RiskPreviewer = (request) => automation.request('manager.risk', { ...request, isDryRun: true });

// `previewer` prices the request on the venue it will trade on: the live trade manager by
// default, or a backtest's simulated account.
export function useRiskPreview(request: RiskOrderRequest | null, refreshKey?: unknown, previewer: RiskPreviewer = livePreview) {
  const signature = request ? JSON.stringify(request) : '';
  const [state, setState] = useState<PreviewState>({ signature: '', preview: null, problem: null });
  const previewerRef = useRef(previewer);
  previewerRef.current = previewer;
  const runner = useRef<LatestTask<PreviewInput, RiskOrderOutcome> | null>(null);
  if (!runner.current) runner.current = new LatestTask(
    (input) => previewerRef.current(input.request),
    (error, input) => setState({ signature: input.signature, preview: null, problem: error instanceof Error ? error.message : String(error) }),
    (preview, input) => setState({ signature: input.signature, preview, problem: null }),
  );
  useEffect(() => {
    if (request) runner.current!.submit({ request, signature });
    return () => runner.current!.cancel();
    // Requests are rebuilt during render; their serialized values determine when inputs change.
  }, [signature, refreshKey, previewer]);
  const visible = state.signature === signature && request ? state : { signature, preview: null, problem: null };
  return { ...visible, setProblem: (problem: string | null) => setState((current) => ({ ...current, signature, problem })) };
}
