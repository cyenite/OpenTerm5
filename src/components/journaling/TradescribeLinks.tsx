import { journalLinks, type JournalingView } from '../../../shared/journaling';
import { openInJournal } from '../../lib/journaling';
import { Section, StatusPill } from '../ui/Controls';

interface TradescribeLinksProps {
  view: JournalingView;
}

// Analysis stays in Tradescribe; these open it in the browser. Pro-only tools show what they are
// and how to get them instead of disappearing on Free.
export function TradescribeLinks({ view }: TradescribeLinksProps) {
  return (
    <Section title="Open in Tradescribe" detail="Calendar, reports and AI review open in your browser.">
      <ul className="journal-links">
        {journalLinks.map((link) => {
          const isLocked = !!link.feature && !view.features.includes(link.feature);
          return (
            <li key={link.key} className={isLocked ? 'is-locked' : ''}>
              <button type="button" className="link-button" aria-disabled={isLocked} aria-describedby={isLocked ? `journal-lock-${link.key}` : undefined} onClick={() => { if (!isLocked) openInJournal({ kind: 'link', link: link.key }); }}>{link.label}</button>
              {isLocked && (
                <span id={`journal-lock-${link.key}`} className="journal-lock">
                  <StatusPill status="idle" label="Pro" />
                  <span className="is-muted">Part of Tradescribe Pro.</span>
                  <button type="button" className="link-button" onClick={() => openInJournal({ kind: 'upgrade' })}>Upgrade</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
