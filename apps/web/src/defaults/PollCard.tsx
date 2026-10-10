// Default rendering for a poll posted into the conversation. Everyone votes in place and
// sees the results move as votes arrive; your own vote shows before the server confirms.
import { ChartBarIcon, CheckIcon, SparkleIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Avatar } from '../chat/Avatar';
import { listNames } from '../chat/format';
import type { PollSlotProps } from '../chat/slots';

const spring = { type: 'spring', stiffness: 260, damping: 30 } as const;
const pop = { type: 'spring', stiffness: 640, damping: 28 } as const;
const MAX_FACES = 3;

export function PollCard({ poll, me, api, onChange }: PollSlotProps) {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState('');

  const votes = { ...(poll.votes ?? {}) };
  if (pending !== null) votes[me] = pending;
  const voters = poll.options.map((_, i) => Object.keys(votes).filter((user) => votes[user] === i));
  const total = Object.keys(votes).length;
  const top = Math.max(...voters.map((v) => v.length));
  const mine = votes[me];

  const vote = async (index: number) => {
    if (index === mine) return;
    setPending(index);
    setError('');
    try {
      const result = await api.vote(poll.id, me, index);
      if (result.poll) onChange(result.poll);
    } catch {
      setError("Your vote didn't save. Try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="pollcard" role="group" aria-label={`Poll: ${poll.question}`}>
      <div className="pollcard-head">
        <ChartBarIcon size={16} weight="bold" aria-hidden />
        <span>Poll</span>
        {poll.proposal_id && (
          <span className="pollcard-from" title="ChatAI suggested this poll from the conversation">
            <SparkleIcon size={13} weight="fill" aria-hidden />
            Suggested from the chat
          </span>
        )}
      </div>
      <p className="pollcard-question">{poll.question}</p>

      <ul className="pollcard-options">
        {poll.options.map((option, i) => {
          const count = voters[i].length;
          const chosen = mine === i;
          const leading = total > 0 && count === top;
          return (
            <li key={i}>
              <button
                type="button"
                className={['pollcard-option', chosen && 'chosen', leading && 'leading'].filter(Boolean).join(' ')}
                aria-pressed={chosen}
                aria-label={`${option}, ${count} ${count === 1 ? 'vote' : 'votes'}${count ? ` from ${listNames(voters[i])}` : ''}`}
                onClick={() => vote(i)}
              >
                <motion.span className="pollcard-bar" initial={false} animate={{ scaleX: total ? count / total : 0 }} transition={spring} />
                <span className="pollcard-radio">
                  <AnimatePresence initial={false}>
                    {chosen && (
                      <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={pop}>
                        <CheckIcon size={11} weight="bold" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="pollcard-label">{option}</span>
                <span className="pollcard-faces" aria-hidden>
                  <AnimatePresence initial={false} mode="popLayout">
                    {voters[i].slice(0, MAX_FACES).map((user) => (
                      <motion.span
                        key={user}
                        layout
                        layoutId={`vote-${poll.id}-${user}`}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={pop}
                      >
                        <Avatar name={user} size={20} />
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </span>
                <span className="pollcard-count" aria-hidden>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={count}
                      initial={{ y: -10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 10, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      {count}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="pollcard-foot">
        {total === 0 ? 'No votes yet' : `${total} ${total === 1 ? 'vote' : 'votes'}`}
        {mine !== undefined && <span>Tap another option to change your vote</span>}
      </p>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
