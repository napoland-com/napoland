import { describe, expect, it } from 'vitest';
import {
  AuthConfig, DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, FEED_MAX, MAX_AUTH_CHARS, MAX_HELLO_BYTES, MAX_MESSAGE_BYTES, OAUTH_PROVIDERS, PROTOCOL_VERSION, REFILL_PER_SECOND, TileMap,
  WEATHER_DRAIN, dirOf, dirToward, energyAfter, energyRate, findPath, footprint, isOAuthProvider, lotDoors, objectTiles, parseClientMsg, stepTarget, validateMap, validateWorld, type MapData, type MapObject,
  type NpcLook,
} from '../src';

/** A 6x5 town: water on the right, a house in the middle (its door at 2,1 leads inside), a raised tile top-left. */
function tinyMap(): MapData {
  return {
    id: 'tiny', name: 'Tiny', version: 1, kind: 'town', depth: 0, width: 6, height: 5,
    tiles: ['ggggww', 'ggggww', 'grrrww', 'ggggww', 'ffggww'],
    levels: ['100000', '000000', '000000', '000000', '000000'],
    spawn: { x: 1, y: 3, dir: 'down' },
    exits: [{ x: 2, y: 1, w: 1, h: 1, to: 'tiny-house', tx: 2, ty: 3, dir: 'up' }],
    objects: [
      { kind: 'house', x: 1, y: 0, w: 3, h: 2, roof: '#6b7075', lit: 1 },
      { kind: 'sign', x: 3, y: 3, text: ['Hello'] },
      { kind: 'shrooms', x: 0, y: 4 },
    ],
  };
}

/** The inside of the tiny house: walls around a 3x3 floor, a fireplace at the back, the door at the bottom. */
function tinyHouse(): MapData {
  return {
    id: 'tiny-house', name: 'Tiny house', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'tiny', tx: 2, ty: 2, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1 }, { kind: 'rug', x: 1, y: 2, w: 3, h: 1 }],
  };
}

/**
 * A 7x6 patch of woods: a ring of path inside the forest, a street lamp in the top-left corner of
 * the ring and the way home (to the town above) at the bottom.
 */
function woodsMap(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 7, height: 6,
    tiles: ['tttgttt', 'tgggggt', 'tgtttgt', 'tgtttgt', 'tgggggt', 'tttmttt'],
    levels: Array<string>(6).fill('0000000'),
    spawn: { x: 3, y: 4, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 1, h: 1, to: 'tiny', tx: 1, ty: 3, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 1, y: 1 }],
  };
}

/** The town with a way into the woods on its left edge: two tiles that keep their offset. */
function townWithExit(): MapData {
  const m = tinyMap();
  m.exits.push({ x: 0, y: 2, w: 2, h: 1, to: 'woods', tx: 2, ty: 4, dir: 'up' });
  return m;
}

describe('TileMap', () => {
  const map = new TileMap(tinyMap());
  it('knows what can be walked on', () => {
    expect(map.walkable(0, 2)).toBe(true);
    expect(map.walkable(4, 2)).toBe(false); // water
    expect(map.walkable(1, 1)).toBe(false); // house footprint
    expect(map.walkable(2, 1)).toBe(true); // the house's door: every building can be entered
    expect(map.walkable(3, 3)).toBe(false); // sign
    expect(map.walkable(0, 0)).toBe(false); // raised tile
    expect(map.walkable(0, 4)).toBe(true); // mushrooms are decoration
    expect(map.walkable(-1, 0)).toBe(false);
    expect(map.walkable(1.5, 2)).toBe(false);
  });
  it('reads tile kinds', () => {
    expect(map.kind(1, 2)).toBe('road');
    expect(map.kind(0, 4)).toBe('ferns');
    expect(map.kind(9, 9)).toBeUndefined();
  });
  it('rejects unknown tiles', () => {
    const bad = tinyMap();
    bad.tiles[0] = 'ggggwX';
    expect(() => new TileMap(bad)).toThrow(/unknown tile/);
  });
});

describe('exits, light and the way home', () => {
  const woods = new TileMap(woodsMap());
  const town = new TileMap(townWithExit());
  it('does not walk through forest', () => {
    expect(woods.walkable(0, 0)).toBe(false);
    expect(woods.walkable(3, 0)).toBe(true);
  });
  it('says where an exit leads, keeping the offset within the exit', () => {
    expect(woods.exitAt(3, 5)).toEqual({ to: 'tiny', x: 1, y: 3, dir: 'down' });
    expect(woods.exitAt(3, 4)).toBeUndefined();
    expect(town.exitAt(0, 2)).toEqual({ to: 'woods', x: 2, y: 4, dir: 'up' });
    expect(town.exitAt(1, 2)).toEqual({ to: 'woods', x: 3, y: 4, dir: 'up' });
    expect(town.exitAt(2, 1)).toEqual({ to: 'tiny-house', x: 2, y: 3, dir: 'up' });
    expect(town.exitAt(-1, 2)).toBeUndefined();
  });
  it('knows where the street lights reach', () => {
    expect(woods.lit(2, 1)).toBe(true);
    expect(woods.lit(1, 3)).toBe(true);
    expect(woods.lit(1, 4)).toBe(false);
    expect(town.lit(0, 3)).toBe(false);
  });
  it('knows the warm tiles around a fireplace, and walls and furniture are solid', () => {
    const house = new TileMap(tinyHouse());
    expect(house.warm(1, 1)).toBe(true);
    expect(house.warm(1, 2)).toBe(true); // diagonal
    expect(house.warm(2, 3)).toBe(false);
    expect(house.walkable(0, 2)).toBe(false); // wall
    expect(house.walkable(2, 1)).toBe(false); // the fireplace
    expect(house.walkable(2, 2)).toBe(true); // a rug is only drawn
    expect(woods.warm(2, 1)).toBe(false); // a street light is not a fire
  });
  it('counts walking steps to the home exit', () => {
    expect(woods.homeSteps(3, 5)).toBe(0);
    expect(woods.homeSteps(3, 4)).toBe(1);
    expect(woods.homeSteps(1, 2)).toBe(5);
    // Round the right side: the lamp blocks the short way on the left.
    expect(woods.homeSteps(3, 1)).toBe(8);
    expect(woods.homeSteps(0, 0)).toBe(-1);
    expect(town.homeSteps(0, 3)).toBe(0);
  });
});

describe('energy', () => {
  const woods = new TileMap(woodsMap());
  const town = new TileMap(tinyMap());
  const house = new TileMap(tinyHouse());
  it('comes back only next to a fireplace', () => {
    expect(energyRate(house, 1, 1, 'rain')).toBe(REFILL_PER_SECOND);
    const campfire = new TileMap({ ...woodsMap(), objects: [{ kind: 'fireplace', x: 5, y: 2 }] });
    expect(energyRate(campfire, 5, 3, 'night')).toBe(REFILL_PER_SECOND);
  });
  it('holds in town and inside, away from the fire', () => {
    expect(energyRate(town, 0, 3, 'rain')).toBe(0);
    expect(energyRate(house, 2, 3, 'rain')).toBe(0);
  });
  it('drains in the wilds, even under a street light, more the farther from home and in bad weather', () => {
    const edge = energyRate(woods, 3, 4, 'overcast');
    expect(edge).toBeCloseTo(-DRAIN_PER_SECOND * (1 + 1 / DRAIN_GROWTH_STEPS));
    expect(energyRate(woods, 2, 1, 'overcast')).toBeCloseTo(-DRAIN_PER_SECOND * (1 + 9 / DRAIN_GROWTH_STEPS));
    expect(energyRate(woods, 4, 1, 'overcast')).toBeCloseTo(-DRAIN_PER_SECOND * (1 + 7 / DRAIN_GROWTH_STEPS));
    expect(energyRate(woods, 3, 4, 'rain')).toBeCloseTo(edge * WEATHER_DRAIN.rain);
    expect(energyRate(woods, 3, 4, 'night')).toBeLessThan(energyRate(woods, 3, 4, 'rain'));
  });
  it('drains faster in deeper regions', () => {
    const deep = new TileMap({ ...woodsMap(), depth: 3 });
    expect(energyRate(deep, 3, 4, 'overcast')).toBeCloseTo(3 * energyRate(woods, 3, 4, 'overcast'));
  });
  it('counts forward between updates, never past empty or full', () => {
    expect(energyAfter({ value: 50, max: 100, rate: -2 }, 10)).toBe(30);
    expect(energyAfter({ value: 5, max: 100, rate: -2 }, 10)).toBe(0);
    expect(energyAfter({ value: 95, max: 100, rate: 8 }, 10)).toBe(100);
  });
});

describe('movement', () => {
  const map = new TileMap(tinyMap());
  it('finds a path around obstacles', () => {
    const path = findPath(map, 0, 3, 3, 4);
    expect(path.at(-1)).toEqual({ x: 3, y: 4 });
    let x = 0, y = 3;
    for (const p of path) {
      expect(Math.abs(p.x - x) + Math.abs(p.y - y)).toBe(1);
      expect(map.walkable(p.x, p.y)).toBe(true);
      x = p.x; y = p.y;
    }
  });
  it('walks to the closest reachable tile when the target is blocked', () => {
    const path = findPath(map, 0, 3, 5, 2);
    expect(path.at(-1)).toEqual({ x: 3, y: 2 });
  });
  it('can stop next to something', () => {
    const path = findPath(map, 0, 3, 3, 3, true);
    const end = path.at(-1)!;
    expect(Math.abs(end.x - 3) + Math.abs(end.y - 3)).toBe(1);
  });
  it('converts directions', () => {
    expect(stepTarget(2, 2, 'left')).toEqual({ x: 1, y: 2 });
    expect(dirOf(0, -1)).toBe('up');
    expect(dirOf(1, 1)).toBeNull();
    expect(dirToward(-3, 1)).toBe('left');
    expect(dirToward(1, 4)).toBe('down');
  });
});

describe('protocol', () => {
  it('accepts valid messages', () => {
    expect(parseClientMsg('{"t":"hello","v":1,"name":"Aldo"}')).toEqual({ t: 'hello', v: 1, name: 'Aldo' });
    expect(parseClientMsg('{"t":"step","dir":"up","seq":3}')).toEqual({ t: 'step', dir: 'up', seq: 3 });
    expect(parseClientMsg('{"t":"face","dir":"left"}')).toEqual({ t: 'face', dir: 'left' });
  });
  it('takes how many to feed (1 to FEED_MAX, one when left out) and to throw away (all when left out)', () => {
    expect(parseClientMsg('{"t":"feed","x":1,"y":2,"slot":0}')).toEqual({ t: 'feed', x: 1, y: 2, slot: 0 });
    expect(parseClientMsg(`{"t":"feed","x":1,"y":2,"slot":0,"count":${FEED_MAX}}`)).toEqual({ t: 'feed', x: 1, y: 2, slot: 0, count: FEED_MAX });
    expect(parseClientMsg('{"t":"discard","slot":3,"count":2}')).toEqual({ t: 'discard', slot: 3, count: 2 });
    expect(parseClientMsg('{"t":"discard","slot":3}')).toEqual({ t: 'discard', slot: 3 });
    for (const raw of [
      '{"t":"feed","x":1,"y":2,"slot":0,"count":0}', `{"t":"feed","x":1,"y":2,"slot":0,"count":${FEED_MAX + 1}}`, '{"t":"feed","x":1,"y":2,"slot":0,"count":1.5}',
      '{"t":"feed","x":1,"y":2,"slot":0,"count":"3"}', '{"t":"discard","slot":0,"count":0}', '{"t":"discard","slot":0,"count":-2}', '{"t":"discard","slot":0,"count":1000}',
    ]) expect(parseClientMsg(raw), raw).toBeNull();
  });
  it('rejects anything else', () => {
    for (const raw of [
      'not json',
      '{"t":"step","dir":"north","seq":1}',
      '{"t":"step","dir":"up","seq":-1}',
      '{"t":"step","dir":"up","seq":1.5}',
      '{"t":"hello","v":1,"name":"x"}',
      '{"t":"hello","v":1,"name":"<script>"}',
      '{"t":"teleport","x":5,"y":5}',
      JSON.stringify({ t: 'hello', v: 1, name: 'A'.repeat(2000) }),
    ]) expect(parseClientMsg(raw), raw).toBeNull();
  });
  it('takes a hello with a sign-in, which may be longer than other messages, up to its own limit', () => {
    const jwt = `eyJhbGciOiJFUzI1NiJ9.${'x'.repeat(3000)}.sig`;
    const hello = JSON.stringify({ t: 'hello', v: 4, auth: jwt, token: 't'.repeat(43), name: 'Aldo' });
    expect(hello.length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMsg(hello)).toBeNull();
    expect(parseClientMsg(hello, MAX_HELLO_BYTES)).toEqual({ t: 'hello', v: 4, auth: jwt, token: 't'.repeat(43), name: 'Aldo' });
    expect(parseClientMsg(JSON.stringify({ t: 'hello', v: 4, auth: 'ann@example.test' }))).toEqual({ t: 'hello', v: 4, auth: 'ann@example.test' });
    for (const auth of ['', 'x'.repeat(MAX_AUTH_CHARS + 1), 42]) {
      expect(parseClientMsg(JSON.stringify({ t: 'hello', v: 4, auth }), MAX_HELLO_BYTES), String(auth).slice(0, 20)).toBeNull();
    }
    // The longest auth, with a token and a name, still fits in a hello.
    const longest = JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, auth: 'x'.repeat(MAX_AUTH_CHARS), token: 't'.repeat(128), name: 'A'.repeat(16) });
    expect(parseClientMsg(longest, MAX_HELLO_BYTES)).not.toBeNull();
  });
  it('describes how to sign in, with only http(s) addresses for Supabase', () => {
    expect(AuthConfig.parse({ mode: 'legacy' })).toEqual({ mode: 'legacy' });
    expect(AuthConfig.parse({ mode: 'dev' })).toEqual({ mode: 'dev', providers: [] });
    const supabase = { mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_x' };
    expect(AuthConfig.parse(supabase)).toEqual({ ...supabase, providers: [] });
    for (const bad of [{ mode: 'google' }, { ...supabase, url: 'javascript:alert(1)' }, { ...supabase, publishableKey: '' }, { mode: 'supabase' }, { ...supabase, providers: 'google' }]) {
      expect(AuthConfig.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('says which of Google and Apple the sign-in card offers, in order, leaving out names this client does not know', () => {
    const supabase = { mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_x' };
    expect(AuthConfig.parse({ ...supabase, providers: ['apple', 'google'] })).toEqual({ ...supabase, providers: ['apple', 'google'] });
    expect(AuthConfig.parse({ mode: 'dev', providers: ['google'] })).toEqual({ mode: 'dev', providers: ['google'] });
    // A newer server may offer more: this client shows what it knows, once each.
    expect(AuthConfig.parse({ ...supabase, providers: ['github', 'google', 'google'] })).toEqual({ ...supabase, providers: ['google'] });
    // Without sign-in there is nothing to offer.
    expect(AuthConfig.parse({ mode: 'legacy', providers: ['google'] })).toEqual({ mode: 'legacy' });
    expect(OAUTH_PROVIDERS).toEqual(['google', 'apple']);
    expect([isOAuthProvider('apple'), isOAuthProvider('Apple'), isOAuthProvider('email')]).toEqual([true, false, false]);
  });
});

describe('validateMap', () => {
  it('passes a good map', () => {
    expect(validateMap(tinyMap()).filter(p => p.level === 'error')).toEqual([]);
  });
  it('catches overlaps, bad spawns and unreadable signs', () => {
    const m = tinyMap();
    m.objects.push({ kind: 'lamp', x: 2, y: 1 });
    m.objects.push({ kind: 'sign', x: 0, y: 4, text: ['Nobody can stand below me'] });
    m.spawn = { x: 4, y: 0, dir: 'down' };
    const msgs = validateMap(m).map(p => p.message).join('\n');
    expect(msgs).toMatch(/overlaps/);
    expect(msgs).toMatch(/spawn 4,0 is not walkable/);
    expect(msgs).toMatch(/tile in front/);
  });
  it('passes good woods and a town with an exit', () => {
    expect(validateMap(woodsMap())).toEqual([]);
    expect(validateMap(townWithExit()).filter(p => p.level === 'error')).toEqual([]);
  });
  it('lets only a room with a chest be private (a home of one\'s own), and only such a home have a place to wake up in, by its fire', () => {
    const home = (more: Partial<MapData> = {}): MapData => ({
      ...tinyHouse(), objects: [...tinyHouse().objects, { kind: 'chest', x: 3, y: 1 }], private: true, wake: { x: 2, y: 2, dir: 'down' }, ...more,
    });
    const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message).join('\n');
    expect(errors(home())).toBe('');
    expect(errors({ ...tinyHouse(), private: true })).toMatch(/only a room with a chest \(a home\) is private/);
    expect(errors({ ...tinyMap(), private: true })).toMatch(/only a room with a chest \(a home\) is private/);
    expect(errors(home({ private: false as never }))).toMatch(/and then it is true/);
    expect(errors(home({ private: undefined }))).toMatch(/wake: only a private room/);
    expect(errors(home({ wake: { x: 2, y: 4, dir: 'down' } }))).toMatch(/wake 2,4 is not a walkable tile of the room \(an exit is none either\)/);
    expect(errors(home({ wake: { x: 0, y: 1, dir: 'down' } }))).toMatch(/wake 0,1 is not a walkable tile/);
    expect(errors(home({ wake: { x: 2, y: 3, dir: 'down' } }))).toMatch(/wake 2,3 is not by the fire/);
    expect(errors(home({ wake: { x: 2, y: 2, dir: 'north' as never } }))).toMatch(/wake: dir must be up, down, left or right/);
  });
  it('wants a map id of lowercase words joined by hyphens, which the copies of a map are told apart by', () => {
    for (const id of ['near-woods', 'room2']) expect(validateMap({ ...tinyMap(), id }).filter(p => p.level === 'error'), id).toEqual([]);
    for (const id of ['Near Woods', 'woods:2', '', 'woods-']) expect(validateMap({ ...tinyMap(), id }).map(p => p.message).join('\n'), id).toMatch(/its id is lowercase words joined by hyphens/);
  });
  it('catches bad kinds, depths and exits', () => {
    const noHome = woodsMap();
    noHome.exits[0]!.home = undefined;
    expect(validateMap(noHome).map(p => p.message).join('\n')).toMatch(/exit marked home/);
    const deepTown = { ...tinyMap(), depth: 1 };
    expect(validateMap(deepTown).map(p => p.message).join('\n')).toMatch(/town has depth 0/);
    const intoWater = tinyMap();
    intoWater.exits.push({ x: 4, y: 2, w: 1, h: 1, to: 'woods', tx: 3, ty: 4, dir: 'up' });
    expect(validateMap(intoWater).map(p => p.message).join('\n')).toMatch(/not walkable/);
  });
  it('wants every building to lead inside, and every inside to have a way out', () => {
    const noDoor = tinyMap();
    noDoor.exits = [];
    expect(validateMap(noDoor).map(p => p.message).join('\n')).toMatch(/its door 2,1 is not an exit/);
    expect(validateMap(tinyHouse())).toEqual([]);
    const trapped = { ...tinyHouse(), exits: [] };
    expect(validateMap(trapped).map(p => p.message).join('\n')).toMatch(/needs a way out/);
  });
});

describe('what NAPO left behind', () => {
  /** What validateMap says about the tiny town with one more thing in it. */
  const errorsWith = (...extra: MapObject[]) => {
    const m = tinyMap();
    m.objects.push(...extra);
    return validateMap(m).filter(p => p.level === 'error').map(p => p.message).join('\n');
  };
  const cabin = () => tinyMap().objects[0] as Extract<MapObject, { kind: 'house' }>;

  it('stands in the way: nobody walks through a mast or a desk', () => {
    const m = tinyMap();
    m.objects.push({ kind: 'antenna', x: 0, y: 1 }, { kind: 'console', x: 2, y: 3, id: 'station-log', name: 'Station log', text: ['Week 1.'] });
    expect(validateMap(m).filter(p => p.level === 'error')).toEqual([]);
    const map = new TileMap(m);
    expect(map.walkable(0, 1)).toBe(false);
    expect(map.walkable(2, 3)).toBe(false);
  });

  it('wants a desk to have a name, something to read and room in front to read it from', () => {
    expect(errorsWith({ kind: 'console', x: 2, y: 3, id: 'station-log', name: ' ', text: ['Week 1.'] })).toMatch(/console at 2,3 needs a name and something to read/);
    expect(errorsWith({ kind: 'console', x: 2, y: 3, id: 'radio', name: 'Radio', text: [] })).toMatch(/needs a name and something to read/);
    expect(errorsWith({ kind: 'console', x: 3, y: 4, id: 'radio', name: 'Radio', text: ['A hum.'] })).toMatch(/console at 3,4: the tile in front/);
  });

  it('wants each named place on the map, with a name of its own', () => {
    const m = tinyMap();
    m.places = [{ name: 'the ring', x: 1, y: 1 }, { name: 'the ring', x: 2, y: 2 }, { name: ' ', x: 0, y: 0 }, { name: 'far off', x: 99, y: 0 }];
    const msgs = validateMap(m).filter(p => p.level === 'error').map(p => p.message).join('\n');
    expect(msgs).toMatch(/two places are called the ring/);
    expect(msgs).toMatch(/the place at 0,0 needs a name/);
    expect(msgs).toMatch(/the place far off at 99,0 is not on the map/);
  });

  it('lets a fire in the open go by a name, if it says something', () => {
    expect(errorsWith({ kind: 'fireplace', x: 0, y: 1, name: 'the leavers\' camp' })).toBe('');
    expect(errorsWith({ kind: 'fireplace', x: 0, y: 1, name: ' ' })).toMatch(/fireplace at 0,1: a name says something, or is left out/);
  });

  it('builds cabins 3 by 2, and only NAPO builds bigger', () => {
    // 4 wide from 0,0: the door is still at 2,1, the tiny house's way in.
    const wide = { ...cabin(), x: 0, w: 4 };
    expect(errorsWith()).toBe('');
    const bigCabin = tinyMap();
    bigCabin.objects[0] = wide;
    expect(validateMap(bigCabin).map(p => p.message).join('\n')).toMatch(/house at 0,0 is 4 by 2: a cabin is 3 by 2/);
    const station = tinyMap();
    station.objects[0] = { ...wide, style: 'napo' };
    expect(validateMap(station).filter(p => p.level === 'error')).toEqual([]);
    const huge = tinyMap();
    huge.objects[0] = { ...cabin(), w: 11, style: 'napo' };
    expect(validateMap(huge).map(p => p.message).join('\n')).toMatch(/a NAPO building is 3 to 9 wide and 2 to 5 deep/);
  });

  it('knows the styles of building and of sign there are, and no others', () => {
    const brick = tinyMap();
    brick.objects[0] = { ...cabin(), style: 'brick' as 'napo' };
    expect(validateMap(brick).map(p => p.message).join('\n')).toMatch(/house at 1,0: style is napo, mill or left out, not "brick"/);
    const signs = tinyMap();
    signs.objects[1] = { kind: 'sign', x: 3, y: 3, text: ['Hello'], style: 'brick' as 'napo' };
    expect(validateMap(signs).map(p => p.message).join('\n')).toMatch(/sign at 3,3: style is napo, cardboard, mailbox or left out/);
    for (const style of ['napo', 'cardboard', 'mailbox'] as const) {
      signs.objects[1] = { kind: 'sign', x: 3, y: 3, text: ['NAPO Tower', 'Do not climb.'], style };
      expect(validateMap(signs).filter(p => p.level === 'error'), style).toEqual([]);
    }
  });

  it('builds NAPO\'s rooms of concrete, and leads into them only from NAPO\'s buildings', () => {
    expect(validateMap({ ...tinyMap(), style: 'napo' }).map(p => p.message).join('\n')).toMatch(/only an inside has a style/);
    const napoRoom: MapData = { ...tinyHouse(), style: 'napo' };
    expect(validateMap(napoRoom)).toEqual([]);
    const messages = (maps: MapData[]) => validateWorld(maps, 'tiny').map(p => p.message).join('\n');
    expect(messages([townWithExit(), woodsMap(), napoRoom])).toMatch(/house at 1,0: a cabin leads into tiny-house, which is one of NAPO's rooms/);
    const station = townWithExit();
    station.objects[0] = { ...cabin(), style: 'napo' };
    expect(messages([station, woodsMap(), tinyHouse()])).toMatch(/house at 1,0: a NAPO building leads into tiny-house, which is a cabin's room/);
    expect(validateWorld([station, woodsMap(), napoRoom], 'tiny')).toEqual([]);
  });

  it('dresses townspeople in colors', () => {
    const vera = (look: NpcLook): MapObject => ({ kind: 'npc', x: 2, y: 3, id: 'vera', name: 'Vera', dir: 'down', lines: ['Quietly, please.'], look });
    expect(errorsWith(vera({ coat: '#d9d6cc', scarf: '#2f4a6b', hair: '#c9c2b0', skin: '#e0b793', hat: '#d9a82b' }))).toBe('');
    expect(errorsWith(vera({ coat: '#d9d6cc', hat: 'yellow' }))).toMatch(/npc vera: hat is a color, #rrggbb/);
    expect(errorsWith(vera({ cape: '#ffffff' } as NpcLook))).toMatch(/npc vera: a look has coat, scarf, hair, skin, hat, not cape/);
  });
});

describe('what the town, the leavers and NAPO left (roadmap/richer-places.md)', () => {
  /** What validateMap says about the tiny town with one more thing in it. */
  const errorsWith = (...extra: MapObject[]) => {
    const m = tinyMap();
    m.objects.push(...extra);
    return validateMap(m).filter(p => p.level === 'error').map(p => p.message).join('\n');
  };
  const cabin = () => tinyMap().objects[0] as Extract<MapObject, { kind: 'house' }>;

  it('builds the mill long and low, and draws curtains only in a cabin nobody lives in', () => {
    const mill = tinyMap();
    mill.objects[0] = { ...cabin(), x: 0, w: 5, style: 'mill' };
    mill.exits[0] = { ...mill.exits[0]!, x: 2, y: 1 };
    expect(validateMap(mill).filter(p => p.level === 'error')).toEqual([]);
    mill.objects[0] = { ...cabin(), style: 'mill' };
    expect(validateMap(mill).map(p => p.message).join('\n')).toMatch(/house at 1,0 is 3 by 2: the mill is long and low, 5 to 9 wide and 2 to 4 deep/);
    const left = tinyMap();
    left.objects[0] = { ...cabin(), lit: 0, curtains: true };
    expect(validateMap(left).filter(p => p.level === 'error')).toEqual([]);
    left.objects[0] = { ...cabin(), lit: 1, curtains: true };
    expect(validateMap(left).map(p => p.message).join('\n')).toMatch(/curtains are drawn only in a cabin nobody lives in/);
  });

  it('leads from the mill onto the mill\'s floor, and nowhere else', () => {
    const town = townWithExit();
    town.objects[0] = { ...cabin(), x: 0, w: 5, style: 'mill' };
    town.exits.find(e => e.to === 'tiny-house')!.x = 2;
    const floor: MapData = { ...tinyHouse(), style: 'mill' };
    expect(validateMap(floor)).toEqual([]);
    expect(validateWorld([town, woodsMap(), floor], 'tiny')).toEqual([]);
    expect(validateWorld([town, woodsMap(), tinyHouse()], 'tiny').map(p => p.message).join('\n')).toMatch(/house at 0,0: the mill leads into tiny-house, which is a cabin's room/);
    expect(validateMap({ ...tinyHouse(), style: 'barn' as 'mill' }).map(p => p.message).join('\n')).toMatch(/napo \(one of NAPO's rooms\) or mill/);
  });

  it('parks cars, trucks and jeeps along their length, one tile across, in a real paint', () => {
    expect(errorsWith({ kind: 'car', x: 0, y: 2, w: 1, h: 2, dir: 'down', paint: '#8a3b32', door: true, trunk: true })).toBe('');
    expect(errorsWith({ kind: 'car', x: 0, y: 2, w: 1, h: 2, dir: 'left' })).toMatch(/car at 0,2: its nose points along it, up or down, not "left"/);
    expect(errorsWith({ kind: 'car', x: 0, y: 2, w: 2, h: 2 })).toMatch(/car at 0,2 is 2 by 2: a car is 2 by 1 or 1 by 2/);
    expect(errorsWith({ kind: 'car', x: 0, y: 2, w: 2, paint: 'teal' })).toMatch(/car at 0,2: paint is a color, #rrggbb/);
    // A car of the old kind, 2 by 1 with no more said, still faces east and is fine.
    expect(errorsWith({ kind: 'car', x: 0, y: 2, w: 2 })).toBe('');
    expect(errorsWith({ kind: 'truck', x: 0, y: 1, w: 1, h: 3, dir: 'down', style: 'napo' })).toBe('');
    expect(errorsWith({ kind: 'truck', x: 0, y: 1, w: 1, h: 3, dir: 'right' })).toMatch(/truck at 0,1: its nose points along it, up or down/);
    expect(errorsWith({ kind: 'truck', x: 0, y: 0, w: 1, h: 5, dir: 'down' })).toMatch(/a truck is one tile across and 2 to 4 long/);
  });

  it('reads a jeep\'s stencil and a cage\'s tag, and wants somewhere to stand to read them', () => {
    const jeep = (text: string[]): MapObject => ({ kind: 'jeep', x: 0, y: 2, w: 1, h: 2, dir: 'down', text });
    expect(errorsWith(jeep(['NAPO · UNIT 7']))).toBe('');
    expect(errorsWith(jeep([]))).toMatch(/jeep at 0,2 has nothing to read/);
    expect(errorsWith({ kind: 'cage', x: 3, y: 3, text: [' '] })).toMatch(/cage at 3,3 has nothing to read/);
    expect(errorsWith({ kind: 'cage', x: 3, y: 4, text: ['NAPO · Sample 3'] })).toMatch(/cage at 3,4: the tile in front/);
    // Walled in by the forest, a jeep nobody can reach cannot be read.
    const cut: MapData = {
      id: 'cut', name: 'Cut', version: 1, kind: 'town', depth: 0, width: 5, height: 5,
      tiles: ['ggttt', 'ggttt', 'ggttt', 'ggttt', 'ggttt'], levels: Array<string>(5).fill('00000'),
      spawn: { x: 0, y: 0, dir: 'down' }, exits: [], objects: [{ kind: 'jeep', x: 3, y: 1, w: 1, h: 2, dir: 'down', text: ['NAPO'] }],
    };
    expect(validateMap(cut).map(p => p.message).join('\n')).toMatch(/jeep at 3,1: nobody can stand beside it to read it/);
  });

  it('hangs a calendar or a drawing on the wall, and lays a note or a list on a table', () => {
    const room = (paper: Extract<MapObject, { kind: 'paper' }>): string => validateMap({ ...tinyHouse(), objects: [paper] }).map(p => p.message).join('\n');
    expect(room({ kind: 'paper', x: 2, y: 0, look: 'calendar', name: 'Calendar', text: ['Our turn.'] })).toBe('');
    expect(room({ kind: 'paper', x: 2, y: 2, look: 'note', name: 'Note on the table', text: ['Back soon.'] })).toBe('');
    expect(room({ kind: 'paper', x: 2, y: 2, look: 'drawing', name: 'A drawing', text: ['Trees.'] })).toMatch(/paper at 2,2: a drawing hangs on a wall tile/);
    expect(room({ kind: 'paper', x: 1, y: 0, look: 'list', name: 'List', text: ['TAKE: the cat.'] })).toMatch(/paper at 1,0: a list lies on a table, on the floor/);
    expect(room({ kind: 'paper', x: 2, y: 2, look: 'poem' as 'note', name: 'A poem', text: ['Roses.'] })).toMatch(/looks like note, list, calendar, drawing, not "poem"/);
    expect(room({ kind: 'paper', x: 2, y: 2, look: 'note', name: ' ', text: ['Back soon.'] })).toMatch(/needs a name and something to read/);
    // Read from the floor below it: a calendar over a wall has nobody to read it.
    expect(room({ kind: 'paper', x: 0, y: 1, look: 'calendar', name: 'Calendar', text: ['Our turn.'] })).toMatch(/paper at 0,1: the tile in front/);
  });

  it('stands what was left in the way, and lets you walk past stakes, skids and sawdust', () => {
    const m = tinyMap();
    m.objects.push(
      { kind: 'luggage', x: 0, y: 1 }, { kind: 'piano', x: 0, y: 4 }, { kind: 'logs', x: 2, y: 3, w: 1, h: 1 },
      { kind: 'stake', x: 1, y: 2 }, { kind: 'skid', x: 2, y: 2, dir: 'h' }, { kind: 'sawdust', x: 3, y: 2 },
    );
    expect(validateMap(m).filter(p => p.level === 'error')).toEqual([]);
    const map = new TileMap(m);
    for (const [x, y] of [[0, 1], [0, 4], [1, 4], [2, 3]] as const) expect(map.walkable(x, y), `${x},${y}`).toBe(false);
    for (const [x, y] of [[1, 2], [2, 2], [3, 2]] as const) expect(map.walkable(x, y), `${x},${y}`).toBe(true);
  });

  it('knows how many tiles each of them covers', () => {
    const tiles = (o: MapObject) => objectTiles(o).map(([x, y]) => `${x},${y}`);
    expect(tiles({ kind: 'car', x: 1, y: 1, w: 2 })).toEqual(['1,1', '2,1']);
    expect(tiles({ kind: 'car', x: 1, y: 1, w: 1, h: 2, dir: 'down' })).toEqual(['1,1', '1,2']);
    expect(tiles({ kind: 'truck', x: 1, y: 1, w: 1, h: 3, dir: 'down' })).toEqual(['1,1', '1,2', '1,3']);
    expect(tiles({ kind: 'piano', x: 1, y: 1 })).toEqual(['1,1', '2,1']);
    expect(tiles({ kind: 'logs', x: 1, y: 1, w: 3, h: 2 })).toHaveLength(6);
    expect(tiles({ kind: 'carriage', x: 1, y: 1, w: 5 })).toEqual(['1,1', '2,1', '3,1', '4,1', '5,1']);
    expect(footprint({ kind: 'jeep', x: 0, y: 0, w: 2, h: 1, dir: 'left', text: ['NAPO'] })).toEqual([2, 1]);
    expect(footprint({ kind: 'stump', x: 0, y: 0, s: 1, v: 0 })).toEqual([1, 1]);
  });
});

describe('validateWorld', () => {
  it('passes maps that fit together', () => {
    expect(validateWorld([townWithExit(), woodsMap(), tinyHouse()], 'tiny')).toEqual([]);
  });
  it('catches exits to nowhere, into walls or onto other exits', () => {
    const town = townWithExit();
    town.exits.push({ x: 0, y: 3, w: 1, h: 1, to: 'nowhere', tx: 0, ty: 0, dir: 'up' });
    const woods = woodsMap();
    woods.exits[0]!.ty = 0; // arrives inside the house
    const msgs = validateWorld([town, woods], 'tiny').map(p => `${p.map}: ${p.message}`).join('\n');
    expect(msgs).toMatch(/tiny: .*no map nowhere/);
    expect(msgs).toMatch(/woods: .*not walkable/);
    const bounce = townWithExit();
    const intoWoods = bounce.exits.find(e => e.to === 'woods')!;
    intoWoods.tx = 3;
    intoWoods.ty = 5; // the first lane would land on the woods' own exit and bounce back
    expect(validateWorld([bounce, woodsMap(), tinyHouse()], 'tiny').map(p => p.message).join('\n')).toMatch(/which is an exit itself/);
  });
  it('wants every door to lead into an inside', () => {
    const town = townWithExit();
    town.exits.find(e => e.to === 'tiny-house')!.to = 'woods';
    const msgs = validateWorld([town, woodsMap(), tinyHouse()], 'tiny').map(p => p.message).join('\n');
    expect(msgs).toMatch(/its door leads to woods, which is not an inside/);
    expect(new TileMap(tinyHouse()).homeSteps(2, 3)).toBe(0); // safe inside, not "lost"
  });
  it('wants the shelter nearest to the way home to keep a fire that never goes out', () => {
    // Two huts in the woods: one 4 steps from the way home, one 6.
    const woods = woodsMap();
    woods.exits.push(
      { x: 1, y: 3, w: 1, h: 1, to: 'near-hut', tx: 2, ty: 3, dir: 'left' },
      { x: 5, y: 1, w: 1, h: 1, to: 'far-hut', tx: 2, ty: 3, dir: 'up' },
    );
    const hut = (id: string, back: [number, number], tended: boolean): MapData => ({
      ...tinyHouse(), id, exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'woods', tx: back[0], ty: back[1], dir: 'down' }],
      objects: [{ kind: 'fireplace', x: 2, y: 1, ...(tended && { tended: true }) }],
    });
    const world = (nearTended: boolean, farTended: boolean) =>
      validateWorld([townWithExit(), woods, tinyHouse(), hut('near-hut', [1, 4], nearTended), hut('far-hut', [5, 2], farTended)], 'tiny');
    expect(world(true, false)).toEqual([]);
    const problem = { level: 'error', map: 'near-hut', message: expect.stringMatching(/nearest to the way home from woods must keep a fire that never goes out/) };
    expect(world(false, false)).toEqual([problem]);
    expect(world(false, true)).toEqual([problem]);
  });
  it('wants one home to wake up in, whose door opens onto the home town', () => {
    const home = (id: string, to: string): MapData => ({
      ...tinyHouse(), id, exits: [{ ...tinyHouse().exits[0]!, to }], objects: [...tinyHouse().objects, { kind: 'chest', x: 3, y: 1 }], private: true, wake: { x: 2, y: 2, dir: 'down' },
    });
    expect(validateWorld([townWithExit(), woodsMap(), home('tiny-house', 'tiny')], 'tiny')).toEqual([]);
    const wakes = (maps: MapData[]) => validateWorld(maps, 'tiny').filter(p => /wake/.test(p.message));
    expect(wakes([townWithExit(), woodsMap(), tinyHouse(), home('woods-home', 'woods')])).toEqual([
      { level: 'error', map: 'woods-home', message: 'wake: only the home off the home town (tiny), or off its street, is where you wake up, and this room\'s door opens elsewhere' },
    ]);
    expect(wakes([townWithExit(), woodsMap(), home('tiny-house', 'tiny'), home('second-home', 'tiny')])).toEqual([
      { level: 'error', map: 'second-home', message: 'wake: tiny-house and second-home both have one, but everyone wakes up in the same home' },
    ]);
  });
  it('keeps a street of cabins to its rules: plain cabins with name plates, every door into the home, reached from the home town', () => {
    // The town's house leads onto a lane of two cabins, each door into the home, a private room where you wake up.
    const town = (): MapData => ({ ...townWithExit(), exits: townWithExit().exits.map(e => (e.to === 'tiny-house' ? { ...e, to: 'lane', tx: 4, ty: 3 } : e)) });
    const cabin = (x: number): Extract<MapObject, { kind: 'house' }> => ({ kind: 'house', x, y: 1, w: 3, h: 2, roof: '#6b7075', lit: 0, plate: true });
    const lane = (): MapData => ({
      id: 'lane', name: 'Lane', version: 1, kind: 'town', depth: 0, width: 9, height: 5, street: true,
      tiles: ['ttttttttt', 'tgggggggt', 'tgggggggt', 'tgggggggt', 'ttttgtttt'],
      levels: Array<string>(5).fill('000000000'),
      spawn: { x: 4, y: 3, dir: 'up' },
      exits: [
        { x: 2, y: 2, w: 1, h: 1, to: 'home', tx: 2, ty: 3, dir: 'up' }, { x: 6, y: 2, w: 1, h: 1, to: 'home', tx: 2, ty: 3, dir: 'up' },
        { x: 4, y: 4, w: 1, h: 1, to: 'tiny', tx: 2, ty: 2, dir: 'down' },
      ],
      objects: [cabin(1), cabin(5)],
    });
    const home = (): MapData => ({
      ...tinyHouse(), id: 'home', exits: [{ ...tinyHouse().exits[0]!, to: 'lane', tx: 2, ty: 3 }], objects: [...tinyHouse().objects, { kind: 'chest', x: 3, y: 1 }],
      private: true, wake: { x: 2, y: 2, dir: 'down' },
    });
    const errors = (maps: MapData[]) => validateWorld(maps, 'tiny').filter(p => p.level === 'error').map(p => `${p.map}: ${p.message}`);
    expect(validateMap(lane()).filter(p => p.level === 'error')).toEqual([]);
    expect(errors([town(), lane(), home(), woodsMap()])).toEqual([]);
    expect(lotDoors(lane())).toEqual([{ x: 2, y: 2 }, { x: 6, y: 2 }]);
    expect(lotDoors(tinyMap())).toEqual([]);

    // A street is a town; its cabins are plain, unlit and plated, and only they have plates.
    const mapErrors = (m: MapData) => validateMap(m).filter(p => p.level === 'error').map(p => p.message);
    expect(mapErrors({ ...lane(), kind: 'wilds', depth: 1 })).toContain('street: only a town is a street of cabins, and then it is true');
    expect(mapErrors({ ...lane(), objects: [{ ...cabin(1), lit: 1 }, cabin(5)] })).toEqual(['house at 1,1: on a street every house is a plain cabin with a name plate (plate), unlit and without curtains']);
    expect(mapErrors({ ...tinyMap(), objects: [{ ...(tinyMap().objects[0] as Extract<MapObject, { kind: 'house' }>), lit: 0, plate: true }] })).toEqual(['house at 1,0: only a cabin on a street has a name plate']);

    // Every door leads into the one home of one's own; the lane's end leads back to the home town.
    const other: MapData = { ...tinyHouse(), id: 'other', exits: [{ ...tinyHouse().exits[0]!, to: 'lane', tx: 2, ty: 3 }] };
    const astray = { ...lane(), exits: lane().exits.map(e => (e.x === 6 && e.y === 2 ? { ...e, to: 'other' } : e)) };
    expect(errors([town(), astray, home(), other, woodsMap()])).toContain('lane: street: every cabin on it leads into the one home of one\'s own (a private room): its owner\'s own cabin');
    const shut = { ...lane(), tiles: ['ttttttttt', 'tgggggggt', 'tgggggggt', 'tgggggggt', 'ttttttttt'], exits: lane().exits.filter(e => e.to !== 'tiny') };
    expect(errors([town(), shut, home(), woodsMap()])).toContain('lane: street: its end leads back to the home town (tiny)');
    // Only a house in the home town is the way onto the street; and there is one street.
    const elsewhere = { ...town(), id: 'elsewhere', exits: town().exits.filter(e => e.to === 'lane') };
    expect(errors([town(), lane(), home(), woodsMap(), elsewhere])).toContain('elsewhere: house at 1,0: the way onto the street is a house in the home town (tiny)');
    const second = { ...lane(), id: 'lane-2', exits: lane().exits.map(e => (e.to === 'home' ? e : { ...e })) };
    expect(errors([town(), lane(), second, home(), woodsMap()])).toContain('lane-2: street: lane and lane-2 are both streets, but every player\'s cabin stands on the one');
  });
  it('wants a town at home and every map reachable from it', () => {
    expect(validateWorld([woodsMap()], 'tiny').map(p => p.message).join('\n')).toMatch(/home map tiny does not exist/);
    const msgs = validateWorld([tinyMap(), woodsMap()], 'tiny');
    expect(msgs).toContainEqual({ level: 'warning', map: 'woods', message: 'cannot be reached from tiny' });
  });
});
