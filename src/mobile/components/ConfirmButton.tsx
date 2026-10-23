import { useEffect, useState } from 'react';

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  className?: string;
  isBusy?: boolean;
  isDisabled?: boolean;
  onConfirm: () => void;
}

const ARMED_MS = 4_000;

// Trading actions take two taps: the first arms the button and says what the second will do.
export function ConfirmButton({ label, confirmLabel, className = '', isBusy, isDisabled, onConfirm }: ConfirmButtonProps) {
  const [isArmed, setIsArmed] = useState(false);
  useEffect(() => {
    if (!isArmed) return;
    const timer = setTimeout(() => setIsArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [isArmed]);
  const tap = () => {
    if (!isArmed) return setIsArmed(true);
    setIsArmed(false);
    onConfirm();
  };
  return (
    <button type="button" className={`${className}${isArmed ? ' is-armed' : ''}`} disabled={isBusy || isDisabled} onClick={tap}>
      {isBusy ? 'Sending…' : isArmed ? confirmLabel : label}
    </button>
  );
}
