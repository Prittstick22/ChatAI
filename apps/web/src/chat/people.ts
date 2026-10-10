// Demo identities. There is no sign-in: each browser profile picks one, so a normal
// window and a private window can chat as two different people.

export type Person = { name: string; color: string };

// Each colour keeps white text above 4.5:1 contrast on a sent bubble.
export const PEOPLE: Person[] = [
  { name: 'Alex', color: '#2F54EB' },
  { name: 'Sam', color: '#C4510A' },
  { name: 'Jordan', color: '#08875F' },
  { name: 'Taylor', color: '#C2255C' },
];

// Senders outside the demo four (seed scripts, smoke tests) get a stable muted colour.
const OTHERS = ['#5B6472', '#7A5C3E', '#4F6D7A', '#6B5B95', '#5E7046'];

export function colorFor(name: string): string {
  const known = PEOPLE.find((p) => p.name === name);
  if (known) return known.color;
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return OTHERS[hash % OTHERS.length];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return [...words[0]][0].toUpperCase();
  return ([...words[0]][0] + [...words[words.length - 1]][0]).toUpperCase();
}

const STORAGE_KEY = 'chatai.identity';

/** Who this tab is. Each tab keeps its own choice (sessionStorage), so two tabs can
 * be two people; a new tab starts as whoever was picked last. `?as=Sam` overrides. */
export function savedIdentity(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('as')?.trim();
  if (fromUrl) return fromUrl.slice(0, 40);
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveIdentity(name: string | null): void {
  try {
    for (const storage of [sessionStorage, localStorage]) {
      if (name) storage.setItem(STORAGE_KEY, name);
      else storage.removeItem(STORAGE_KEY);
    }
  } catch {
    // storage unavailable or blocked: the choice lasts until the tab reloads
  }
}
