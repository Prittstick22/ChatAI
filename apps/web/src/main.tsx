import '@fontsource-variable/figtree';
import { MotionConfig } from 'motion/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './chat/ChatApp';
import { IdentityGate } from './chat/IdentityGate';
import { colorFor, saveIdentity, savedIdentity } from './chat/people';
import type { ChatSlots } from './chat/slots';
import { InsightsPanel } from './defaults/InsightsPanel';
import { NudgeCard } from './defaults/NudgeCard';
import { PollCard } from './defaults/PollCard';
import './style.css';
import './chat/chat.css';

// AI features plug in here, and only here. Swap a default for a features/ component
// (or add one) without touching the chat components. Prop types: chat/slots.ts.
const slots: ChatSlots = {
  insights: InsightsPanel, // side panel: catch-up, search, actions
  nudge: NudgeCard, // inline card for each `nudge` WebSocket event
  poll: PollCard, // a poll posted into the conversation, with live voting
  // catchUp: CatchUpCard,   // on the "new messages" divider when a room opens with unread
  // composer: SmartReplies, // row above the composer; receives insert(text)
};

function App() {
  const [me, setMe] = useState(() => {
    const saved = savedIdentity();
    // Set the accent before the first paint so a reload doesn't fade in from blue.
    if (saved) document.documentElement.style.setProperty('--accent', colorFor(saved));
    return saved;
  });

  const choose = (name: string) => {
    saveIdentity(name);
    const url = new URL(location.href);
    if (url.searchParams.has('as')) {
      url.searchParams.delete('as');
      history.replaceState(null, '', url);
    }
    setMe(name);
  };

  if (!me) return <IdentityGate onPick={choose} />;
  return <ChatApp me={me} slots={slots} onSwitchIdentity={choose} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
