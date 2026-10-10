// Default smart replies: up to three replies above the composer when someone else spoke
// last, written the way you write (the chat API sends the AI your own earlier messages
// for style). Tapping one puts it in the composer to edit or send; nothing is sent for you.
import { SparkleIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ComposerSlotProps } from '../chat/slots';

// Per room, message and person, so switching rooms back doesn't ask again.
const cache = new Map<string, string[]>();

export function SmartReplies({ room, me, api, messages, insert }: ComposerSlotProps) {
  const last = messages.findLast((m) => !m.deleted);
  const key = last && last.user !== me ? `${room.id}:${last.id}:${me}` : '';
  const [fetched, setFetched] = useState({ key: '', replies: [] as string[] });
  const [used, setUsed] = useState('');

  useEffect(() => {
    if (!key) return;
    const hit = cache.get(key);
    if (hit) return setFetched({ key, replies: hit });
    let live = true;
    // A short wait, so a burst of messages asks once.
    const timer = setTimeout(() => {
      api.replies(room.id, me).then(
        ({ replies }) => {
          cache.set(key, replies);
          if (live) setFetched({ key, replies });
        },
        () => {}, // no chips is the fallback
      );
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, api, room.id, me]);

  const shown = key && fetched.key === key && used !== key ? fetched.replies : [];

  return (
    <AnimatePresence>
      {shown.length > 0 && (
        <motion.div
          key={key}
          className="smart-replies"
          role="group"
          aria-label="Suggested replies"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <SparkleIcon className="smart-replies-icon" size={16} weight="fill" aria-hidden="true" />
          {shown.map((text, i) => (
            <motion.button
              key={text}
              type="button"
              className="smart-reply"
              title={text}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, type: 'spring', stiffness: 420, damping: 30 }}
              onClick={() => {
                setUsed(key);
                insert(text);
              }}
            >
              {text}
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
