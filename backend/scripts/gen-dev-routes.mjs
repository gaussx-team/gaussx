// 개발용 씬(scenes/dev)의 사전 계산표 routes.json 을 만든다.
// 프론트 목업(frontend/src/lib/server/store.ts PATHS)과 같은 경로를 0.45 m/s 로 직선 주행한 궤적.
// 실제 현장 씬은 3D 스캔 + MuJoCo 로 계산한 routes.json 을 쓴다 (형식 같음).
//   node scripts/gen-dev-routes.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEED = 0.45; // m/s
const HZ = 20;
const HOME = [3.3, 2.4];
const PATHS = {
  Z1: [HOME, [2.4, 2.0], [1.6, 1.2], [1.0, 0.75]],
  Z2: [HOME, [3.0, 1.6], [3.0, 0.75]],
  Z3: [HOME, [2.2, 2.3], [1.0, 2.25]],
};

const r = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

function drive(path) {
  const lengths = path.slice(1).map((p, i) => seg(path[i], p));
  const total = lengths.reduce((s, l) => s + l, 0);
  const duration = total / SPEED;
  const traj = [];
  for (let k = 0; ; k++) {
    const t = Math.min(k / HZ, duration);
    let d = t * SPEED;
    let i = 0;
    while (i < lengths.length - 1 && d > lengths[i]) d -= lengths[i++];
    const a = path[i];
    const b = path[i + 1];
    const f = lengths[i] ? Math.min(1, d / lengths[i]) : 1;
    traj.push([r(t, 2), r(a[0] + (b[0] - a[0]) * f), r(a[1] + (b[1] - a[1]) * f), r(heading(a, b))]);
    if (t >= duration) break;
  }
  return { traj, duration: r(duration, 2), distance: r(total, 2) };
}

const route = (from, to, path) => {
  const { traj, duration, distance } = drive(path);
  return { from, to, path, goal: path.at(-1), snapped: false, trajectory: traj, reached: true, duration_s: duration, distance_m: distance };
};

const starts = { home: [...HOME, r(Math.PI)] };
const routes = [];
for (const [zone, path] of Object.entries(PATHS)) {
  starts[zone] = [...path.at(-1), r(heading(path.at(-2), path.at(-1)))];
  routes.push(route('home', zone, path));
}
// 구역에 나가 있을 때: 목표 지점으로 직행 (목업과 같다)
for (const from of Object.keys(PATHS)) {
  for (const to of Object.keys(PATHS)) {
    if (from !== to) routes.push(route(from, to, [PATHS[from].at(-1), PATHS[to].at(-1)]));
  }
}

const out = fileURLToPath(new URL('../scenes/dev/demo/routes.json', import.meta.url));
writeFileSync(
  out,
  JSON.stringify({ note: '개발용: 프론트 목업과 같은 경로를 0.45 m/s 로 직선 주행 (scripts/gen-dev-routes.mjs). 실제 씬은 MuJoCo 계산값', starts, routes }),
);
console.log(routes.map((x) => `${x.from}→${x.to} ${x.duration_s}s ${x.distance_m}m`).join('\n'));
