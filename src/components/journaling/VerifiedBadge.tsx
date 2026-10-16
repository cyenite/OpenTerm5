import { verifiedSources, type VerifiedSource } from '../../../shared/journaling';

interface VerifiedBadgeProps {
  source: VerifiedSource | null;
}

export function VerifiedBadge({ source }: VerifiedBadgeProps) {
  const verified = verifiedSources.find((item) => item.key === source);
  if (!verified) return null;
  return <span className="journal-verified" title={verified.detail} aria-label={`${verified.label}: ${verified.detail}`}>{verified.label}</span>;
}
