// ── 장사도구 접근 제어 ────────────────────────────────────────────────────────
// Firebase 구조:
//   toolAccess/{이메일}         → { expires: "YYYY-MM-DD", plan: "30"|"365", updatedAt }
//   toolConfig/codes            → { code30: "...", code365: "..." }  ← 사장님이 콘솔에서 교체 가능
//
// 관리자는 무조건 통과. 코드 재입력 시 만료일 연장.

import { db } from "./firebase";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

export const ADMIN_EMAILS = ["sfmaster@naver.com"];

export const PURCHASE_LINKS = {
  month: "https://danggum.net/shop_view/?idx=15",  // 30일권
  year: "https://danggum.net/shop_view/?idx=16",   // 365일권
};

export interface AccessInfo {
  allowed: boolean;
  isAdmin: boolean;
  banned?: boolean;
  expires?: string;   // YYYY-MM-DD
  daysLeft?: number;
  plan?: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(baseDate: string, days: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

// ── 로그인 기록 (손익분석기와 같은 방식) ──
// 이용권 기록이 있는 회원만 · 가입일(구글 계정 생성일)과 최근 접속 시각
// 규칙에서 joinedAt·lastLogin 두 칸만, lastLogin은 서버 시각으로만 쓸 수 있게 막는다
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export async function recordLogin(
  u: { email: string | null; metadata?: { creationTime?: string } } | null,
  a: AccessInfo | null
): Promise<void> {
  if (!u || !u.email || !a || a.isAdmin || a.banned || !a.expires) return;
  try {
    const payload: Record<string, unknown> = { lastLogin: serverTimestamp() };
    const ct = u.metadata?.creationTime;
    if (ct) {
      const d = new Date(ct);
      if (!isNaN(d.getTime())) payload.joinedAt = localDate(d);
    }
    await updateDoc(doc(db, "toolAccess", u.email.toLowerCase()), payload);
  } catch { /* 규칙 미적용이면 조용히 넘어간다 */ }
}

// ── 권한 확인 ──
export async function checkAccess(email: string | null): Promise<AccessInfo> {
  if (!email) return { allowed: false, isAdmin: false };
  const lower = email.toLowerCase();

  if (ADMIN_EMAILS.includes(lower)) {
    return { allowed: true, isAdmin: true };
  }

  try {
    const snap = await getDoc(doc(db, "toolAccess", lower));
    if (!snap.exists()) return { allowed: false, isAdmin: false };
    const data = snap.data();
    if (data.banned === true) {
      return { allowed: false, isAdmin: false, banned: true };
    }
    const expires = data.expires as string;
    if (!expires) return { allowed: false, isAdmin: false };
    const today = todayStr();
    const daysLeft = daysBetween(today, expires);
    if (daysLeft < 0) {
      return { allowed: false, isAdmin: false, expires, daysLeft, plan: data.plan };
    }
    return { allowed: true, isAdmin: false, expires, daysLeft, plan: data.plan };
  } catch {
    return { allowed: false, isAdmin: false };
  }
}

// ── 코드 등록 (신규 + 연장) ──
export async function redeemCode(
  email: string,
  inputCode: string
): Promise<{ ok: boolean; message: string; expires?: string }> {
  const lower = email.toLowerCase();
  const code = inputCode.trim();
  if (!code) return { ok: false, message: "코드를 입력해주세요" };

  // 보안: 코드 대조는 Firestore 규칙에서 한다 (toolConfig는 관리자만 읽을 수 있음).
  // 앱은 코드를 그대로 실어 보내고, 규칙이 toolConfig/codes.code365와 다르면 거절한다.
  // 1년권 단일 상품 — 1개월권은 판매 종료
  const days = 365;
  const plan = "365";

  // 기존 만료일이 남아있으면 그 날짜에 연장, 지났으면 오늘부터
  const today = todayStr();
  let base = today;
  let hasSince = false;
  try {
    const cur = await getDoc(doc(db, "toolAccess", lower));
    if (cur.exists()) {
      const curData = cur.data();
      if (curData.banned === true) {
        return { ok: false, message: "이용이 제한된 계정입니다. 문의: danggum.net" };
      }
      hasSince = !!curData.since;
      const curExp = curData.expires as string;
      if (curExp && curExp > today) base = curExp;
    }
  } catch { /* 신규 등록으로 진행 */ }

  const newExpires = addDays(base, days);
  try {
    await setDoc(doc(db, "toolAccess", lower), {
      expires: newExpires,
      plan,
      code,
      updatedAt: serverTimestamp(),
      ...(hasSince ? {} : { since: today }),
    }, { merge: true });
  } catch {
    return { ok: false, message: "입장코드가 올바르지 않습니다. 회원 페이지의 코드를 확인해주세요" };
  }

  return { ok: true, message: `이용권이 등록됐습니다 (${newExpires}까지)`, expires: newExpires };
}
