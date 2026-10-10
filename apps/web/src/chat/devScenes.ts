// The demo's live scenes, played from the dev panel (the same scenes as
// scripts/demo.py): other people come online in the open room, type, post and vote,
// and wait for the AI's suggestions so each take plays the same way.
import { CHAT_WS_URL, chatApi } from './api';
import type { Message, Poll, Proposal, ServerEvent } from './types';

export type SceneId = 'poll' | 'plan';
export type Log = (line: string) => void;

const SUGGESTION_WITHIN = 30_000;
const POLL_WITHIN = 120_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (window.clearTimeout(timer), reject(signal.reason)), { once: true });
  });
}

/** Someone in the scene: online over their own WebSocket, typing before they post. */
class Person {
  private ws: WebSocket | null = null;
  // Events wait here until a waitFor() takes them, so none is missed in between.
  private queue: ServerEvent[] = [];
  private wake: (() => void) | null = null;

  constructor(readonly name: string, readonly room: string, private signal: AbortSignal, private log: Log) {}

  open(): Promise<void> {
    const ws = (this.ws = new WebSocket(`${CHAT_WS_URL}?user=${encodeURIComponent(this.name)}&room=${encodeURIComponent(this.room)}`));
    ws.onmessage = (e) => {
      try {
        this.queue.push(JSON.parse(e.data));
        this.wake?.();
      } catch {
        // not JSON
      }
    };
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`${this.name} couldn't connect to the chat server.`));
    });
  }

  close() {
    this.ws?.close();
  }

  async say(text: string, pause = 1200): Promise<Message> {
    this.ws?.send(JSON.stringify({ type: 'typing', room: this.room }));
    await sleep(Math.min(2600, 700 + text.length * 35), this.signal);
    const message = await chatApi.send({ room: this.room, user: this.name, text });
    this.log(`${this.name}: ${text}`);
    await sleep(pause, this.signal);
    return message;
  }

  /** The first event from now on (or already waiting) that `pick` returns a value for. */
  async waitFor<T>(pick: (event: ServerEvent) => T | null | undefined | false, ms: number): Promise<T | null> {
    const deadline = Date.now() + ms;
    for (;;) {
      while (this.queue.length) {
        const found = pick(this.queue.shift()!);
        if (found) return found;
      }
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, left);
        this.wake = () => (window.clearTimeout(timer), resolve());
        this.signal.addEventListener('abort', () => (window.clearTimeout(timer), reject(this.signal.reason)), { once: true });
      });
      this.wake = null;
    }
  }
}

async function withPeople(room: string, names: string[], signal: AbortSignal, log: Log, play: (people: Person[]) => Promise<void>) {
  const people = names.map((name) => new Person(name, room, signal, log));
  try {
    await Promise.all(people.map((p) => p.open()));
    await sleep(1000, signal);
    await play(people);
  } finally {
    for (const p of people) p.close();
  }
}

const nudge = (type: string, test: (n: Proposal) => boolean = () => true) => (e: ServerEvent) =>
  e.type === 'nudge' && e.nudge.type === type && test(e.nudge) ? e.nudge : null;

/** The group argues about food; the AI suggests a poll; once it's made, they vote. */
function pollScene(room: string, signal: AbortSignal, log: Log) {
  return withPeople(room, ['Jordan', 'Taylor', 'Alex'], signal, log, async ([jordan, taylor, alex]) => {
    await jordan.say('For food after, pizza or tacos?');
    await taylor.say('tacos! or the ramen place by the station');
    await alex.say("I'm easy, all three sound good");
    // The card can arrive with two options and grow a third once ramen comes up.
    const card = await alex.waitFor(nudge('poll', (n) => (n.options ?? []).some((o) => /ramen/i.test(o))), SUGGESTION_WITHIN);
    log(card ? 'The poll suggestion is up: tap Create poll.' : 'No poll suggestion with all three options yet; tap Create poll when it shows.');
    const poll = await alex.waitFor<Poll>((e) => e.type === 'message' && e.message.room === room && e.message.poll, POLL_WITHIN);
    if (!poll) throw new Error('Nobody created the poll within 2 minutes.');

    const option = (word: string, fallback: number) => {
      const i = poll.options.findIndex((label) => label.toLowerCase().includes(word));
      return i >= 0 ? i : Math.min(fallback, poll.options.length - 1);
    };
    for (const [person, word, fallback, pause] of [
      ['Taylor', 'ramen', 2, 1400],
      ['Jordan', 'taco', 1, 1800],
      ['Alex', 'ramen', 2, 1600],
    ] as const) {
      await sleep(pause, signal);
      const index = option(word, fallback);
      await chatApi.vote(poll.id, person, index);
      log(`${person} voted ${poll.options[index]}`);
    }
    await sleep(2500, signal);
    await jordan.say('ramen it is then 🍜', 500);
  });
}

/** A call is planned for 7pm, then moved to 8pm: the event card updates. */
function planScene(room: string, signal: AbortSignal, log: Log) {
  return withPeople(room, ['Alex', 'Taylor', 'Jordan'], signal, log, async ([alex, taylor, jordan]) => {
    await alex.say('Should we do a quick call tomorrow at 7pm to go over the plan?');
    await taylor.say('7 works for me');
    if (!(await alex.waitFor(nudge('event'), SUGGESTION_WITHIN))) throw new Error('No event suggestion arrived; check the AI service logs.');
    log('The event card is up.');
    await sleep(4000, signal);
    await jordan.say("Can we make it 8? I've got training until 7:30");
    await alex.say('8pm then');
    await taylor.say('👍', 300);
    if (!(await alex.waitFor(nudge('event', (n) => Boolean(n.replaces)), SUGGESTION_WITHIN))) {
      throw new Error("The event card didn't update; check the AI service logs.");
    }
    log('The event card moved to 8pm.');
  });
}

export const SCENES: { id: SceneId; label: string; about: string; play: typeof pollScene }[] = [
  { id: 'poll', label: 'Food poll', about: 'They argue about food, the AI suggests a poll, then they vote.', play: pollScene },
  { id: 'plan', label: 'Plan changes', about: 'A call is set for 7pm, then moved to 8pm.', play: planScene },
];
