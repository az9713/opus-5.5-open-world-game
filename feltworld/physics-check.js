// Felt World physics check. Run in the page console (the game must be started):
//   const m = await import(new URL('physics-check.js?' + Date.now(), location.href)); console.table(await m.run());
// The oracle is a downward ray against the DRAWN terrain and road meshes, not the game's own height code.
const g = window.__game, THREE = g.THREE, W = g.WATER_Y;
const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();

function groundMeshes(x, z) {
  const cx = Math.floor(x / g.CH), cz = Math.floor(z / g.CH), out = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ch = g.chunks.get((cx + dx) + ',' + (cz + dz)); if (!ch) continue;
    for (const o of ch.group.children) if (o.userData.ground && (o.userData.ground === 'road' || (dx === 0 && dz === 0))) out.push(o);
  }
  return out;
}
// height of the drawn ground at (x, z), or null when no chunk covers it
export function drawnGround(x, z) {
  const ms = groundMeshes(x, z); if (!ms.length) return null;
  ray.set(_o.set(x, 900, z), DOWN); ray.far = 2000;
  const hit = ray.intersectObjects(ms, false)[0];
  return hit ? hit.point.y : null;
}

// one result row per check: n tested, fails, worst value
const rows = {};
function rec(name, bad, v, where) {
  const r = rows[name] || (rows[name] = { check: name, n: 0, fails: 0, worst: 0, at: '' });
  r.n++;
  if (bad) { r.fails++; if (Math.abs(v) > Math.abs(r.worst)) { r.worst = +v.toFixed(2); r.at = where; } }
}
const at = (a) => `${a.x | 0},${a.z | 0}`;

// ---- land: things that stand on the ground
function checkLand(tag) {
  const vis = (a) => !a.hidden;
  for (const a of g.traffic.filter(vis)) { const y = drawnGround(a.x, a.z); if (y === null) continue; const d = a.y - y; rec(`${tag} traffic on road`, d < -0.15 || d > 0.35, d, at(a)); }
  for (const a of g.peds.filter((a) => vis(a) && !(a.down > 0))) { const y = drawnGround(a.x, a.z); if (y === null) continue; const d = a.y - y; rec(`${tag} pedestrians on ground`, d < -0.15 || d > 0.35, d, at(a)); }
  for (const a of g.sheep.filter(vis)) { const y = drawnGround(a.x, a.z); if (y === null) continue; const d = a.y - y; rec(`${tag} sheep on ground`, d < -0.3 || d > 0.35, d, at(a)); }
  for (const a of g.rabbits.filter(vis)) { const y = drawnGround(a.x, a.z); if (y === null) continue; const d = a.y - y; rec(`${tag} rabbits on ground`, d < -0.3 || d > 0.95, d, at(a)); }
  // no two traffic vehicles inside each other (oriented boxes, separating-axis test)
  const t = g.traffic.filter(vis);
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
    const a = t[i], b = t[j];
    if (Math.abs(a.x - b.x) > 14 || Math.abs(a.z - b.z) > 14 || Math.abs(a.y - b.y) > 3) continue;
    rec(`${tag} traffic overlaps`, obbOverlap(a, b), 1, at(a));
  }
}
function box(a) { return { x: a.x, z: a.z, yaw: a.yaw, hw: a.spec.len > 8 ? 1.45 : 1.15, hd: a.spec.len / 2 }; }
function obbOverlap(A, B) {
  const a = box(A), b = box(B);
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
  for (const th of axes) {
    const ux = Math.sin(th), uz = Math.cos(th);
    const proj = (o) => Math.abs(o.hw * (Math.cos(o.yaw) * ux - Math.sin(o.yaw) * uz)) + Math.abs(o.hd * (Math.sin(o.yaw) * ux + Math.cos(o.yaw) * uz));
    const d = Math.abs((b.x - a.x) * ux + (b.z - a.z) * uz);
    if (d > proj(a) + proj(b) - 0.2) return false;
  }
  return true;
}

// ---- sea: things that swim must stay between the drawn sea floor and the surface
const SEA = [
  // name, list, half height below centre, height above centre (both times size)
  ['fish', () => g.fish, 0.45, 0.45],
  ['jellyfish', () => g.jellies, 2.8, 0.8],
  ['rays', () => g.rays, 0.3, 0.3],
  ['sea turtles', () => g.nturtles, 0.6, 0.6],
  ['whales', () => g.whales, 3.1, 3],
];
function checkSea(tag) {
  for (const [name, list, below, above] of SEA) for (const a of list()) {
    if (a.hidden) continue;
    const s = a.size || 1, y = drawnGround(a.x, a.z); if (y === null) continue;
    rec(`${tag} ${name} above sea floor`, a.y - below * s < y, a.y - below * s - y, at(a));
    rec(`${tag} ${name} below surface`, a.y + above * s > W, a.y + above * s - W, at(a));
    if (name === 'whales') for (const k of [-9, 9]) { // nose and tail
      const nx = a.x + Math.sin(a.yaw) * k * s, nz = a.z + Math.cos(a.yaw) * k * s, ny = drawnGround(nx, nz);
      if (ny !== null) rec(`${tag} whales nose/tail above floor`, a.y - 1.5 * s < ny, a.y - 1.5 * s - ny, at(a));
    }
  }
  for (const c of g.crabs) { if (c.hidden) continue; const y = drawnGround(c.x, c.z); if (y === null) continue; const d = c.y - y; rec(`${tag} crabs on sea floor`, d < -0.35 || d > 0.35, d, at(c)); }
  // seabed rocks, the shipwreck and the chest are solid over their height; walkers and swimmers go round or over them
  // name, list, radius, half height (times size; crabs stand on the floor)
  for (const [name, list, rad, half] of [['crabs', g.crabs, 0.8, 0], ['sea turtles', g.nturtles, 0.9, 0.6], ['fish', g.fish, 0.3, 0.45], ['rays', g.rays, 1.5, 0.3], ['jellyfish', g.jellies, 1.1, 0], ['whales', g.whales, 3.5, 3.1]]) for (const a of list) {
    if (a.hidden) continue; const s = a.size || 1, bottom = half ? a.y - half * s : a.y;
    const d = depthIn(a.x, a.z, rad * s, false, bottom, name === 'crabs' ? 0.6 * s : name === 'jellyfish' ? 0.8 * s : 2 * half * s);
    rec(`${tag} ${name} not inside rocks/wrecks`, d > 0.05, d, at(a));
  }
}

// ---- the player
function checkPlayer(tag) {
  const m = g.G.mode;
  if (m === 'drive' && g.VEH.form === 'car' && !g.VEH.air) { const y = drawnGround(g.VEH.pos.x, g.VEH.pos.z); if (y !== null) { const d = g.VEH.pos.y - y; rec(`${tag} player car on ground`, d < -0.15 || d > 0.45, d, at(g.VEH.pos)); } } // 0.45: the car counts as airborne only above 0.4 m
  if (m === 'drive' && g.VEH.form === 'sub') { const y = drawnGround(g.VEH.pos.x, g.VEH.pos.z); if (y !== null) rec(`${tag} submarine above floor`, g.VEH.pos.y - 1.4 < y - 0.05, g.VEH.pos.y - 1.4 - y, at(g.VEH.pos)); rec(`${tag} submarine below surface`, g.VEH.pos.y > W, g.VEH.pos.y - W, at(g.VEH.pos)); }
  if (m === 'walk' && !g.WALK.swim && g.WALK.vy === 0) { const y = drawnGround(g.WALK.pos.x, g.WALK.pos.z); if (y !== null) { const d = g.WALK.pos.y - y; rec(`${tag} walker on ground`, d < -0.15 || d > 0.35, d, at(g.WALK.pos)); } }
  if (m === 'turtle') { const y = drawnGround(g.TURT.pos.x, g.TURT.pos.z); if (y !== null) rec(`${tag} player turtle above floor`, g.TURT.pos.y - 0.6 < y, g.TURT.pos.y - 0.6 - y, at(g.TURT.pos)); rec(`${tag} player turtle below surface`, g.TURT.pos.y > W, g.TURT.pos.y - W, at(g.TURT.pos)); }
  if (m === 'bird') { const y = drawnGround(g.BIRD.pos.x, g.BIRD.pos.z); if (y !== null) rec(`${tag} bird above ground`, g.BIRD.pos.y < Math.max(y, W), g.BIRD.pos.y - Math.max(y, W), at(g.BIRD.pos)); }
}

// ---- solid things: nothing may stand inside a tree, rock, lamp, fence, house (chunk colliders) or a vehicle
function inside(x, z, rad, c) { // overlap in metres of a round body with one collider; <= 0 means clear
  const ox = x - c.x, oz = z - c.z;
  if (c.t === 0) return c.r + rad - Math.hypot(ox, oz);
  const cs = Math.cos(c.ry), sn = Math.sin(c.ry), lx = ox * cs - oz * sn, lz = ox * sn + oz * cs;
  return Math.min(c.hw + rad - Math.abs(lx), c.hd + rad - Math.abs(lz));
}
const tBox = (a) => ({ t: 1, x: a.x, z: a.z, hw: a.spec.len > 8 ? 1.45 : 1.15, hd: a.spec.len / 2, ry: a.yaw });
// deepest overlap of a round body (radius rad, bottom at y, h tall) with any collider whose height range it meets.
// Colliders carry top (and tree crowns / windmill sails a bottom, bot); with y null the height is ignored.
export function depthIn(x, z, rad, withTraffic = true, y = null, h = 2) {
  let worst = -1e9;
  const cx = Math.floor(x / g.CH), cz = Math.floor(z / g.CH);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ch = g.chunks.get((cx + dx) + ',' + (cz + dz)); if (!ch) continue;
    for (const c of ch.colliders) {
      if (Math.abs(x - c.x) > 25 || Math.abs(z - c.z) > 25) continue;
      if (y !== null && (y > c.top || y + h < c.bot)) continue;
      worst = Math.max(worst, inside(x, z, rad, c));
    }
  }
  if (withTraffic) for (const a of g.traffic) if (!a.hidden && Math.abs(a.x - x) < 15 && Math.abs(a.z - z) < 15 && (y === null || Math.abs(a.y - y) < 3)) worst = Math.max(worst, inside(x, z, rad, tBox(a)));
  return worst;
}
// the player's body in the current mode: entity, radius, bottom offset below pos.y, height
function body() {
  const m = g.G.mode;
  if (m === 'walk') return { name: 'walker', e: g.WALK, rad: 0.5, down: 0, h: 2 };
  if (m === 'turtle') return { name: 'player turtle', e: g.TURT, rad: 1.5, down: 0.6, h: 1.2 };
  if (m === 'bird') return { name: 'bird', e: g.BIRD, rad: 1, down: 0.5, h: 1 };
  return g.VEH.form === 'sub' ? { name: 'submarine', e: g.VEH, rad: 2.2, down: 1.4, h: 2.8 } : { name: 'player car', e: g.VEH, rad: 1.8, down: 0, h: 2 };
}
function checkSolid(tag) {
  const b = body(), p = b.e.pos, bottom = p.y - b.down;
  // traffic moves after the player in a frame, so allow its one-frame step (0.35 m) against the player
  const d = Math.max(depthIn(p.x, p.z, b.rad, false, bottom, b.h), depthIn(p.x, p.z, b.rad, true, bottom, b.h) - 0.35);
  rec(`${tag} ${b.name} not inside solids`, d > 0.05, d, at(p));
  for (const a of g.sheep) if (!a.hidden) { const d = depthIn(a.x, a.z, 1.1, false, a.y, 2.2); rec(`${tag} sheep not inside solids`, d > 0.05, d, at(a)); }
  for (const a of g.rabbits) if (!a.hidden) { const d = depthIn(a.x, a.z, 0.4, false, a.y, 0.9); rec(`${tag} rabbits not inside solids`, d > 0.05, d, at(a)); }
  for (const a of g.peds) if (!a.hidden && !(a.down > 0)) { const d = depthIn(a.x, a.z, 0.3, false, a.y); rec(`${tag} pedestrians not inside solids`, d > 0.05, d, at(a)); }
  for (const a of g.traffic) if (!a.hidden) { const d = depthIn(a.x, a.z, 1.15, false, a.y); rec(`${tag} traffic not inside trees/lamps/houses`, d > 0.05, d, at(a)); }
}
// nearest collider of a kind (t 0 = round: tree, rock, lamp; t 1 = box: house, fence) to (x, z)
function nearestSolid(x, z, t, minR = 0) { // ground-level colliders only (not tree crowns or windmill sails)
  let best = null, bd = 1e9;
  for (const ch of g.chunks.values()) for (const c of ch.colliders) {
    if (c.t !== t || c.bot !== undefined || (t === 0 && c.r < minR)) continue;
    const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// put the player (car or walker) 18 m from a collider, facing it, hold W for 3 s, and measure
// put the player 18 m from a collider, facing it, at height y (default: on the ground), hold `hold` for 3 s, measure
function ramInto(tag, c, rad, sea = false, y = null, hold = 'KeyW') {
  const b = body(), e = b.e;
  const reach = c.t === 0 ? c.r : Math.max(c.hw, c.hd);
  for (let k = 0; k < 8; k++) { // choose a free approach side (dry on land, deep at sea)
    const ang = k * Math.PI / 4, sx = c.x + Math.sin(ang) * (reach + 18), sz = c.z + Math.cos(ang) * (reach + 18);
    // at sea the approach floor must be level with the rock's floor, or the swimmer passes over the rock
    if ((sea ? g.heightAt(sx, sz) > -8 || Math.abs(g.heightAt(sx, sz) - g.heightAt(c.x, c.z)) > 2 : g.heightAt(sx, sz) < 1) || depthIn(sx, sz, rad) > -1) continue;
    if (y !== null) g.teleport(sx, sz, y); else if (sea) g.teleport(sx, sz, g.groundAt(c.x, c.z) + 1.6); else g.teleport(sx, sz);
    e.heading = ang + Math.PI; if (b.name !== 'bird') e.speed = 0; else { e.pitch = 0; e.speed = 20; }
    g.step(1 / 60, 2);
    const d0 = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
    if (hold) key(hold, true); if (sea) key('KeyQ', true); // at sea also hold Q (dive) to stay low
    let d1 = d0;
    run_(180, 2, () => { if (g.G.mode === 'walk' && b.name === 'bird') return; d1 = Math.min(d1, Math.hypot(e.pos.x - c.x, e.pos.z - c.z)); const d = depthIn(e.pos.x, e.pos.z, rad, false, e.pos.y - b.down, b.h); rec(`${tag}: never inside it`, d > 0.05, d, at(e.pos)); });
    if (hold) key(hold, false); if (sea) key('KeyQ', false);
    rec(`${tag}: reached it (moved > 8 m toward it)`, d0 - d1 < 8, d0 - d1, at(e.pos));
    return;
  }
  rec(`${tag}: found an approach`, true, 1, `${c.x | 0},${c.z | 0}`);
}

// ---- helpers
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
function run_(n, every, fn) { for (let i = 0; i < n; i += every) { g.step(1 / 60, every); fn(); } }
// a primary-road lane point where the drawn deck stands far above the plain terrain (mountain or sea edge)
function worstLane() {
  let best = null;
  for (const ch of g.chunks.values()) for (const { fam, run } of ch.runs) {
    if (fam > 1) continue;
    for (const p of run) {
      const lx = p.x - p.tz * 3.3, lz = p.z + p.tx * 3.3, y = drawnGround(lx, lz); if (y === null) continue;
      const gap = y - g.heightAt(lx, lz);
      if (!best || gap > best.gap) best = { gap, x: lx, z: lz, heading: Math.atan2(p.tx, p.tz) };
    }
  }
  return best;
}
function toCar(x, z, heading) {
  if (g.G.mode !== 'drive') { g.VEH.hidden = false; g.G.mode = 'drive'; }
  g.VEH.form = 'car'; g.teleport(x, z); g.VEH.heading = heading;
}

export async function run() {
  for (const k in rows) delete rows[k];
  if (!g.G.started) throw new Error('press Start first');
  if (g.G.paused) throw new Error('unpause first (P)');
  // 1. town streets
  let p = g.findBiome('town', 0.6); toCar(p.x, p.z, 0); run_(300, 30, () => { checkLand('town'); checkPlayer('town'); checkSolid('town'); });
  // 1b. real input in town: drive with W and A for 8 s, then get out (E) and walk with W and D for 8 s
  key('KeyW', true); key('KeyA', true); run_(480, 5, () => { checkPlayer('town drive W+A'); checkSolid('town drive W+A'); }); key('KeyA', false); key('KeyW', false);
  g.VEH.speed = 0; g.step(1 / 60, 5);
  key('KeyE', true); g.step(1 / 60, 2); key('KeyE', false);
  rec('E gets out of the car', g.G.mode !== 'walk', 1, '');
  // W for 4 s, then W+D for 4 s (W+D alone walks a 2.7 m circle, so measure the path walked)
  let wm = 0, wp = g.WALK.pos.clone();
  const walked = () => { wm += Math.hypot(g.WALK.pos.x - wp.x, g.WALK.pos.z - wp.z); wp = g.WALK.pos.clone(); };
  key('KeyW', true); run_(240, 5, () => { walked(); checkPlayer('town walk W'); checkSolid('town walk W'); });
  key('KeyD', true); run_(240, 5, () => { walked(); checkPlayer('town walk W+D'); checkSolid('town walk W+D'); }); key('KeyD', false); key('KeyW', false);
  rec('walk: walker walked more than 30 m in 8 s', wm < 30, wm, at(g.WALK.pos));
  // 1c. real input: walk into a house and into a tree; drive into a house and into a tree
  let c = nearestSolid(g.WALK.pos.x, g.WALK.pos.z, 1); if (c) ramInto('walker into a house', c, 0.5);
  c = nearestSolid(g.WALK.pos.x, g.WALK.pos.z, 0, 0.3); if (c) ramInto('walker into a tree/rock/lamp', c, 0.5);
  key('KeyE', true); g.step(1 / 60, 2); key('KeyE', false); // back into a car nearby, if any
  if (g.G.mode !== 'drive') toCar(g.WALK.pos.x, g.WALK.pos.z, 0);
  c = nearestSolid(g.VEH.pos.x, g.VEH.pos.z, 1); if (c) ramInto('car into a house', c, 1.8);
  p = g.findBiome('forest', 0.6); toCar(p.x, p.z, 0); g.step(1 / 60, 30);
  c = nearestSolid(g.VEH.pos.x, g.VEH.pos.z, 0, 0.3); if (c) ramInto('car into a tree', c, 1.8);
  run_(300, 30, () => { checkLand('forest'); checkSolid('forest'); });
  // 2. the worst road edge found near the mountains (where a floating road deck was first reported)
  p = g.findBiome('mtn', 0.15); toCar(p.x, p.z, 0); g.step(1 / 60, 60);
  const lane = worstLane();
  if (lane) {
    rows.lane = { check: `worst lane found: deck is ${lane.gap.toFixed(2)} above plain terrain`, n: 1, fails: 0, worst: 0, at: `${lane.x | 0},${lane.z | 0}` };
    toCar(lane.x, lane.z, lane.heading); g.VEH.pos.y = drawnGround(lane.x, lane.z); g.step(1 / 60, 30);
    run_(300, 30, () => { checkLand('mountain road'); checkPlayer('mountain road'); checkSolid('mountain road'); });
    // 3. real input: hold W and drive along the road for 10 s (clear parked traffic off the start first)
    for (const a of g.traffic) if (Math.hypot(a.x - lane.x, a.z - lane.z) < 40) a.hidden = true;
    toCar(lane.x, lane.z, lane.heading); g.VEH.pos.y = drawnGround(lane.x, lane.z); g.step(1 / 60, 10);
    const x0 = g.VEH.pos.x, z0 = g.VEH.pos.z;
    key('KeyW', true); run_(600, 5, () => checkPlayer('drive W')); key('KeyW', false);
    const moved = Math.hypot(g.VEH.pos.x - x0, g.VEH.pos.z - z0);
    rec('drive W: car moved more than 50 m', moved < 50, moved, at(g.VEH.pos));
  }
  // 4. deep sea and shallows, in the submarine
  for (const [tag, depth] of [['deep sea', -70], ['shallows', -14]]) {
    p = g.findSea(depth); toCar(p.x, p.z, 0); g.VEH.form = 'sub'; g.VEH.pos.y = -8; g.step(1 / 60, 60);
    run_(600, 60, () => { checkSea(tag); checkPlayer(tag); checkSolid(tag); });
  }
  // 4b. real input under water: drive the submarine (W) into a seabed rock, then as a turtle (T) swim into it
  p = g.findSea(-30); toCar(p.x, p.z, 0); g.VEH.form = 'sub'; g.VEH.pos.y = -8; g.step(1 / 60, 30);
  let rock = null, rd = 1e9;
  // nearest deep rock that has a level, free approach 18 m out on some side
  const level = (c2) => { for (let k = 0; k < 8; k++) { const sx = c2.x + Math.sin(k * Math.PI / 4) * (c2.r + 18), sz = c2.z + Math.cos(k * Math.PI / 4) * (c2.r + 18), h = g.heightAt(sx, sz); if (h < -8 && Math.abs(h - g.heightAt(c2.x, c2.z)) <= 2 && depthIn(sx, sz, 2.2) <= -1) return true; } return false; };
  for (const ch of g.chunks.values()) for (const c2 of ch.colliders) if (c2.t === 0 && c2.r > 1 && c2.bot === undefined && g.heightAt(c2.x, c2.z) < -10) { const d = Math.hypot(c2.x - g.VEH.pos.x, c2.z - g.VEH.pos.z); if (d < rd && level(c2)) { rd = d; rock = c2; } }
  if (rock) {
    ramInto('submarine into a seabed rock', rock, 2.2, true);
    key('KeyT', true); g.step(1 / 60, 2); key('KeyT', false);
    if (g.G.mode === 'turtle') ramInto('turtle into a seabed rock', rock, 1.5, true); else rec('T turns the submarine into a turtle', true, 1, '');
    key('KeyT', true); g.step(1 / 60, 2); key('KeyT', false); // back to the submarine
  } else rec('found a seabed rock', true, 1, '');
  // 5. real input: turtle (T), dive (Q) for 4 s, swim with W
  key('KeyT', true); g.step(1 / 60, 2); key('KeyT', false);
  key('KeyQ', true); key('KeyW', true); run_(240, 10, () => checkPlayer('turtle Q+W')); key('KeyQ', false); key('KeyW', false);
  rec('turtle mode reached with T', g.G.mode !== 'turtle', 1, '');
  // 6. real input: fly (F) from a road, dive with W for 3 s
  p = g.findBiome('meadow', 0.6); toCar(p.x, p.z, 0); g.step(1 / 60, 30);
  key('KeyF', true); g.step(1 / 60, 2); key('KeyF', false);
  key('KeyW', true); run_(180, 5, () => { checkPlayer('bird W'); checkSolid('bird W'); }); key('KeyW', false);
  run_(120, 10, () => { checkPlayer('bird glide'); checkSolid('bird glide'); });
  // 6b. the bird glides into a house at mid-wall height, and into a tree crown
  if (g.G.mode !== 'bird') { key('KeyF', true); g.step(1 / 60, 2); key('KeyF', false); }
  const pick = (test) => { let best = null, bd = 1e9; for (const ch of g.chunks.values()) for (const c2 of ch.colliders) if (test(c2)) { const d = Math.hypot(c2.x - g.BIRD.pos.x, c2.z - g.BIRD.pos.z); if (d < bd) { bd = d; best = c2; } } return best; };
  const house = pick((c2) => c2.t === 1 && c2.hw > 3 && c2.top - g.heightAt(c2.x, c2.z) > 7);
  if (house && g.G.mode === 'bird') ramInto('bird into a house', house, 1, false, (g.heightAt(house.x, house.z) + house.top) / 2, null);
  if (g.G.mode !== 'bird') { key('KeyF', true); g.step(1 / 60, 2); key('KeyF', false); }
  const crown = pick((c2) => c2.bot !== undefined && c2.r < 6 && c2.top - c2.bot > 3);
  if (crown && g.G.mode === 'bird') ramInto('bird into a tree crown', crown, 1, false, (crown.bot + crown.top) / 2, null);
  // 7. field animals over 20 s
  p = g.findBiome('field', 0.6); toCar(p.x, p.z, 0); run_(1200, 60, () => { checkLand('field'); checkSolid('field'); });
  return Object.values(rows);
}

// ---- traffic soak: drive the traffic for `frames` steps; count vehicles inside each other, cars stopped > 20 s,
// U-turns (started, finished, longer than 10 s), and deadlocks (distinct wait-for cycles; must be 0)
export function soak(biome, frames = 5400) {
  const t = g.traffic, p = g.findBiome(biome, 0.6);
  toCar(p.x + 300, p.z + 300, 0); g.step(1 / 60, 30);
  let pairs = 0, overlaps = 0, turns = 0, turned = 0, longTurns = 0;
  const still = new Map(), turning = new Map(), cycles = new Set();
  for (let f = 0; f < frames; f += 10) {
    g.step(1 / 60, 10); g.camera.updateMatrixWorld(); // a hidden tab does not render, so keep the camera matrices current
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const a = t[i], b = t[j];
      if (a.hidden || b.hidden || Math.abs(a.x - b.x) > 14 || Math.abs(a.z - b.z) > 14 || Math.abs(a.y - b.y) > 3) continue;
      pairs++; if (obbOverlap(a, b)) overlaps++;
    }
    // deadlock: follow each stopped car's reason ("follow 12", "cross 7", "junction 3", "blocked 5") to the car it waits
    // for; coming back round to a car already on the path is a cycle that no rule can clear
    for (const a of t) {
      if (a.hidden || a.speed >= 0.3) continue;
      const path = []; let c = a;
      while (c && !path.includes(c)) { path.push(c); const m = /\d+/.exec(c.why || ''); c = m && t[+m[0]]; }
      const cyc = c ? path.slice(path.indexOf(c)) : [];
      // a car in a U-turn arc still moves, so a cycle through it clears by itself
      if (cyc.length && cyc.every((x) => x.speed < 0.3 && !(x.turnU >= 0))) cycles.add(cyc.map((x) => t.indexOf(x)).sort((x, y) => x - y).join(' '));
    }
    for (const a of t) {
      still.set(a, !a.hidden && a.speed < 0.3 ? (still.get(a) || 0) + 10 : 0);
      const on = a.turnU >= 0, was = turning.get(a);
      if (on && was === undefined) { turns++; turning.set(a, f); }
      else if (on && f - was > 600) { longTurns++; turning.set(a, f); }
      else if (!on && was !== undefined) { turned++; turning.delete(a); }
    }
  }
  let stuck = 0; const why = {};
  for (const [a, n] of still) if (n >= 1200) { stuck++; const w = (a.why || 'none').split(' ')[0] + (Math.hypot(a.x - g.VEH.pos.x, a.z - g.VEH.pos.z) < 120 ? ' near player' : ' far'); why[w] = (why[w] || 0) + 1; }
  return { biome, seconds: frames / 60, closePairs: pairs, overlaps, stoppedOver20s: stuck, stoppedWhy: JSON.stringify(why), deadlocks: cycles.size, uTurnsStarted: turns, uTurnsFinished: turned, uTurnsOver10s: longTurns };
}

// ---- fault injection: break the physics on purpose; each check must go red (proves no check is tautological)
export async function faults() {
  for (const k in rows) delete rows[k];
  const out = [], caught = (name, row) => out.push({ injection: name, caught: !!(rows[row] && rows[row].fails > 0) });
  let p = g.findBiome('town', 0.6); toCar(p.x, p.z, 0); g.step(1 / 60, 120);
  const t = g.traffic.filter((a) => !a.hidden);
  const a = t[0], b = t[1], ay = a.y, sb = { x: b.x, y: b.y, z: b.z, yaw: b.yaw };
  a.y -= 2; checkLand('fault'); caught('traffic car 2 m under the road', 'fault traffic on road'); a.y = ay;
  b.x = a.x + 1; b.y = a.y; b.z = a.z; b.yaw = a.yaw; checkLand('fault'); caught('traffic car moved into another', 'fault traffic overlaps'); Object.assign(b, sb);
  const house = nearestSolid(g.VEH.pos.x, g.VEH.pos.z, 1), sv = g.VEH.pos.clone();
  g.VEH.pos.x = house.x; g.VEH.pos.z = house.z; checkSolid('fault'); caught('player car put inside a house', 'fault player car not inside solids'); g.VEH.pos.copy(sv);
  g.VEH.pos.y -= 3; g.VEH.air = false; checkPlayer('fault'); caught('player car 3 m under the ground', 'fault player car on ground'); g.VEH.pos.copy(sv);
  key('KeyF', true); g.step(1 / 60, 2); key('KeyF', false);
  if (g.G.mode === 'bird') { const bp = g.BIRD.pos.clone(); g.BIRD.pos.set(house.x, g.heightAt(house.x, house.z) + 3, house.z); checkSolid('fault'); caught('bird put inside a house', 'fault bird not inside solids'); g.BIRD.pos.copy(bp); }
  else out.push({ injection: 'bird put inside a house', caught: 'F did not make a bird' });
  p = g.findBiome('field', 0.6); toCar(p.x, p.z, 0); g.step(1 / 60, 120);
  const sh = g.sheep.find((s) => !s.hidden), tree = sh && nearestSolid(sh.x, sh.z, 0, 0.3);
  if (sh && tree) { const ss = { x: sh.x, y: sh.y, z: sh.z }; sh.x = tree.x; sh.z = tree.z; sh.y = g.groundAt(tree.x, tree.z); checkSolid('fault'); caught('sheep put inside a tree', 'fault sheep not inside solids'); Object.assign(sh, ss); }
  else out.push({ injection: 'sheep put inside a tree', caught: 'no sheep or tree found' });
  p = g.findSea(-70); toCar(p.x, p.z, 0); g.VEH.form = 'sub'; g.VEH.pos.y = -8; g.step(1 / 60, 120);
  const f = g.fish.find((x) => !x.hidden), fy = f.y;
  f.y = 0.5; checkSea('fault'); caught('fish lifted out of the sea', 'fault fish below surface'); f.y = fy;
  const cr = g.crabs.find((x) => !x.hidden), cy = cr.y;
  cr.y -= 2; checkSea('fault'); caught('crab 2 m under the sea floor', 'fault crabs on sea floor'); cr.y = cy;
  const wh = g.whales.find((x) => !x.hidden);
  if (wh) { const wy = wh.y; wh.y = drawnGround(wh.x, wh.z); checkSea('fault'); caught('whale dropped onto the sea floor', 'fault whales above sea floor'); wh.y = wy; }
  else out.push({ injection: 'whale dropped onto the sea floor', caught: 'no whale in view' });
  return out;
}

// ---- body against body: moving things must not pass through each other. Samples every 0.5 s for `secs` in one place
// (town, field or sea) and counts pairs more than 0.3 m inside each other. Every `bad` must be 0.
export function overlaps(biome, secs = 20) {
  const vis = (l) => l.filter((a) => !a.hidden), hw = (a) => (a.spec.len > 8 ? 1.45 : 1.15);
  const inCar = (a, x, z, r) => { const ox = x - a.x, oz = z - a.z, cs = Math.cos(a.yaw), sn = Math.sin(a.yaw); return Math.min(hw(a) + r - Math.abs(ox * cs - oz * sn), a.spec.len / 2 + r - Math.abs(ox * sn + oz * cs)); };
  const R = {}, hit = (k, d, a) => { const r = R[k] || (R[k] = { pair: k, n: 0, bad: 0, worst: 0, at: '' }); r.n++; if (d > 0.3) { r.bad++; if (d > r.worst) { r.worst = +d.toFixed(2); r.at = at(a); } } };
  const p = biome === 'sea' ? g.findSea(-60) : g.findBiome(biome, 0.6);
  toCar(p.x, p.z, 0); if (biome === 'sea') { g.VEH.form = 'sub'; g.VEH.pos.y = -20; } g.step(1 / 60, 90);
  const pairs = (L, r, k) => { for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j]; if (Math.abs(a.x - b.x) < 2 * r && Math.abs(a.z - b.z) < 2 * r) hit(k, 2 * r - Math.hypot(a.x - b.x, a.z - b.z), a); } };
  for (let f = 0; f < secs * 60; f += 30) {
    g.step(1 / 60, 30);
    const t = vis(g.traffic), peds = vis(g.peds).filter((a) => !(a.down > 0));
    for (const a of t) {
      // the whole car body (circles along its length), not only its middle, against trees, lamps and houses
      const n = Math.max(2, Math.ceil(a.spec.len / (2 * hw(a)))), half = a.spec.len / 2 - hw(a); let w = -9;
      for (let i = 0; i <= n; i++) { const k = -half + 2 * half * i / n; w = Math.max(w, depthIn(a.x + Math.sin(a.yaw) * k, a.z + Math.cos(a.yaw) * k, hw(a), false, a.y, 2)); }
      hit('traffic body vs trees/lamps/houses', w, a);
      for (const b of peds) if (Math.abs(b.x - a.x) < 8 && Math.abs(b.z - a.z) < 8) hit('traffic vs pedestrians', inCar(a, b.x, b.z, 0.3), b);
      for (const b of vis(g.sheep)) if (Math.abs(b.x - a.x) < 9 && Math.abs(b.z - a.z) < 9) hit('traffic vs sheep', inCar(a, b.x, b.z, 1.1), b);
    }
    pairs(peds, 0.3, 'pedestrian vs pedestrian'); pairs(vis(g.sheep), 1.1, 'sheep vs sheep'); pairs(vis(g.rabbits), 0.4, 'rabbit vs rabbit');
    if (biome !== 'sea') continue;
    // each body is an upright cylinder, from the game's own table: name, list, radius, bottom and top relative to its y
    // (all times size). A flat ray gliding over a crab is clear; a sphere model would call that an overlap
    const S = g.SWIM;
    const cyl = (a, r, lo, hi, b, r2, lo2, hi2) => Math.min(r + r2 - Math.hypot(a.x - b.x, a.z - b.z), Math.min(a.y + hi, b.y + hi2) - Math.max(a.y + lo, b.y + lo2));
    const sub = { x: g.VEH.pos.x, y: g.VEH.pos.y, z: g.VEH.pos.z };
    for (let i = 0; i < S.length; i++) {
      const [na, LA, ra, la, ha] = S[i];
      for (const a of vis(LA)) { const s = a.size || 1; if (Math.abs(a.x - sub.x) < 20 && Math.abs(a.z - sub.z) < 20) hit(`submarine vs ${na}`, cyl(a, ra * s, la * s, ha * s, sub, 2.2, -1.4, 1.4), a); }
      for (let j = i; j < S.length; j++) {
        const [nb, LB, rb, lb, hb] = S[j], A = vis(LA), B = vis(LB);
        for (let x = 0; x < A.length; x++) for (let y = i === j ? x + 1 : 0; y < B.length; y++) {
          const a = A[x], b = B[y], sa = a.size || 1, sb = b.size || 1;
          if (Math.abs(a.x - b.x) > (ra * sa + rb * sb) + 2 || Math.abs(a.z - b.z) > (ra * sa + rb * sb) + 2) continue;
          hit(`${na} vs ${nb}`, cyl(a, ra * sa, la * sa, ha * sa, b, rb * sb, lb * sb, hb * sb), a);
        }
      }
    }
  }
  return Object.values(R);
}
