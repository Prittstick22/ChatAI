import '@fontsource-variable/figtree';
import { MotionConfig } from 'motion/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Backdrop } from './chat/Backdrop';
import { ChatApp } from './chat/ChatApp';
import { IdentityGate } from './chat/IdentityGate';
import { saveIdentity, savedIdentity } from './chat/people';
import type { ChatSlots } from './chat/slots';
import { CatchUpCard } from './defaults/CatchUpCard';
import { InsightsPanel } from './defaults/InsightsPanel';
import { NudgeCard } from './defaults/NudgeCard';
import { PollCard } from './defaults/PollCard';
import { SmartReplies } from './defaults/SmartReplies';
import './style.css';
import './chat/chat.css';

// AI features plug in here, and only here. Swap a default for a features/ component
// (or add one) without touching the chat components. Prop types: chat/slots.ts.
const slots: ChatSlots = {
  insights: InsightsPanel, // side panel: catch-up, search, actions
  nudge: NudgeCard, // inline card for each `nudge` WebSocket event
  poll: PollCard, // a poll posted into the conversation, with live voting
  catchUp: CatchUpCard, // "While you were away", on the new-messages divider
  composer: SmartReplies, // reply chips above the composer, in your own style
};

function App() {
  const [me, setMe] = useState(savedIdentity);

  const choose = (name: string) => {
    saveIdentity(name);
    const url = new URL(location.href);
    if (url.searchParams.has('as')) {
      url.searchParams.delete('as');
      history.replaceState(null, '', url);
    }
    setMe(name);
  };

  return (
    <>
      <Backdrop />
      {me ? <ChatApp me={me} slots={slots} onSwitchIdentity={choose} /> : <IdentityGate onPick={choose} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
