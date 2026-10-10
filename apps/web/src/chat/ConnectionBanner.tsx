import { CheckIcon, WifiSlashIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Connection } from './useChatSocket';

/** Thin bar under the header while live updates are down, plus a brief "Connected". */
export function ConnectionBanner({ status }: { status: Connection }) {
  const [slow, setSlow] = useState(false);
  const [back, setBack] = useState(false);
  const previous = useRef(status);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status === 'connecting') {
      const timer = window.setTimeout(() => setSlow(true), 2000);
      return () => window.clearTimeout(timer);
    }
    setSlow(false);
    if (status === 'online' && (was === 'reconnecting' || was === 'offline')) {
      setBack(true);
      const timer = window.setTimeout(() => setBack(false), 1800);
      return () => window.clearTimeout(timer);
    }
    if (status !== 'online') setBack(false);
  }, [status]);

  let content: { key: string; tone: string; text: string } | null = null;
  if (status === 'offline') content = { key: 'offline', tone: 'warn', text: "You're offline. Messages will send again once you reconnect." };
  else if (status === 'reconnecting' || (status === 'connecting' && slow)) content = { key: 'reconnecting', tone: 'warn', text: 'Reconnecting to live updates…' };
  else if (back) content = { key: 'back', tone: 'ok', text: 'Connected' };

  return (
    <AnimatePresence initial={false}>
      {content && (
        <motion.div
          key="banner"
          className={`connection ${content.tone}`}
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={content.key} className="connection-inner" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }}>
              {content.tone === 'ok' ? <CheckIcon size={14} weight="bold" /> : content.key === 'offline' ? <WifiSlashIcon size={14} weight="bold" /> : <span className="spinner" aria-hidden />}
              {content.text}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
