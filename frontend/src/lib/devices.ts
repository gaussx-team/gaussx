// 작업자 단말 목록 (작업반장 휴대폰) (로그인 없음 → 기기 ID 로 작업을 받는다). 백엔드가 생기면 기기 목록 API 로 바꾼다
export const DEVICES = [
  { id: "device-01", label: "단말 1번" },
  { id: "device-02", label: "단말 2번" },
];

// 이 휴대폰이 어느 기기인지 브라우저에 기억 (휴대폰 하나 = 기기 하나)
const KEY = "gaussx-device";
export const savedDevice = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const saveDevice = (id: string | null) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장 안 되는 브라우저면 주소의 ?device= 로만 동작 */
  }
};
