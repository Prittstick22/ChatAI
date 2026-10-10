// Default rendering for a `nudge` event (an AI proposal) inside the conversation.
// A plain, approval-first card; the features/ ActionPanel can replace it in main.tsx.
// A poll made from it is posted into the chat, and the card goes away in every tab.
// When the plan changes, a new card replaces this one and shows the time it had.
import { CalendarPlusIcon, ChartBarIcon, XIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { NudgeSlotProps } from '../chat/slots';

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const valid = (iso?: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? iso : null);
const fullWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
const shortWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function NudgeCard({ nudge, room, me, api, onDismiss, onJump }: NudgeSlotProps) {
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const title = nudge.title ?? nudge.question ?? 'Suggestion';
  const source = nudge.source_message_ids?.[0];
  const [busy, setBusy] = useState(false);
  const validStart = valid(nudge.start_at);
  const was = nudge.replaces ? valid(nudge.previous_start_at) : null;
  const moved = was && was !== validStart ? was : null;

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
      <div className="nudge-head">
        {nudge.type === 'poll' ? <ChartBarIcon size={18} /> : <CalendarPlusIcon size={18} />}
        <strong>{title}</strong>
        {nudge.replaces && <span className="nudge-updated">Updated</span>}
        <button type="button" className="icon-button small" aria-label="Dismiss suggestion" onClick={onDismiss}>
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      {nudge.description && <p>{nudge.description}</p>}
      {nudge.type === 'event' && validStart && (
        <motion.p
          className="nudge-when"
          initial={moved ? { opacity: 0, filter: 'blur(6px)' } : false}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          {fullWhen(validStart)}
        </motion.p>
      )}
      {nudge.type === 'event' && !validStart && <p className="nudge-when">No time agreed yet.</p>}
      {moved && (
        <p className="nudge-was">
          Was <s>{shortWhen(moved)}</s>
        </p>
      )}
      {nudge.type === 'poll' && nudge.options && <p className="nudge-when">{nudge.options.join(', ')}</p>}
      <div className="nudge-actions">
        {done ? (
          <span className="nudge-done">{done}</span>
        ) : nudge.type === 'event' && validStart ? (
          <a className="button" href={api.calendarUrl(title, icsDate(validStart))} onClick={() => setDone('Invite downloaded')}>
            Add to calendar
          </a>
        ) : nudge.type === 'poll' ? (
          <button type="button" className="button" onClick={createPoll} disabled={busy}>
            {busy ? 'Posting poll…' : 'Create poll'}
          </button>
        ) : null}
        {source !== undefined && (
          <button type="button" className="button secondary" onClick={() => onJump(source)}>
            Show message
          </button>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
