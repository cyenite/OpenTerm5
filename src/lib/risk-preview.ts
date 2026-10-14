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

export function useRiskPreview(request: RiskOrderRequest | null, refreshKey?: unknown) {
  const signature = request ? JSON.stringify(request) : '';
  const [state, setState] = useState<PreviewState>({ signature: '', preview: null, problem: null });
  const runner = useRef<LatestTask<PreviewInput, RiskOrderOutcome> | null>(null);
  if (!runner.current) runner.current = new LatestTask(
    (input) => automation.request('manager.risk', { ...input.request, isDryRun: true }),
    (error, input) => setState({ signature: input.signature, preview: null, problem: error instanceof Error ? error.message : String(error) }),
    (preview, input) => setState({ signature: input.signature, preview, problem: null }),
  );
  useEffect(() => {
    if (request) runner.current!.submit({ request, signature });
    return () => runner.current!.cancel();
    // Requests are rebuilt during render; their serialized values determine when inputs change.
  }, [signature, refreshKey]);
  const visible = state.signature === signature && request ? state : { signature, preview: null, problem: null };
  return { ...visible, setProblem: (problem: string | null) => setState((current) => ({ ...current, signature, problem })) };
}
