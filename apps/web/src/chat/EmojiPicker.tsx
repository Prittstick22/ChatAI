import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

const EMOJI = [
  '😀', '😂', '🥲', '😊', '😍', '🥳', '😎', '🤔',
  '😮', '😢', '😭', '😤', '🙃', '😴', '🤯', '🫠',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '👋',
  '🤝', '✌️', '🤞', '🫡', '❤️', '💛', '💚', '💙',
  '🔥', '✨', '🎉', '💯', '🚀', '💡', '🏆', '✅',
  '🍕', '🍣', '🌮', '☕', '🍻', '📅', '⏰', '📍',
];

type Props = { onPick: (emoji: string) => void; onClose: () => void; className?: string; label: string };

export function EmojiPicker({ onPick, onClose, className = '', label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);

  // Open downwards when there isn't room above inside the scrolling message list.
  useLayoutEffect(() => {
    const el = ref.current;
    const frame = el?.closest('.scroller');
    if (el && frame && el.getBoundingClientRect().top < frame.getBoundingClientRect().top + 4) setBelow(true);
  }, []);

  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Element;
      // The button that opened the picker toggles it itself.
      if (ref.current?.contains(target) || target.closest?.('[data-picker-toggle]')) return;
      close.current();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape, true);
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);

  return (
    <motion.div
      ref={ref}
      className={`emoji-picker ${className}${below ? ' below' : ''}`}
      role="dialog"
      aria-label={label}
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 4, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
    >
      {EMOJI.map((emoji, i) => (
        <motion.button
          key={emoji}
          type="button"
          className="emoji-cell"
          onClick={() => onPick(emoji)}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: Math.min(i, 24) * 0.008, type: 'spring', stiffness: 600, damping: 30 }}
        >
          {emoji}
        </motion.button>
      ))}
    </motion.div>
  );
}
