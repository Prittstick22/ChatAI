const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

export const time = (iso: string) => timeFormat.format(new Date(iso));
export const fullTime = (iso: string) => fullFormat.format(new Date(iso));

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function sameDay(a: string, b: string): boolean {
  return dayStart(new Date(a)) === dayStart(new Date(b));
}

/** "Today", "Yesterday", "Tuesday" within a week, otherwise "Tuesday 6 October". */
export function dayLabel(iso: string, now = new Date()): string {
  const days = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return weekdayFormat.format(new Date(iso));
  return dateFormat.format(new Date(iso));
}

/** Compact timestamp for the room list: a time today, a weekday this week, else a date. */
export function listTime(iso: string, now = new Date()): string {
  const days = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86_400_000);
  if (days === 0) return time(iso);
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return weekdayFormat.format(new Date(iso)).slice(0, 3);
  return shortDateFormat.format(new Date(iso));
}

/** Messages from one person within five minutes of each other share a group. */
export function groupsWith(prev: { user: string; created_at: string } | undefined, next: { user: string; created_at: string }): boolean {
  if (!prev || prev.user !== next.user) return false;
  return new Date(next.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const pictographic = /\p{Extended_Pictographic}/u;

/** 1-3 emoji and nothing else: shown large, without a bubble. */
export function isJumboEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !segmenter) return false;
  const graphemes = [...segmenter.segment(trimmed.replace(/\s+/g, ''))].map((s) => s.segment);
  return graphemes.length <= 3 && graphemes.every((g) => pictographic.test(g));
}

export type Segment = { kind: 'text' | 'link' | 'mention'; value: string };

const tokenPattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[\p{L}\p{N}_-]+)/gu;

/** Splits text into plain runs, links and @mentions for rendering. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', value: text.slice(last, index) });
    out.push({ kind: match[1] ? 'link' : 'mention', value: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

export function mentions(text: string, name: string): boolean {
  return segments(text).some((s) => s.kind === 'mention' && s.value.slice(1).toLowerCase() === name.toLowerCase());
}

export function preview(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

/** "Sam", "Sam and Alex", "Sam, Alex and Jordan", "Sam, Alex and 2 others". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length <= 3) return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}
