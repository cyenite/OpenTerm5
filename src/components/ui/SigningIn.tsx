import type { AccountSignIn } from '../../../shared/protocol';
import { signInName } from '../../lib/session';

interface SigningInProps {
  signIn: AccountSignIn;
  className?: string;
}

export function SigningIn({ signIn, className }: SigningInProps) {
  return (
    <span className={`signing-in${className ? ` ${className}` : ''}`} role="status">
      <span className="spinner" aria-hidden />
      Signing in to {signInName(signIn)}…
    </span>
  );
}
