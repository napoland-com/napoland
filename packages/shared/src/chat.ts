/**
 * Chat: world chat reaches everyone online, local chat whoever is on your map within LOCAL_REACH.
 * The server decides who hears what; nothing said is kept. Words on the list (content/words.json)
 * are masked with asterisks before anyone hears them.
 */

/** The longest thing one message may say. */
export const MAX_SAY_CHARS = 120;
/** Local chat reaches this far (tiles, center to center) on the speaker's map. */
export const LOCAL_REACH = 12;
/** A speech bubble stays this long over the speaker's head (seconds). */
export const BUBBLE_S = 6;

export type ChatTo = 'world' | 'local';

/** Letters written as digits or signs, the way people dodge a filter. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/**
 * A word as the filter compares it: lower case, leet read back, and a letter said three or more times
 * said once ("fuuuck"). Pairs stay, so a real word with a double letter never turns into a listed one.
 */
export function plainWord(word: string): string {
  return word.toLowerCase().replace(/[013457@$]/g, c => LEET[c]!).replace(/(.)\1{2,}/gu, '$1');
}

/** `text` with every word on the list (compared as plainWord) masked, one asterisk per character. */
export function maskWords(text: string, words: ReadonlySet<string>): string {
  if (!words.size) return text;
  return text.replace(/[\p{L}\p{N}@$]+/gu, w => (words.has(plainWord(w)) ? '*'.repeat(w.length) : w));
}
