// Default rendering for a `nudge` event (an AI proposal) inside the conversation.
// An approval-first card: what was spotted, the message it came from, and one button to
// act on it. The features/ ActionPanel can replace it in main.tsx.
// A poll made from it is posted into the chat, and the card goes away in every tab.
// When the plan changes, a new card replaces this one and shows the time it had.
import { CalendarBlankIcon, CalendarDotsIcon, CalendarPlusIcon, ChartBarIcon, CheckIcon, ClockIcon, XIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { dayLabel, time } from '../chat/format';
import type { NudgeSlotProps } from '../chat/slots';
import type { ChatMessage } from '../chat/types';

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const valid = (iso?: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? iso : null);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const shortWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The message to show as evidence: for an event, the latest one that names a time. */
function evidenceFor(type: string, sources: ChatMessage[]): ChatMessage | undefined {
  const usable = sources.filter((m) => !m.deleted && !m.poll && m.text.trim());
  if (type === 'event') return usable.findLast((m) => /\d/.test(m.text)) ?? usable[0];
  return usable[0];
}

export function NudgeCard({ nudge, room, me, api, sources = [], onDismiss, onJump }: NudgeSlotProps) {
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = nudge.title ?? nudge.question ?? 'Suggestion';
  const source = nudge.source_message_ids?.[0];
  const validStart = valid(nudge.start_at);
  const was = nudge.replaces ? valid(nudge.previous_start_at) : null;
  const moved = was && was !== validStart ? was : null;
  const isPoll = nudge.type === 'poll';
  const evidence = evidenceFor(nudge.type, sources);
  const Kind = isPoll ? ChartBarIcon : CalendarDotsIcon;

  const createPoll = async () => {
    if (!nudge.question || !nudge.options || nudge.options.length < 2) return;
    setBusy(true);
    try {
      await api.createPoll({ question: nudge.question, options: nudge.options, room: room.id, created_by: me, proposal_id: nudge.id });
      onDismiss(); // the poll itself is now in the chat
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the poll.");
      setBusy(false);
    }
  };

  return (
    <div className="nudge" role="group" aria-label={title}>
      <p className="nudge-kicker">
        <span className="nudge-kicker-icon" aria-hidden="true">
          <Kind size={14} weight="bold" />
        </span>
        {isPoll ? 'Suggested poll' : 'Suggested event'}
        {nudge.replaces && <span className="nudge-updated">Updated</span>}
      </p>

      <div className="nudge-main">
        <span className="nudge-icon" aria-hidden="true">
          <Kind size={24} weight="duotone" />
        </span>
        <div className="nudge-copy">
          <strong className="nudge-title">{title}</strong>
          {nudge.type === 'event' &&
            (validStart ? (
              <motion.p
                key={validStart}
                className="nudge-when"
                initial={moved ? { opacity: 0, filter: 'blur(6px)' } : false}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.5, delay: 0.15 }}
              >
                <span>
                  <CalendarBlankIcon size={16} aria-hidden="true" /> {day(validStart)}
                </span>
                <span>
                  <ClockIcon size={16} aria-hidden="true" /> {clock(validStart)}
                </span>
              </motion.p>
            ) : (
              <p className="nudge-when">No time agreed yet.</p>
            ))}
          {moved && (
            <p className="nudge-was">
              Was <s>{shortWhen(moved)}</s>
            </p>
          )}
          {nudge.description && <p className="nudge-desc">{nudge.description}</p>}
          {isPoll && nudge.options && (
            <ul className="nudge-options" aria-label="Options">
              {nudge.options.map((option) => (
                <li key={option}>{option}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {evidence && (
        <button type="button" className="nudge-evidence" onClick={() => onJump(evidence.id)}>
          <span className="nudge-evidence-label">From the chat</span>
          <span className="nudge-evidence-text">{evidence.text}</span>
          <span className="nudge-evidence-by">
            {evidence.user} · {dayLabel(evidence.created_at)}, {time(evidence.created_at)}
            {sources.length > 1 && ` · and ${sources.length - 1} more`}
          </span>
        </button>
      )}

      <div className="nudge-actions">
        {done ? (
          <span className="nudge-done">
            <CheckIcon size={16} weight="bold" /> {done}
          </span>
        ) : nudge.type === 'event' && validStart ? (
          <a className="button" href={api.calendarUrl(title, icsDate(validStart))} onClick={() => setDone('Invite downloaded')}>
            <CalendarPlusIcon size={18} weight="bold" /> Add to calendar
          </a>
        ) : isPoll ? (
          <button type="button" className="button" onClick={createPoll} disabled={busy}>
            <CheckIcon size={16} weight="bold" /> {busy ? 'Posting poll…' : 'Create poll'}
          </button>
        ) : null}
        {!evidence && source !== undefined && (
          <button type="button" className="button secondary" onClick={() => onJump(source)}>
            Show message
          </button>
        )}
        <button type="button" className="button secondary" aria-label="Dismiss suggestion" onClick={onDismiss}>
          <XIcon size={16} weight="bold" /> Dismiss
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
