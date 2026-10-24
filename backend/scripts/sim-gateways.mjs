// 비콘 수신기 흉내 — 폰 없이 관제 화면(헬멧 위치)을 시험한다. 실제 수신기 폰과 같이 켜지 않는다 (보고가 섞인다).
// 씬의 수신기(gateways)가 1초마다 보고하는 것처럼 POST /api/gateway 로 보낸다.
//   단말 1번: 첫 수신기 구역 안을 20초에 한 바퀴 → 수신기 두 대가 들어 위치가 나온다
//   단말 2번: 첫 수신기에만 세게 들린다 → '구역 안'만 (위치 모름)
// RSSI 는 백엔드와 같은 거리 모델 (1m 세기 · 감쇠 지수 = demo.json locate)로 만들고 ±1dB 흔든다.
//   npm run sim:gateways                      (백엔드 http://localhost:3001)
//   npm run sim:gateways -- http://localhost:3101
// 끝내기: Ctrl+C

const base = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '');

const get = async (path) => {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

let config;
try {
  config = await get('/api/config');
} catch (e) {
  console.error(`백엔드에 연결할 수 없어요 (${base}): ${e.message}\n백엔드를 먼저 켜 주세요: cd backend → npm run dev`);
  process.exit(1);
}

const gateways = config.gateways ?? [];
const devices = (config.devices ?? []).filter((d) => d.beaconId);
if (gateways.length < 2 || devices.length < 1) {
  console.error('수신기 2대 · 비콘 id 가 있는 단말 1대 이상이 필요해요 (demo.json gateways · devices[].beacon_id)');
  process.exit(1);
}

const [g1, g2] = gateways;
const zone = config.zones.find((z) => z.id === g1.zone);
const [zx, zy, zw, zh] = zone?.rect ?? [g1.world[0] - 1, g1.world[1] - 1, 2, 2];
const center = [zx + zw / 2, zy + zh / 2];
const n = config.locate?.pathLossN ?? 2.5;
const ref = (g) => g.ref1mDbm ?? config.locate?.ref1mDbm ?? -59;
const rssi = (g, p) => ref(g) - 10 * n * Math.log10(Math.max(0.1, Math.hypot(p[0] - g.world[0], p[1] - g.world[1])));
const jitter = (v) => Math.round((v + (Math.random() * 2 - 1)) * 10) / 10;
const reading = (beaconId, v) => ({ beaconId, rssi: Array.from({ length: 5 }, () => jitter(v)), txPower: -59 });

const post = async (gatewayId, readings) => {
  const res = await fetch(base + '/api/gateway', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayId, readings }),
  });
  if (!res.ok) throw new Error(`/api/gateway → ${res.status} ${await res.text()}`);
  return res.json();
};

console.log(`수신기 흉내: ${g1.label}(${g1.id}) · ${g2.label}(${g2.id}) → ${base}`);
console.log(`${devices[0].label}: ${zone?.name ?? g1.zone} 안을 20초에 한 바퀴` + (devices[1] ? ` · ${devices[1].label}: ${g1.label}에만 들림 (구역 안)` : ''));
console.log('관제 화면: http://localhost:3000/control · 끝내기: Ctrl+C\n');

const t0 = Date.now();
setInterval(async () => {
  const a = ((Date.now() - t0) / 20_000) * 2 * Math.PI;
  const p = [center[0] + zw * 0.3 * Math.cos(a), center[1] + zh * 0.3 * Math.sin(a)];
  try {
    await post(g1.id, [reading(devices[0].beaconId, rssi(g1, p)), ...(devices[1] ? [reading(devices[1].beaconId, -62)] : [])]);
    const reply = await post(g2.id, [reading(devices[0].beaconId, rssi(g2, p))]);
    const seen = reply.devices.find((d) => d.deviceId === devices[0].id);
    const pos = seen?.position ? `(${seen.position.x}, ${seen.position.y}) ±${seen.position.err}m` : '계산 중';
    console.log(`${new Date().toLocaleTimeString('ko-KR')}  실제 (${p.map((v) => v.toFixed(2)).join(', ')}) → 백엔드 위치 ${pos} · ${seen?.state ?? '-'}`);
  } catch (e) {
    console.error(`보내지 못했어요: ${e.message}`);
  }
}, 1000);
