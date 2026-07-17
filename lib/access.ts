// ── 장사도구 접근 제어 ────────────────────────────────────────────────────────
// Firebase 구조:
//   toolAccess/{이메일}         → { expires: "YYYY-MM-DD", plan: "30"|"365", updatedAt }
//   toolConfig/codes            → { code30: "...", code365: "..." }  ← 사장님이 콘솔에서 교체 가능
//
// 관리자는 무조건 통과. 코드 재입력 시 만료일 연장.

import { db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

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

  // 유효 코드 조회 (Firebase에 저장 — 사장님이 콘솔에서 언제든 교체 가능)
  let code30 = "", code365 = "";
  try {
    const cfgSnap = await getDoc(doc(db, "toolConfig", "codes"));
    if (cfgSnap.exists()) {
      const cfg = cfgSnap.data();
      code30 = (cfg.code30 || "").trim();
      code365 = (cfg.code365 || "").trim();
    }
  } catch {
    return { ok: false, message: "잠시 후 다시 시도해주세요" };
  }

  let days = 0;
  let plan = "";
  if (code30 && code === code30) { days = 30; plan = "30"; }
  else if (code365 && code === code365) { days = 365; plan = "365"; }
  else {
    return { ok: false, message: "유효하지 않은 코드입니다. 회원 페이지의 코드를 확인해주세요" };
  }

  // 기존 만료일이 남아있으면 그 날짜에 연장, 지났으면 오늘부터
  const today = todayStr();
  let base = today;
  try {
    const cur = await getDoc(doc(db, "toolAccess", lower));
    if (cur.exists()) {
      const curData = cur.data();
      if (curData.banned === true) {
        return { ok: false, message: "이용이 제한된 계정입니다. 문의: danggum.net" };
      }
      const curExp = curData.expires as string;
      if (curExp && curExp > today) base = curExp;
    }
  } catch { /* 신규 등록으로 진행 */ }

  const newExpires = addDays(base, days);
  await setDoc(doc(db, "toolAccess", lower), {
    expires: newExpires,
    plan,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true, message: `이용권이 등록됐습니다 (${newExpires}까지)`, expires: newExpires };
}
