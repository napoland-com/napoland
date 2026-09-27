/**
 * Checks the roadmap and prints it in order, so a person can read it in a CI log. The roadmap is one
 * Markdown file per item in roadmap/ (README.md aside), each starting with front matter:
 *
 *   ---
 *   id: home-stash-xp-levels          the file name without .md
 *   title: "Home: stash, XP and levels"
 *   status: next                      done, now, next, planned or idea
 *   order: 10                         sorts the items of one status; leave gaps
 *   depends: [finds-bag-piles]        optional: items that come first
 *   area: gameplay                    optional: gameplay, world, social, tech...
 *   ---
 *
 * Errors (exit code 1): front matter missing or malformed, an unknown field, an id that is not the
 * file name, an unknown status, an order that is not a number, a dependency on an item that does not
 * exist, dependencies that go round in a circle, an empty body. Warnings: an item that comes before
 * something it depends on, two items of one status with the same order. Usage: npm run roadmap
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const STATUSES = ['done', 'now', 'next', 'planned', 'idea'] as const;
export type Status = (typeof STATUSES)[number];

const FIELDS = ['id', 'title', 'status', 'order', 'depends', 'area'];
/** Lowercase words joined by hyphens: safe as a file name on every system and in a URL. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AREA = /^[a-z]+(?:-[a-z]+)*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export interface Item {
  id: string;
  title: string;
  status: Status;
  order: number;
  depends: string[];
  area?: string;
  file: string;
}

export interface Problem {
  file: string;
  level: 'error' | 'warning';
  message: string;
}

type Value = string | string[];

export interface FrontMatter {
  fields: Map<string, Value>;
  /** Fields whose value could not be read (an error says why), so they are not reported missing too. */
  unreadable: Set<string>;
  body: string;
  errors: string[];
}

/**
 * Splits a file into its front matter and its body. The front matter is the small part of YAML that
 * the items need (GitHub shows it as a table at the top of the file): `key: value` lines with plain or
 * quoted values, lists as `[a, b]` or as `- a` lines under `key:`, and # comments. Anything else is an
 * error, so a typo cannot quietly change an item. Numbers stay text here; each field reads its own.
 */
export function parseFrontMatter(text: string): FrontMatter {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const fields = new Map<string, Value>();
  const unreadable = new Set<string>();
  const errors: string[] = [];
  if (lines[0]?.trimEnd() !== '---') {
    return { fields, unreadable, body: text, errors: ['no front matter: the file must start with a line that is just ---'] };
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end < 0) return { fields, unreadable, body: '', errors: ['the front matter never ends: close it with a line that is just ---'] };

  let list: string[] | undefined; // the `- item` list under the last `key:`, while it lasts
  for (let i = 1; i < end; i++) {
    const at = `line ${i + 1}`;
    const line = lines[i]!;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const listItem = /^\s*-(?:\s+(.*))?$/.exec(line);
    if (listItem) {
      if (!list) errors.push(`${at}: a "- " list item must come right under its field, like "depends:"`);
      else {
        const value = scalar(listItem[1] ?? '', at, errors);
        if (value !== undefined) list.push(value);
      }
      continue;
    }
    list = undefined;
    const pair = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!pair) {
      errors.push(`${at}: expected "field: value", found "${line.trim()}"`);
      continue;
    }
    const key = pair[1]!;
    if (fields.has(key) || unreadable.has(key)) {
      errors.push(`${at}: "${key}" is there twice`);
      continue;
    }
    const raw = (pair[2] ?? '').trim();
    if (!raw || raw.startsWith('#')) {
      // `key:` alone: a `- item` list may follow; if none does, the value is an empty list.
      list = [];
      fields.set(key, list);
    } else if (raw.startsWith('[')) {
      const flow = raw.replace(/\s+#.*$/, '');
      if (!flow.endsWith(']')) {
        errors.push(`${at}: a list in [brackets] must end with ] on the same line`);
        unreadable.add(key);
        continue;
      }
      const inner = flow.slice(1, -1).trim();
      const values = inner ? inner.split(',').map(part => scalar(part, at, errors)) : [];
      fields.set(key, values.filter((v): v is string => v !== undefined));
    } else {
      const value = scalar(raw, at, errors);
      if (value !== undefined) fields.set(key, value);
      else unreadable.add(key);
    }
  }
  return { fields, unreadable, body: lines.slice(end + 1).join('\n'), errors };
}

/** One value, "double" or 'single' quoted or plain; plain values follow YAML's rules for where they end. */
function scalar(raw: string, at: string, errors: string[]): string | undefined {
  const s = raw.trim();
  const quote = s[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    let i = 1;
    for (; i < s.length; i++) {
      const c = s[i]!;
      if (quote === '"' && c === '\\') {
        const next = s[++i];
        if (next === '"' || next === '\\') out += next;
        else {
          errors.push(`${at}: only \\" and \\\\ are understood inside "quotes"`);
          return undefined;
        }
      } else if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") {
          out += "'";
          i++;
        } else break;
      } else out += c;
    }
    if (i >= s.length) {
      errors.push(`${at}: the quote in ${s} is never closed`);
      return undefined;
    }
    const rest = s.slice(i + 1).trim();
    if (rest && !rest.startsWith('#')) {
      errors.push(`${at}: unexpected "${rest}" after the quoted value`);
      return undefined;
    }
    return out;
  }
  // YAML ends a plain value at " #" (a comment) and reads ": " and some first characters as syntax.
  const value = s.replace(/\s+#.*$/, '');
  if (/^[[\]{}&*!|>%@`,?]/.test(value) || /:(?:\s|$)/.test(value)) {
    errors.push(`${at}: put ${value} in "quotes" (YAML would read part of it as syntax)`);
    return undefined;
  }
  return value;
}

/** Reads one item file. Returns the item only when it is sound; every problem goes to `problems`. */
export function readItem(file: string, text: string, problems: Problem[]): Item | undefined {
  const before = problems.length;
  const error = (message: string) => problems.push({ file, level: 'error', message });
  const name = basename(file, '.md');
  if (!ID.test(name)) error('the file name must be the id: lowercase words joined by hyphens, then .md');

  const { fields, unreadable, body, errors } = parseFrontMatter(text);
  for (const message of errors) error(message);
  if (errors.length && !fields.size && !unreadable.size) return undefined;

  for (const key of fields.keys()) {
    if (!FIELDS.includes(key)) error(`unknown field "${key}" (the fields are ${FIELDS.join(', ')})`);
  }
  const field = (key: string, required: boolean): string | undefined => {
    const value = fields.get(key);
    if (value === undefined) {
      if (required && !unreadable.has(key)) error(`"${key}" is missing`);
      return undefined;
    }
    if (typeof value !== 'string' || !value) {
      error(`"${key}" must be ${value.length ? 'one value, not a list' : 'filled in'}`);
      return undefined;
    }
    return value;
  };

  const id = field('id', true);
  if (id !== undefined && id !== name) {
    error(ID.test(id) ? `id "${id}" must be the file name without .md ("${name}")` : `id "${id}" must be lowercase words joined by hyphens, like home-stash-xp-levels`);
  }
  const title = field('title', true);
  const status = field('status', true);
  if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
    error(`status "${status}" is not one of ${STATUSES.join(', ')}`);
  }
  const orderText = field('order', true);
  if (orderText !== undefined && !NUMBER.test(orderText)) error(`order "${orderText}" must be a number, like 10`);

  const dependsValue = fields.get('depends') ?? [];
  const depends = typeof dependsValue === 'string' ? [dependsValue] : dependsValue;
  for (const dep of depends) if (!ID.test(dep)) error(`depends: "${dep}" is not an id`);
  if (id !== undefined && depends.includes(id)) error('an item cannot depend on itself');
  if (new Set(depends).size < depends.length) problems.push({ file, level: 'warning', message: 'depends names the same item twice' });

  const area = field('area', false);
  if (area !== undefined && !AREA.test(area)) error(`area "${area}" must be a lowercase word, like gameplay, world, social or tech`);

  if (!body.trim()) error('the body is empty: say what the item is and why, in plain words');

  if (problems.slice(before).some(p => p.level === 'error')) return undefined;
  return { id: id!, title: title!, status: status as Status, order: Number(orderText), depends: [...new Set(depends)], ...(area ? { area } : {}), file };
}

/** Every cycle in the dependencies, each as the ids along it with the first repeated at the end. */
export function findCycles(depends: ReadonlyMap<string, readonly string[]>): string[][] {
  const state = new Map<string, 'open' | 'closed'>();
  const path: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string): void => {
    state.set(id, 'open');
    path.push(id);
    for (const next of depends.get(id) ?? []) {
      if (next === id || !depends.has(next)) continue; // reported on their own
      const seen = state.get(next);
      if (seen === 'open') cycles.push([...path.slice(path.indexOf(next)), next]);
      else if (!seen) visit(next);
    }
    path.pop();
    state.set(id, 'closed');
  };
  for (const id of [...depends.keys()].sort()) if (!state.has(id)) visit(id);
  return cycles;
}

const rank = (status: Status) => STATUSES.indexOf(status);

/** Sorted the way the roadmap reads: by status, then order, then id. */
export function sortItems(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => rank(a.status) - rank(b.status) || a.order - b.order || a.id.localeCompare(b.id));
}

/** Checks every item on its own, then how they fit together. `files` are paths like roadmap/x.md with their text. */
export function checkRoadmap(files: readonly { file: string; text: string }[]): { items: Item[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const items: Item[] = [];
  for (const { file, text } of files) {
    const item = readItem(file, text, problems);
    if (item) items.push(item);
  }

  // An id is the file name, so the ids are the file names; a broken file still counts as existing,
  // so one mistake does not turn into errors in every item that depends on it.
  const names = new Map<string, string>();
  for (const { file } of files) {
    const name = basename(file, '.md');
    const other = names.get(name);
    if (other) problems.push({ file, level: 'error', message: `id "${name}" is also used by ${other}` });
    else names.set(name, file);
  }

  const byId = new Map(items.map(item => [item.id, item]));
  for (const item of items) {
    for (const dep of item.depends) {
      if (dep === item.id) continue;
      if (!names.has(dep)) {
        problems.push({ file: item.file, level: 'error', message: `depends on "${dep}", which is not a roadmap item (no roadmap/${dep}.md)` });
        continue;
      }
      const other = byId.get(dep);
      if (other && rank(other.status) > rank(item.status)) {
        problems.push({ file: item.file, level: 'warning', message: `${item.id} is ${item.status} but depends on ${dep}, which is ${other.status}` });
      }
    }
  }

  for (const cycle of findCycles(new Map(items.map(item => [item.id, item.depends])))) {
    problems.push({ file: byId.get(cycle[0]!)!.file, level: 'error', message: `dependencies go round in a circle: ${cycle.join(' -> ')}` });
  }

  const sorted = sortItems(items);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!, b = sorted[i]!;
    if (a.status === b.status && a.order === b.order) {
      problems.push({ file: b.file, level: 'warning', message: `order ${b.order} is also used by ${a.id} (both ${b.status}); ties sort by id` });
    }
  }
  return { items: sorted, problems };
}

/** The roadmap as text: one block per status, one line per item. */
export function formatRoadmap(items: readonly Item[]): string {
  const sorted = sortItems(items);
  const counts = STATUSES.map(status => `${sorted.filter(i => i.status === status).length} ${status}`);
  const idWidth = Math.max(0, ...sorted.map(i => i.id.length));
  const orderWidth = Math.max(0, ...sorted.map(i => String(i.order).length));
  const out = [`Roadmap: ${sorted.length} items (${counts.join(', ')})`];
  for (const status of STATUSES) {
    const group = sorted.filter(i => i.status === status);
    if (!group.length) continue;
    out.push('', status.toUpperCase());
    for (const item of group) {
      const extra = [item.area ? `[${item.area}]` : '', item.depends.length ? `after ${item.depends.join(', ')}` : ''].filter(Boolean).join('  ');
      out.push(`  ${String(item.order).padStart(orderWidth)}  ${item.id.padEnd(idWidth)}  ${item.title}${extra ? `  ${extra}` : ''}`);
    }
  }
  return out.join('\n');
}

/** In a GitHub Actions log a problem becomes an annotation on the file, so it shows on the pull request too. */
function report(p: Problem): void {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const message = p.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${p.level} file=${p.file},title=Roadmap::${message}`);
  } else console.log(`${p.file}: ${p.level}: ${p.message}`);
}

if (import.meta.main) {
  const dir = resolve(import.meta.dirname, '../roadmap');
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md')
    .map(entry => entry.name)
    .sort()
    .map(name => ({ file: `roadmap/${name}`, text: readFileSync(join(dir, name), 'utf8') }));
  const { items, problems } = checkRoadmap(files);
  console.log(formatRoadmap(items));
  console.log('');
  for (const p of problems) report(p);
  const errors = problems.filter(p => p.level === 'error').length;
  console.log(errors ? `roadmap: ${errors} ${errors === 1 ? 'error' : 'errors'}` : `roadmap: ok (${items.length} items)`);
  process.exit(errors ? 1 : 0);
}
