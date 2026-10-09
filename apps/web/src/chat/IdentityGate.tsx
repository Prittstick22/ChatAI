import { motion } from 'motion/react';
import { Avatar } from './Avatar';
import { PEOPLE } from './people';

export function IdentityGate({ onPick }: { onPick: (name: string) => void }) {
  return (
    <main className="gate">
      <motion.div
        className="gate-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <h1>Who's chatting?</h1>
        <p>Pick a demo person. There's no sign-in, so open a private window to chat as someone else at the same time.</p>
        <div className="gate-people">
          {PEOPLE.map((person, i) => (
            <motion.button
              key={person.name}
              type="button"
              className="gate-person"
              onClick={() => onPick(person.name)}
              initial={{ opacity: 0, y: 18, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 22, delay: 0.12 + i * 0.06 } }}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            >
              <Avatar name={person.name} size={64} />
              <span>{person.name}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </main>
  );
}
