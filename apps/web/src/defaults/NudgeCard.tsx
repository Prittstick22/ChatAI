// Default rendering for a `nudge` event (an AI proposal) inside the conversation.
// A plain, approval-first card; the features/ ActionPanel can replace it in main.tsx.
import { CalendarPlusIcon, ChartBarIcon, XIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { NudgeSlotProps } from '../chat/slots';

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function NudgeCard({ nudge, room, me, api, onDismiss, onJump }: NudgeSlotProps) {
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const title = nudge.title ?? nudge.question ?? 'Suggestion';
  const source = nudge.source_message_ids?.[0];
  const validStart = nudge.start_at && !Number.isNaN(Date.parse(nudge.start_at)) ? nudge.start_at : null;

  const createPoll = async () => {
    if (!nudge.question || !nudge.options || nudge.options.length < 2) return;
    try {
      await api.createPoll({ question: nudge.question, options: nudge.options, room: room.id, created_by: me });
      setDone('Poll created');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the poll.");
    }
  };

  return (
    <div className="nudge" role="group" aria-label={title}>
      <div className="nudge-head">
        {nudge.type === 'poll' ? <ChartBarIcon size={18} /> : <CalendarPlusIcon size={18} />}
        <strong>{title}</strong>
        <button type="button" className="icon-button small" aria-label="Dismiss suggestion" onClick={onDismiss}>
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      {nudge.description && <p>{nudge.description}</p>}
      {nudge.type === 'event' && validStart && (
        <p className="nudge-when">{new Date(validStart).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</p>
      )}
      {nudge.type === 'event' && !validStart && <p className="nudge-when">No time agreed yet.</p>}
      {nudge.type === 'poll' && nudge.options && <p className="nudge-when">{nudge.options.join(', ')}</p>}
      <div className="nudge-actions">
        {done ? (
          <span className="nudge-done">{done}</span>
        ) : nudge.type === 'event' && validStart ? (
          <a className="button" href={api.calendarUrl(title, icsDate(validStart))} onClick={() => setDone('Invite downloaded')}>
            Add to calendar
          </a>
        ) : nudge.type === 'poll' ? (
          <button type="button" className="button" onClick={createPoll}>
            Create poll
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
