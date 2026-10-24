import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../db/db.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { LocateService } from '../locate/locate.service.js';
import { dayKey, type EventCategory, eventCategory, isDayKey, isOpen, startOfDay } from '../domain/rules.js';
import { loadAlerts, loadDispatches, loadEvents, loadTags, loadWorks, loadZones } from '../domain/views.js';

export interface HistoryFilter {
  day?: string | null;
  categories?: EventCategory[];
  zoneId?: string | null;
  workId?: number | null;
  q?: string | null;
}

@Injectable()
export class StateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dispatch: DispatchService,
    private readonly locate: LocateService,
  ) {}

  /** 대시보드 · 관제 · 시연 화면 폴링 (0.5~3초). 구역 색 · 진행 중 작업 · 열린 알림 · 로봇 · 오늘 타임라인 */
  async state(base: string) {
    const now = new Date();
    const [zones, works, tags, alerts, dispatches, robot, events] = await Promise.all([
      loadZones(this.db),
      loadWorks(this.db, base),
      loadTags(this.db, { status: 'active' }),
      loadAlerts(this.db),
      loadDispatches(this.db),
      this.dispatch.robotView(),
      loadEvents(this.db, { from: startOfDay(dayKey(now)) }),
    ]);
    const open = alerts.filter((a) => a.status !== 'resolved');
    return {
      now,
      zones: zones.map((z) => {
        const mine = works.filter((w) => w.zoneId === z.id);
        const working = mine.some((w) => w.checkedInAt && isOpen(w.status));
        const planned = mine.some((w) => !w.checkedInAt && isOpen(w.status));
        const ended = mine.length > 0 && mine.every((w) => !isOpen(w.status));
        return {
          ...z,
          workState: working ? 'working' : planned ? 'planned' : ended ? 'ended' : 'none',
          alert: open.some((a) => a.type === 'fall' && a.zoneId === z.id),
          warning: open.some((a) => a.type === 'abnormal' && a.zoneId === z.id),
        };
      }),
      works,
      tags,
      alerts: [...alerts].reverse().slice(0, 10),
      dispatch: dispatches.at(-1) ?? null,
      robot,
      events: events.slice(0, 30),
      // 비콘: 단말이 지금 어느 수신기 구역에 있는지 (메모리 판정) · 수신기 연결 상태
      presence: this.locate.presence(),
      gateways: this.locate.gateways(),
    };
  }

  /** 이력: day = YYYY-MM-DD | today | all (KST), 종류 · 구역 · 작업 · 검색어로 거르기. 최신 순 */
  async history(f: HistoryFilter) {
    const now = new Date();
    const day = !f.day || f.day === 'today' ? dayKey(now) : f.day;
    if (day !== 'all' && !isDayKey(day)) throw new BadRequestException('날짜는 YYYY-MM-DD · today · all 중 하나예요');
    const from = day === 'all' ? null : startOfDay(day);
    const to = from ? new Date(from.getTime() + 86_400_000) : null;
    const [events, works, alerts, zones] = await Promise.all([
      loadEvents(this.db, { from, to }),
      loadWorks(this.db, ''),
      loadAlerts(this.db),
      loadZones(this.db),
    ]);
    const q = f.q?.trim().toLowerCase();
    const rows = events
      .map((e) => {
        const w = e.workId !== null ? works.find((x) => x.id === e.workId) : null;
        const a = e.alertId !== null ? alerts.find((x) => x.id === e.alertId) : null;
        const workId = e.workId ?? a?.workId ?? null;
        return {
          ...e,
          workId,
          category: eventCategory(e.type),
          zoneId: w?.zoneId ?? a?.zoneId ?? null,
          workCode: works.find((x) => x.id === workId)?.code ?? null,
        };
      })
      .filter((e) => !f.categories?.length || f.categories.includes(e.category))
      .filter((e) => !f.zoneId || e.zoneId === f.zoneId)
      .filter((e) => !f.workId || e.workId === f.workId)
      .filter((e) => !q || `${e.text} ${e.actor} ${e.workCode ?? ''}`.toLowerCase().includes(q));
    return {
      now,
      day,
      today: dayKey(now),
      events: rows,
      works: works.map(({ id, code, title }) => ({ id, code, title })),
      zones,
    };
  }
}
