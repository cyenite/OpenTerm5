import { hintProps } from './Hint';
import { Icon } from './Icon';

interface InfoTipProps {
  title: string;
  description: string;
}

// A button inside a label does not toggle the label's checkbox, so the icon can sit next to its text.
export function InfoTip({ title, description }: InfoTipProps) {
  return (
    <button type="button" className="info-tip" aria-label={`${title}. ${description}`} onClick={(event) => event.preventDefault()} {...hintProps({ title, description })}>
      <Icon name="info" size={14} />
    </button>
  );
}
