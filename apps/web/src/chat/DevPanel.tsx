// Dev tools for rehearsing and recording the demo: reset to the demo story, load a
// premade chat, clear chats, play the live scenes and switch who you are. Hidden until
// Ctrl+Shift+D (or the button ?dev adds), so it never shows up on camera.
import { ArrowCounterClockwiseIcon, PlayIcon, StopIcon, WrenchIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, devApi, type Story } from './api';
import { Avatar } from './Avatar';
import { SCENES, type SceneId } from './devScenes';
import { PEOPLE } from './people';
import type { Room } from './types';

const OPEN_KEY = 'chatai:dev-open';

function remembered(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(open: boolean) {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // storage unavailable: the panel just starts closed
  }
}

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Scene = { id: SceneId; room: string; lines: string[]; state: 'playing' | 'done' | 'stopped' | 'failed' };
type Props = { me: string; room: Room | undefined; onSwitchIdentity: (name: string) => void };

/** A destructive button that asks again inline (never a browser dialog). */
function Confirmable({ label, ask, confirm, busy, disabled, asking, onAsk, onConfirm }: {
  label: string;
  ask: ReactNode;
  confirm: string;
  busy: boolean;
  disabled: boolean;
  asking: boolean;
  onAsk: (asking: boolean) => void;
  onConfirm: () => void;
}) {
  if (!asking) {
    return (
      <button type="button" className="button secondary" disabled={disabled} onClick={() => onAsk(true)}>
        {busy ? 'Working…' : label}
      </button>
    );
  }
  return (
    <div className="devpanel-ask" role="group">
      <span>{ask}</span>
      <button type="button" className="button danger" onClick={onConfirm}>
        {confirm}
      </button>
      <button type="button" className="button secondary" onClick={() => onAsk(false)}>
        Cancel
      </button>
    </div>
  );
}

export function DevPanel({ me, room, onSwitchIdentity }: Props) {
  const [open, setOpen] = useState(remembered);
  const [stories, setStories] = useState<Story[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const playing = useRef<AbortController | null>(null);
  const withButton = new URLSearchParams(location.search).has('dev');

  useEffect(() => remember(open), [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || stories) return;
    devApi.stories().then(setStories, (e) => setError(errorText(e)));
  }, [open, stories]);

  const demo = stories?.find((s) => s.presenter) ?? stories?.[0];

  // Each of these makes every open tab reload (a `reset` event). The panel comes back
  // closed, so the page is ready to record.
  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id);
    setAsking(null);
    setError(null);
    playing.current?.abort();
    remember(false);
    try {
      await run();
    } catch (e) {
      setError(errorText(e));
      remember(true);
    } finally {
      setBusy(null);
    }
  };

  const play = (id: SceneId) => {
    if (!room) return;
    playing.current?.abort();
    const controller = (playing.current = new AbortController());
    const update = (change: (s: Scene) => Scene) => setScene((s) => (s && playing.current === controller ? change(s) : s));
    setScene({ id, room: room.name, lines: [], state: 'playing' });
    setOpen(false); // out of shot; the scene carries on
    SCENES.find((s) => s.id === id)!
      .play(room.id, controller.signal, (line) => update((s) => ({ ...s, lines: [...s.lines, line] })))
      .then(
        () => update((s) => ({ ...s, state: 'done' })),
        (e) =>
          update((s) =>
            controller.signal.aborted ? { ...s, state: 'stopped' } : { ...s, state: 'failed', lines: [...s.lines, errorText(e)] },
          ),
      );
  };

  const idle = busy === null;
  const sceneLabel = scene && SCENES.find((s) => s.id === scene.id)?.label;

  return (
    <>
      {withButton && !open && (
        <button type="button" className="dev-toggle" aria-label="Dev tools" onClick={() => setOpen(true)}>
          <WrenchIcon size={18} weight="bold" />
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.aside
            key="dev"
            className="devpanel"
            aria-label="Dev tools"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          >
            <header className="devpanel-top">
              <WrenchIcon size={16} weight="bold" aria-hidden="true" />
              <h2>Dev tools</h2>
              <kbd>Ctrl ⇧ D</kbd>
              <button type="button" className="icon-button small" aria-label="Close dev tools" onClick={() => setOpen(false)}>
                <XIcon size={16} weight="bold" />
              </button>
            </header>

            {error && (
              <p className="devpanel-error" role="alert">
                {error}
              </p>
            )}

            <section className="devpanel-section">
              <button
                type="button"
                className="button devpanel-reset"
                disabled={!demo || !idle}
                onClick={() => demo && act('reset', () => devApi.reset(demo.id))}
              >
                <ArrowCounterClockwiseIcon size={16} weight="bold" />
                {busy === 'reset' ? 'Resetting…' : 'Reset the demo'}
              </button>
              <p className="devpanel-note">
                Backs up and deletes every chat, then loads {demo ? <strong>{demo.name}</strong> : 'the demo chat'}
                {demo?.presenter && <>, with {demo.presenter} away since the start</>}. Takes a few seconds while the catch-up is prepared.
              </p>
            </section>

            <section className="devpanel-section">
              <h3>Premade chats</h3>
              {stories === null ? (
                <p className="devpanel-note">{error ? 'Not available.' : 'Loading…'}</p>
              ) : stories.length === 0 ? (
                <p className="devpanel-note">No premade chats in fixtures/.</p>
              ) : (
                <ul className="devpanel-list">
                  {stories.map((s) => (
                    <li key={s.id}>
                      <div className="devpanel-story">
                        <strong>{s.name}</strong>
                        <span>
                          {plural(s.messages, 'message')} · {s.people.join(', ')}
                        </span>
                      </div>
                      <button type="button" className="button secondary" disabled={!idle} onClick={() => act(`load-${s.id}`, () => devApi.load(s.id))}>
                        {busy === `load-${s.id}` ? 'Loading…' : 'Load'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="devpanel-note">Loading a chat replaces the one with the same name.</p>
            </section>

            {room && (
              <section className="devpanel-section">
                <h3>Live scenes in {room.name}</h3>
                <div className="devpanel-row">
                  {SCENES.map((s) => (
                    <button key={s.id} type="button" className="button secondary" title={s.about} disabled={!idle} onClick={() => play(s.id)}>
                      <PlayIcon size={12} weight="fill" /> {s.label}
                    </button>
                  ))}
                  {scene?.state === 'playing' && (
                    <button type="button" className="button secondary" onClick={() => playing.current?.abort()}>
                      <StopIcon size={12} weight="fill" /> Stop
                    </button>
                  )}
                </div>
                <p className="devpanel-note">Alex, Jordan and Taylor come online and play it out. The panel closes so you can film it.</p>
                {scene && (
                  <div className={`devpanel-log ${scene.state}`} aria-live="polite">
                    <p className="devpanel-log-title">
                      {sceneLabel} in {scene.room}:{' '}
                      {scene.state === 'playing' ? 'playing…' : scene.state === 'done' ? 'done' : scene.state === 'stopped' ? 'stopped' : 'failed'}
                    </p>
                    <ol>
                      {scene.lines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            )}

            {room && (
              <section className="devpanel-section">
                <h3>This chat</h3>
                <div className="devpanel-row">
                  <Confirmable
                    label="Clear messages"
                    ask={
                      <>
                        Delete {plural(room.message_count, 'message')} in {room.name}?
                      </>
                    }
                    confirm="Clear"
                    busy={busy === 'clear'}
                    disabled={!idle}
                    asking={asking === 'clear'}
                    onAsk={(on) => setAsking(on ? 'clear' : null)}
                    onConfirm={() => act('clear', () => devApi.clear(room.id))}
                  />
                  <Confirmable
                    label="Delete chat"
                    ask={<>Delete {room.name} for everyone?</>}
                    confirm="Delete"
                    busy={busy === 'delete'}
                    disabled={!idle}
                    asking={asking === 'delete'}
                    onAsk={(on) => setAsking(on ? 'delete' : null)}
                    onConfirm={() => act('delete', () => devApi.deleteRoom(room.id))}
                  />
                </div>
              </section>
            )}

            <section className="devpanel-section">
              <h3>Everything</h3>
              <Confirmable
                label="Delete every chat"
                ask="Back up, then delete every chat and message?"
                confirm="Delete all"
                busy={busy === 'wipe'}
                disabled={!idle}
                asking={asking === 'wipe'}
                onAsk={(on) => setAsking(on ? 'wipe' : null)}
                onConfirm={() => act('wipe', () => devApi.reset())}
              />
            </section>

            <section className="devpanel-section">
              <h3>View as</h3>
              <div className="devpanel-people">
                {PEOPLE.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={p.name === me ? 'devpanel-person active' : 'devpanel-person'}
                    aria-pressed={p.name === me}
                    onClick={() => p.name !== me && onSwitchIdentity(p.name)}
                  >
                    <Avatar name={p.name} size={22} />
                    {p.name}
                  </button>
                ))}
              </div>
            </section>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
