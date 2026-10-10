import type { CheckItem, EquipmentState } from "./types";

// 위험 유형 템플릿: 고르면 확인 항목이 자동으로 채워진다 (DB 테이블 없이 화면 파일로 관리)
export type TemplateCheck = Omit<CheckItem, "id" | "tagId" | "seq">;

export interface Template {
  id: string;
  name: string;
  checks: TemplateCheck[];
}

export const TEMPLATES: Template[] = [
  {
    id: "chemical_pipe",
    name: "화학물질 배관",
    checks: [
      { item: "배관 잔압 0 확인", needs: "value", unit: "bar", required: true, min: 0, max: 0 },
      { item: "밸브 잠금·표지 부착", needs: "photo", required: true },
      { item: "내산 보호구 착용", needs: "none", required: true },
      { item: "세안·샤워 설비 위치 확인", needs: "none", required: false },
    ],
  },
  {
    id: "confined_space",
    name: "밀폐공간",
    checks: [
      // 적정공기 기준은 산업안전보건기준에 관한 규칙 원문으로 재확인할 것
      { item: "산소 농도 측정", needs: "value", unit: "%", required: true, min: 18, max: 23.5 },
      { item: "환기 장치 가동", needs: "none", required: true },
      { item: "감시인 배치", needs: "none", required: true },
    ],
  },
  {
    id: "residue_tank",
    name: "잔류물 탱크·화기",
    checks: [
      { item: "잔류물 제거·세정 완료", needs: "photo", required: true },
      { item: "가연성 가스 농도 측정", needs: "value", unit: "%LEL", required: true, min: 0, max: 10 },
      { item: "소화기 비치", needs: "none", required: true },
    ],
  },
  {
    id: "old_structure",
    name: "노후·불용 구조물",
    checks: [
      { item: "하부 출입 통제", needs: "none", required: true },
      { item: "구조물 상태 사진", needs: "photo", required: false },
    ],
  },
  {
    id: "pressure_test",
    name: "시험·가압 설비",
    checks: [
      { item: "잔압 0 확인", needs: "value", unit: "bar", required: true, min: 0, max: 0 },
      { item: "밸브 잠금·표지 부착", needs: "photo", required: true },
    ],
  },
];

export const EQUIPMENT_STATE_LABEL: Record<EquipmentState, string> = {
  running: "가동 중",
  stopped: "정지",
  valve_open: "밸브 열림",
  valve_closed: "밸브 닫힘",
  deteriorated: "노후·구조 약화",
};
