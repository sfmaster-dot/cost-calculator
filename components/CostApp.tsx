"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  loginWithGoogle, logout, onAuthChange,
  getStores, addStore, deleteStore,
  getMenus, saveMenu, deleteMenu, copyMenusToStore, syncCostRateToProfit,
  type Store, type Menu, type Ingredient,
} from "@/lib/firebase";
import type { User } from "firebase/auth";

// ── 상수 ──────────────────────────────────────────────────────────────────────
const STORE_COLORS = ["#f5c842","#ff6b35","#3dd68c","#60a5fa","#c084fc","#f472b6","#fb923c","#34d399"];
const TODAY = new Date();
const TODAY_STR = TODAY.toISOString().slice(0, 10);

function genId() { return Math.random().toString(36).slice(2, 9); }

// 실제 100g당 단가 계산 (수율 반영)
function calcUnitPrice(ing: Ingredient): number {
  const qty = ing.purchaseQty || 0;
  const price = ing.purchasePrice || 0;
  const yr = ing.yieldRate > 0 ? ing.yieldRate : 100;
  if (qty <= 0 || price <= 0) return ing.unitPrice || 0;
  return (price / (qty * yr / 100)) * 100;
}

// 재료 1회 사용 원가
function calcIngCost(ing: Ingredient): number {
  return (ing.amount / 100) * calcUnitPrice(ing);
}

// 메뉴 전체 원가
function calcMenuCost(ings: Ingredient[]): number {
  return (ings || []).reduce((s, i) => s + calcIngCost(i), 0);
}

function calcRate(cost: number, price: number) {
  return price > 0 ? (cost / price) * 100 : 0;
}

function fmt(n: number) { return Math.round(n).toLocaleString("ko-KR"); }
function fmtDec(n: number) { return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }); }

function rateColor(r: number) {
  if (r === 0) return "var(--text-sub)";
  if (r <= 30) return "var(--green)";
  if (r <= 35) return "#f5c842";
  return "var(--red)";
}
function rateLabel(r: number) {
  if (r === 0) return "";
  if (r <= 30) return "✅ 양호";
  if (r <= 35) return "⚠️ 주의";
  return "❌ 개선";
}

// 날짜 경과일
function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Math.floor((TODAY.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function dateBadge(dateStr: string) {
  if (!dateStr) return null;
  const days = daysSince(dateStr);
  if (days < 30) return null;
  if (days < 60) return { text: `${days}일 전 기준`, color: "#f5c842" };
  return { text: `${days}일 전 기준 ⚠️`, color: "var(--red)" };
}

// ── 공통 스타일 ───────────────────────────────────────────────────────────────
const S = {
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "20px",
    marginBottom: "14px",
  } as React.CSSProperties,
  input: {
    width: "100%",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "9px 12px",
    color: "var(--text)",
    fontFamily: "'Noto Sans KR', sans-serif",
    fontSize: "13px",
    outline: "none",
  } as React.CSSProperties,
  btn: (variant: "primary"|"ghost"|"danger" = "ghost") => ({
    border: "none",
    borderRadius: "8px",
    padding: "9px 16px",
    fontSize: "13px",
    fontFamily: "'Noto Sans KR', sans-serif",
    fontWeight: 600,
    cursor: "pointer",
    background: variant === "primary" ? "var(--accent)"
              : variant === "danger" ? "rgba(255,92,92,0.15)"
              : "var(--surface2)",
    color: variant === "primary" ? "#0f1117"
         : variant === "danger" ? "var(--red)"
         : "var(--text)",
  } as React.CSSProperties),
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function useToast() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>|null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m); setShow(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setShow(false), 2800);
  }, []);
  return { msg, show, toast };
}

// ══════════════════════════════════════════════════════════════════════════════
export default function CostApp() {
  const [user, setUser] = useState<User|null>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store|null>(null);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [tab, setTab] = useState<"calc"|"summary"|"reverse">("calc");
  const { msg: toastMsg, show: toastShow, toast } = useToast();

  useEffect(() => {
    return onAuthChange(async (u) => {
      setUser(u);
      if (u) { const s = await getStores(u.uid); setStores(s); }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !selectedStore) return;
    getMenus(user.uid, selectedStore.id).then(setMenus);
  }, [user, selectedStore]);

  const [addingStore, setAddingStore] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreColor, setNewStoreColor] = useState(STORE_COLORS[0]);

  async function handleAddStore() {
    if (!user || !newStoreName.trim()) return;
    await addStore(user.uid, { name: newStoreName.trim(), color: newStoreColor });
    const s = await getStores(user.uid);
    setStores(s); setNewStoreName(""); setAddingStore(false);
    toast("✅ 매장이 추가됐습니다");
  }

  async function handleDeleteStore(store: Store) {
    if (!user) return;
    if (!confirm(`"${store.name}" 매장과 모든 메뉴를 삭제할까요?`)) return;
    await deleteStore(user.uid, store.id);
    const s = await getStores(user.uid);
    setStores(s);
    if (selectedStore?.id === store.id) { setSelectedStore(null); setMenus([]); }
    toast("🗑️ 매장이 삭제됐습니다");
  }

  const saveTimeout = useRef<ReturnType<typeof setTimeout>|null>(null);

  async function handleSaveMenu(menu: Menu) {
    if (!user || !selectedStore) return;
    await saveMenu(user.uid, selectedStore.id, menu);
  }

  function handleMenuChange(updated: Menu) {
    setMenus(prev => prev.map(m => m.id === updated.id ? updated : m));
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => handleSaveMenu(updated), 800);
  }

  async function handleAddMenu() {
    if (!user || !selectedStore) return;
    const newMenu: Menu = { id: "", name: "", price: 0, targetRate: 30, ingredients: [] };
    await saveMenu(user.uid, selectedStore.id, newMenu);
    const fresh = await getMenus(user.uid, selectedStore.id);
    setMenus(fresh);
  }

  async function handleDeleteMenu(menuId: string) {
    if (!user || !selectedStore) return;
    await deleteMenu(user.uid, selectedStore.id, menuId);
    setMenus(prev => prev.filter(m => m.id !== menuId));
    toast("🗑️ 메뉴가 삭제됐습니다");
  }

  async function handleCopyMenus(toStoreId: string) {
    if (!user || !selectedStore) return;
    const count = await copyMenusToStore(user.uid, selectedStore.id, toStoreId);
    toast(`📋 ${count}개 메뉴가 복사됐습니다`);
  }

  async function handleSyncProfit() {
    if (!user || !selectedStore) return;
    const withRate = menus.filter(m => (m.price||0) > 0 && (m.ingredients||[]).length > 0);
    if (withRate.length === 0) { toast("계산된 메뉴가 없습니다"); return; }
    const avg = withRate.reduce((s, m) => {
      const cost = calcMenuCost(m.ingredients);
      return s + calcRate(cost, m.price);
    }, 0) / withRate.length;
    await syncCostRateToProfit(user.uid, selectedStore.id, avg, TODAY.getFullYear(), TODAY.getMonth());
    toast(`✅ 손익분석기에 원가율 ${avg.toFixed(1)}% 반영됐습니다`);
  }

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", color:"var(--text-sub)", fontFamily:"'Noto Sans KR',sans-serif" }}>
      로딩 중...
    </div>
  );

  if (!user) return <LoginScreen onLogin={loginWithGoogle} />;

  if (!selectedStore) return (
    <StoreScreen
      user={user} stores={stores}
      onSelect={setSelectedStore} onDelete={handleDeleteStore}
      addingStore={addingStore} setAddingStore={setAddingStore}
      newStoreName={newStoreName} setNewStoreName={setNewStoreName}
      newStoreColor={newStoreColor} setNewStoreColor={setNewStoreColor}
      onAddStore={handleAddStore}
      onLogout={() => { logout(); setSelectedStore(null); setMenus([]); setStores([]); }}
    />
  );

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 16px 80px" }}>
      {/* 헤더 */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:28 }}>
        <button onClick={() => { setSelectedStore(null); setMenus([]); }} style={{ ...S.btn(), padding:"7px 12px", fontSize:18 }}>←</button>
        <div style={{ width:36, height:36, borderRadius:10, background:selectedStore.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🏪</div>
        <div>
          <div style={{ fontWeight:700, fontSize:16 }}>{selectedStore.name}</div>
          <div style={{ fontSize:12, color:"var(--text-sub)" }}>{menus.length}개 메뉴 등록됨</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          {stores.filter(s => s.id !== selectedStore.id).length > 0 && (
            <CopyMenuDropdown stores={stores.filter(s=>s.id!==selectedStore.id)} onCopy={handleCopyMenus} />
          )}
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display:"flex", gap:4, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:4, marginBottom:24 }}>
        {(["calc","summary","reverse"] as const).map((t, i) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex:1, padding:"9px", border:"none", borderRadius:8,
            background: tab===t ? "var(--accent)" : "transparent",
            color: tab===t ? "#0f1117" : "var(--text-sub)",
            fontFamily:"'Noto Sans KR',sans-serif", fontSize:13, fontWeight: tab===t ? 700 : 500, cursor:"pointer",
          }}>
            {["📋 원가 계산","📊 메뉴 비교","🎯 판매가 역산"][i]}
          </button>
        ))}
      </div>

      {tab === "calc" && <CalcPanel menus={menus} onChange={handleMenuChange} onAdd={handleAddMenu} onDelete={handleDeleteMenu} />}
      {tab === "summary" && <SummaryPanel menus={menus} />}
      {tab === "reverse" && <ReversePanel />}

      <div style={{
        position:"fixed", bottom:32, left:"50%",
        transform:`translateX(-50%) translateY(${toastShow ? 0 : 80}px)`,
        opacity: toastShow ? 1 : 0,
        background:"var(--accent)", color:"#0f1117",
        fontFamily:"'Noto Sans KR',sans-serif", fontSize:13, fontWeight:700,
        padding:"11px 22px", borderRadius:99, transition:"all 0.3s",
        pointerEvents:"none", zIndex:999, whiteSpace:"nowrap",
      }}>{toastMsg}</div>
    </div>
  );
}

// ── 로그인 화면 ───────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"32px 24px", background:"var(--bg)" }}>
      <div style={{
        background:"var(--surface)", borderRadius:20, padding:"48px 32px 32px",
        width:"100%", maxWidth:360, display:"flex", flexDirection:"column", alignItems:"center", gap:0,
        boxShadow:"0 8px 40px rgba(0,0,0,0.4)",
      }}>
        {/* 로고 */}
        <img src="data:image/png;base64,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" alt="단꿈" style={{ width:64, height:64, objectFit:"contain", marginBottom:20 }} />

        {/* 타이틀 */}
        <div style={{ fontSize:22, fontWeight:900, color:"var(--text)", marginBottom:10, textAlign:"center" }}>
          단꿈 원가율 계산기
        </div>
        <div style={{ fontSize:13, color:"var(--text-sub)", lineHeight:1.7, textAlign:"center", marginBottom:32 }}>
          메뉴별 원가율을 관리하고<br />적정 판매가를 찾아드려요
        </div>

        {/* 로그인 버튼 */}
        <button onClick={onLogin} style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10,
          background:"var(--surface2)", color:"var(--text)",
          border:"1px solid var(--border)", borderRadius:12, padding:"14px 24px",
          fontSize:15, fontWeight:700, fontFamily:"'Noto Sans KR',sans-serif", cursor:"pointer",
          marginBottom:16,
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M24 9.5c3.5 0 6.3 1.2 8.4 3.1l6.3-6.3C34.9 2.9 29.8.5 24 .5 14.8.5 7 6.1 3.6 14l7.4 5.7C12.8 13.1 17.9 9.5 24 9.5z"/>
            <path fill="#34A853" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.2 5.2-4.7 6.8l7.3 5.7c4.3-4 6.8-9.9 6.8-16.5z"/>
            <path fill="#FBBC05" d="M11 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7L3.6 14C1.3 18 0 22.4 0 24s1.3 6 3.6 10l7.4-5.3z"/>
            <path fill="#EA4335" d="M24 47.5c6 0 11-2 14.7-5.3l-7.3-5.7c-2 1.3-4.6 2.1-7.4 2.1-6.1 0-11.2-3.6-13-8.9l-7.4 5.7C7 41.9 14.8 47.5 24 47.5z"/>
          </svg>
          Google로 시작하기
        </button>

        {/* 카카오톡 안내 */}
        <div style={{ fontSize:12, color:"var(--text-sub)", textAlign:"center", lineHeight:1.7, marginBottom:32 }}>
          카카오톡·네이버 앱에서는 로그인이 안 될 수 있어요.<br />
          크롬 또는 사파리로 열어주세요.
        </div>

        {/* 프로모 버튼 */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, width:"100%" }}>
          <a href="https://danggum.net/ex" target="_blank" style={{
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            background:"rgba(61,214,140,0.12)", border:"1px solid rgba(61,214,140,0.3)",
            borderRadius:10, padding:"11px 8px", textDecoration:"none",
            fontSize:12, fontWeight:700, color:"var(--green)",
          }}>
            🥡 배달창업도 <strong>청년다방</strong>
          </a>
          <a href="https://danggum.net/agu" target="_blank" style={{
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            background:"rgba(245,200,66,0.10)", border:"1px solid rgba(245,200,66,0.3)",
            borderRadius:10, padding:"11px 8px", textDecoration:"none",
            fontSize:12, fontWeight:700, color:"var(--accent)",
          }}>
            🐟 아구찜 <strong>전수창업</strong>
          </a>
        </div>
      </div>
    </div>
  );
}

// ── 매장 선택 화면 ─────────────────────────────────────────────────────────────
function StoreScreen({ user, stores, onSelect, onDelete, addingStore, setAddingStore, newStoreName, setNewStoreName, newStoreColor, setNewStoreColor, onAddStore, onLogout }: any) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 16px 80px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:32 }}>
        <div>
          <div style={{ fontSize:11, color:"var(--text-sub)", marginBottom:4 }}>{user.displayName || user.email}</div>
          <div style={{ fontSize:22, fontWeight:900 }}>내 <span style={{ color:"var(--accent)" }}>매장</span> 선택</div>
        </div>
        <button onClick={onLogout} style={{ ...S.btn(), fontSize:12, padding:"7px 12px" }}>로그아웃</button>
      </div>
      {stores.length === 0 && !addingStore && (
        <div style={{ textAlign:"center", padding:"48px 0", color:"var(--text-sub)", fontSize:14, lineHeight:1.8 }}>아직 등록된 매장이 없어요.<br/>아래 버튼으로 첫 매장을 추가해보세요!</div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        {stores.map((store: Store) => (
          <div key={store.id} style={{ ...S.card, cursor:"pointer", marginBottom:0, borderLeft:`3px solid ${store.color}`, position:"relative" }} onClick={() => onSelect(store)}>
            <div style={{ fontSize:28, marginBottom:8 }}>🏪</div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>{store.name}</div>
            <div style={{ fontSize:11, color:"var(--text-sub)" }}>탭해서 입장</div>
            <button onClick={e => { e.stopPropagation(); onDelete(store); }} style={{ position:"absolute", top:10, right:10, background:"transparent", border:"none", color:"var(--text-sub)", fontSize:16, cursor:"pointer", padding:4 }}>✕</button>
          </div>
        ))}
      </div>
      {addingStore ? (
        <div style={S.card}>
          <div style={{ fontSize:13, fontWeight:700, color:"var(--text-sub)", marginBottom:14, letterSpacing:"0.05em" }}>NEW 매장 추가</div>
          <input style={{ ...S.input, marginBottom:12 }} placeholder="매장 이름 (예: 삼겹살집 홍대점)" value={newStoreName} onChange={e => setNewStoreName(e.target.value)} onKeyDown={e => e.key === "Enter" && onAddStore()} autoFocus />
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {STORE_COLORS.map(c => (
              <div key={c} onClick={() => setNewStoreColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline: newStoreColor===c ? `3px solid white` : "none", outlineOffset:2 }} />
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onAddStore} style={{ ...S.btn("primary"), flex:1 }}>추가</button>
            <button onClick={() => setAddingStore(false)} style={{ ...S.btn(), flex:1 }}>취소</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAddingStore(true)} style={{ width:"100%", padding:14, borderRadius:"var(--radius)", border:"1px dashed var(--border)", background:"transparent", color:"var(--text-sub)", fontFamily:"'Noto Sans KR',sans-serif", fontSize:14, cursor:"pointer" }}>
          ＋ 매장 추가
        </button>
      )}
    </div>
  );
}

// ── 원가 계산 패널 ─────────────────────────────────────────────────────────────
function CalcPanel({ menus, onChange, onAdd, onDelete }: { menus: Menu[]; onChange: (m: Menu) => void; onAdd: () => void; onDelete: (id: string) => void; }) {
  return (
    <div>
      <div style={{ background:"rgba(245,200,66,0.07)", border:"1px solid rgba(245,200,66,0.2)", borderRadius:"var(--radius)", padding:"14px 18px", fontSize:13, color:"var(--text-sub)", lineHeight:1.7, marginBottom:20 }}>
        <strong style={{ color:"var(--accent)" }}>💡 작성 방법</strong><br />
        메뉴명·판매가 입력 → 재료별 <strong style={{color:"var(--text)"}}>구매량(g) / 구매가격(원) / 수율(%) / 1회 사용량(g)</strong> 입력<br />
        수율: 손질 후 실제 사용 가능 비율 (예: 쭈꾸미 80%, 손질 없는 재료 100%)<br />
        원가율 <strong style={{ color:"var(--green)" }}>30% 이하</strong> 양호 · <strong style={{ color:"#f5c842" }}>35% 이하</strong> 주의 · <strong style={{ color:"var(--red)" }}>35% 초과</strong> 개선 필요
      </div>
      {menus.length === 0 && (
        <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text-sub)", fontSize:14 }}>아직 메뉴가 없어요. 아래 버튼으로 추가해보세요!</div>
      )}
      {menus.map((menu, idx) => (
        <MenuCard key={menu.id} menu={menu} colorIdx={idx} onChange={onChange} onDelete={onDelete} />
      ))}
      <button onClick={onAdd} style={{ width:"100%", padding:14, borderRadius:"var(--radius)", border:"1px dashed var(--border)", background:"transparent", color:"var(--text-sub)", fontFamily:"'Noto Sans KR',sans-serif", fontSize:14, cursor:"pointer" }}>
        ＋ 메뉴 추가하기
      </button>
    </div>
  );
}

// ── 메뉴 카드 ─────────────────────────────────────────────────────────────────
const MENU_COLORS = ["#f5c842","#ff6b35","#3dd68c","#60a5fa","#c084fc","#f472b6"];

function MenuCard({ menu, colorIdx, onChange, onDelete }: { menu: Menu; colorIdx: number; onChange: (m: Menu) => void; onDelete: (id: string) => void; }) {
  const color = MENU_COLORS[colorIdx % MENU_COLORS.length];
  const cost = calcMenuCost(menu.ingredients || []);
  const rate = calcRate(cost, menu.price);
  const margin = menu.price - cost;
  const target = menu.targetRate || 30;
  const fillW = Math.min(rate, 60);
  const fillColor = rate <= 30 ? "var(--green)" : rate <= 35 ? "#f5c842" : "var(--red)";

  function updateIng(idx: number, field: keyof Ingredient, val: string) {
    const ings = [...(menu.ingredients || [])];
    if (field === "name" || field === "priceDate") {
      (ings[idx] as any)[field] = val;
    } else {
      (ings[idx] as any)[field] = parseFloat(val) || 0;
    }
    onChange({ ...menu, ingredients: ings });
  }

  function addIng() {
    onChange({ ...menu, ingredients: [...(menu.ingredients || []), {
      id: genId(), name: "", amount: 0,
      purchaseQty: 0, purchasePrice: 0, yieldRate: 100, priceDate: TODAY_STR,
    }]});
  }

  function removeIng(idx: number) {
    const ings = [...(menu.ingredients || [])];
    ings.splice(idx, 1);
    onChange({ ...menu, ingredients: ings });
  }

  return (
    <div style={{ ...S.card, borderLeft:`3px solid ${color}` }}>
      {/* 메뉴명·기준날짜·삭제 */}
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
        <input style={{ ...S.input, flex:1, fontSize:15, fontWeight:700 }} placeholder="메뉴 이름 (예: 불향쭈꾸미 2인)" value={menu.name} onChange={e => onChange({ ...menu, name: e.target.value })} />
        <div style={{ display:"flex", flexDirection:"column", gap:3, flexShrink:0 }}>
          <span style={{ fontSize:9, fontWeight:700, color:"var(--text-sub)", letterSpacing:"0.04em" }}>기준날짜</span>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <input type="date" style={{ ...S.input, width:130, fontSize:11, padding:"5px 8px" }}
              value={menu.priceDate || TODAY_STR}
              onChange={e => onChange({ ...menu, priceDate: e.target.value })} />
            {(() => { const b = dateBadge(menu.priceDate||""); return b ? <span style={{ fontSize:11, color:b.color, whiteSpace:"nowrap" }}>{b.text}</span> : null; })()}
          </div>
        </div>
        <button onClick={() => onDelete(menu.id)} style={{ ...S.btn("danger"), padding:"9px 12px", flexShrink:0 }}>✕</button>
      </div>

      {/* 판매가·목표 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:5 }}>판매가 (원)</div>
          <div style={{ position:"relative" }}>
            <input type="number" style={{ ...S.input, fontFamily:"'DM Mono',monospace", paddingRight:30 }}
              placeholder="22000" value={menu.price||""}
              onChange={e => onChange({ ...menu, price: parseFloat(e.target.value)||0 })} />
            <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"var(--text-sub)" }}>원</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:5 }}>목표 원가율 (%)</div>
          <div style={{ position:"relative" }}>
            <input type="number" style={{ ...S.input, fontFamily:"'DM Mono',monospace", paddingRight:30 }}
              placeholder="30" value={menu.targetRate||30}
              onChange={e => onChange({ ...menu, targetRate: parseFloat(e.target.value)||30 })} />
            <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"var(--text-sub)" }}>%</span>
          </div>
        </div>
      </div>

      {/* 재료 헤더 */}
      <div style={{ display:"grid", gridTemplateColumns:"1.8fr 80px 80px 60px 72px 80px 32px", gap:5, marginBottom:6 }}>
        {["재료명","구매량(g)","구매가(원)","수율(%)","사용량(g)","원가(원)",""].map((h,i) => (
          <div key={i} style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", paddingLeft: i < 6 ? 6 : 0 }}>{h}</div>
        ))}
      </div>

      {/* 재료 목록 */}
      {(menu.ingredients || []).map((ing, idx) => {
        const ingCost = calcIngCost(ing);
        return (
          <div key={ing.id} style={{ display:"grid", gridTemplateColumns:"1.8fr 80px 80px 60px 72px 80px 32px", gap:5, marginBottom:6, alignItems:"center" }}>
            <input style={S.input} placeholder="재료명" value={ing.name} onChange={e => updateIng(idx,"name",e.target.value)} />
            <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }}
              placeholder="5400" value={ing.purchaseQty||""} onChange={e => updateIng(idx,"purchaseQty",e.target.value)} />
            <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }}
              placeholder="64000" value={ing.purchasePrice||""} onChange={e => updateIng(idx,"purchasePrice",e.target.value)} />
            <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }}
              placeholder="100" value={ing.yieldRate||""} onChange={e => updateIng(idx,"yieldRate",e.target.value)} />
            <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }}
              placeholder="300" value={ing.amount||""} onChange={e => updateIng(idx,"amount",e.target.value)} />
            {/* 사용량 기반 원가 자동 계산 */}
            <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8, padding:"8px 10px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12, color: ingCost > 0 ? "var(--green)" : "var(--text-sub)" }}>
              {ingCost > 0 ? `${fmtDec(ingCost)}원` : "—"}
            </div>
            <button onClick={() => removeIng(idx)} style={{ width:32, height:34, borderRadius:6, border:"1px solid var(--border)", background:"transparent", color:"var(--text-sub)", fontSize:14, cursor:"pointer" }}>✕</button>
          </div>
        );
      })}

      <button onClick={addIng} style={{ width:"100%", padding:"7px", borderRadius:8, border:"1px dashed var(--border)", background:"transparent", color:"var(--text-sub)", fontFamily:"'Noto Sans KR',sans-serif", fontSize:12, cursor:"pointer", marginBottom:16 }}>
        ＋ 재료 추가
      </button>

      {/* 결과 */}
      {menu.price > 0 && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, background:"var(--surface2)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border)", marginBottom:10 }}>
            {[
              ["식재료 원가", `${fmt(cost)}원`, "var(--text)"],
              ["원가율", rate > 0 ? `${rate.toFixed(1)}%` : "—", rateColor(rate)],
              ["마진", margin > 0 ? `${fmt(margin)}원` : "—", rateColor(rate)],
            ].map(([label, val, col]) => (
              <div key={label as string} style={{ textAlign:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", letterSpacing:"0.05em", marginBottom:4 }}>{label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:17, color:col as string }}>{val}</div>
              </div>
            ))}
          </div>
          {rate > 0 && (
            <div>
              <div style={{ height:7, background:"var(--border)", borderRadius:99, overflow:"hidden", position:"relative", marginBottom:5 }}>
                <div style={{ height:"100%", width:`${(fillW/60)*100}%`, background:fillColor, borderRadius:99, transition:"width 0.4s" }} />
                <div style={{ position:"absolute", top:-4, left:`${(target/60)*100}%`, width:2, height:15, background:"var(--accent)", borderRadius:99 }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--text-sub)" }}>
                <span>0%</span><span style={{ color:"var(--accent)" }}>목표 {target}%</span><span>60%+</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 요약 패널 ─────────────────────────────────────────────────────────────────
function SummaryPanel({ menus }: { menus: Menu[] }) {
  const withData = menus.filter(m => m.price > 0 && (m.ingredients||[]).length > 0);

  if (menus.length === 0) return (
    <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text-sub)", fontSize:14 }}>원가 계산 탭에서 메뉴를 추가해주세요</div>
  );

  // 계산
  const menuStats = withData.map((m, i) => {
    const cost = calcMenuCost(m.ingredients||[]);
    const rate = calcRate(cost, m.price);
    return { m, cost, rate, color: MENU_COLORS[menus.indexOf(m) % MENU_COLORS.length] };
  });

  const avgRate = menuStats.length > 0
    ? menuStats.reduce((s, x) => s + x.rate, 0) / menuStats.length : 0;
  const maxRate = menuStats.length > 0 ? menuStats.reduce((a, b) => a.rate > b.rate ? a : b) : null;
  const minRate = menuStats.length > 0 ? menuStats.reduce((a, b) => a.rate < b.rate ? a : b) : null;

  // 단가 경고 재료 수집
  const staleIngs: { menuName: string; ingName: string; days: number; price: number; date: string }[] = [];
  menus.forEach(m => {
    if (!m.priceDate) return;
    const days = daysSince(m.priceDate);
    if (days >= 30) {
      (m.ingredients||[]).forEach(ing => {
        if (ing.name) staleIngs.push({ menuName: m.name||"(이름 없음)", ingName: ing.name, days, price: ing.purchasePrice||0, date: m.priceDate||"" });
      });
    }
  });

  const maxBarRate = Math.max(...menuStats.map(x => x.rate), 40);

  return (
    <div>
      {/* ① 바 차트 */}
      <div style={S.card}>
        <div style={{ fontSize:12, fontWeight:700, color:"var(--text-sub)", letterSpacing:"0.06em", marginBottom:18, textTransform:"uppercase" }}>① 메뉴별 원가율</div>
        {menuStats.length === 0 ? (
          <div style={{ fontSize:13, color:"var(--text-sub)" }}>판매가와 재료가 입력된 메뉴가 없습니다</div>
        ) : menuStats.map(({ m, cost, rate, color }) => (
          <div key={m.id} style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0, display:"inline-block" }} />
                <span style={{ fontSize:13, fontWeight:600 }}>{m.name||"(이름 없음)"}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"var(--text-sub)" }}>{fmt(cost)}원</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:700, color:rateColor(rate) }}>{rate.toFixed(1)}%</span>
                <span style={{ fontSize:12 }}>{rateLabel(rate)}</span>
              </div>
            </div>
            {/* 바 */}
            <div style={{ position:"relative", height:8, background:"var(--border)", borderRadius:99, overflow:"visible" }}>
              <div style={{ height:"100%", width:`${Math.min((rate/maxBarRate)*100, 100)}%`, background:rateColor(rate), borderRadius:99, transition:"width 0.4s" }} />
              {/* 목표선 30% */}
              <div style={{ position:"absolute", top:-4, left:`${(30/maxBarRate)*100}%`, width:2, height:16, background:"var(--accent)", borderRadius:99 }} />
            </div>
          </div>
        ))}
        {/* 범례 */}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:16, marginTop:8 }}>
          <span style={{ fontSize:10, color:"var(--accent)" }}>| 목표 30%</span>
          <span style={{ fontSize:10, color:"var(--green)" }}>● 30% 이하 양호</span>
          <span style={{ fontSize:10, color:"#f5c842" }}>● 35% 이하 주의</span>
          <span style={{ fontSize:10, color:"var(--red)" }}>● 35% 초과 개선</span>
        </div>
      </div>

      {/* ② 수익성 요약 카드 */}
      {menuStats.length > 0 && (
        <div style={S.card}>
          <div style={{ fontSize:12, fontWeight:700, color:"var(--text-sub)", letterSpacing:"0.06em", marginBottom:16, textTransform:"uppercase" }}>② 수익성 요약</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:16 }}>
            <div style={{ background:"var(--surface2)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border)", textAlign:"center" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:4 }}>평균 원가율</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:22, color:rateColor(avgRate), fontWeight:600 }}>{avgRate.toFixed(1)}%</div>
              <div style={{ fontSize:11, marginTop:4 }}>{rateLabel(avgRate)}</div>
            </div>
            <div style={{ background:"var(--surface2)", borderRadius:10, padding:"14px 16px", border:`1px solid ${maxRate ? rateColor(maxRate.rate)+"44" : "var(--border)"}`, textAlign:"center" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:4 }}>⚠️ 가장 위험한 메뉴</div>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:4, color:"var(--text)" }}>{maxRate?.m.name||"—"}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color: maxRate ? rateColor(maxRate.rate) : "var(--text-sub)" }}>{maxRate ? `${maxRate.rate.toFixed(1)}%` : "—"}</div>
            </div>
            <div style={{ background:"var(--surface2)", borderRadius:10, padding:"14px 16px", border:`1px solid ${minRate ? rateColor(minRate.rate)+"44" : "var(--border)"}`, textAlign:"center" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:4 }}>✅ 가장 효율적 메뉴</div>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:4, color:"var(--text)" }}>{minRate?.m.name||"—"}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color: minRate ? rateColor(minRate.rate) : "var(--text-sub)" }}>{minRate ? `${minRate.rate.toFixed(1)}%` : "—"}</div>
            </div>
          </div>
          {/* 목표 대비 */}
          {avgRate > 0 && (
            <div style={{ background: avgRate <= 30 ? "rgba(61,214,140,0.08)" : "rgba(255,92,92,0.08)", border:`1px solid ${avgRate <= 30 ? "rgba(61,214,140,0.3)" : "rgba(255,92,92,0.3)"}`, borderRadius:10, padding:"12px 16px", fontSize:13, color:"var(--text-sub)" }}>
              목표 원가율(30%) 대비
              <strong style={{ color: avgRate <= 30 ? "var(--green)" : "var(--red)", marginLeft:8 }}>
                {avgRate <= 30 ? `-${(30-avgRate).toFixed(1)}%p 여유` : `+${(avgRate-30).toFixed(1)}%p 초과`}
              </strong>
              {avgRate > 30 && <span style={{ marginLeft:8 }}>→ 원가 절감 또는 판매가 조정 필요</span>}
            </div>
          )}
        </div>
      )}

      {/* ③ 단가 경고 */}
      <div style={S.card}>
        <div style={{ fontSize:12, fontWeight:700, color:"var(--text-sub)", letterSpacing:"0.06em", marginBottom:16, textTransform:"uppercase" }}>③ 단가 기준일 경과 경고</div>
        {staleIngs.length === 0 ? (
          <div style={{ fontSize:13, color:"var(--green)", display:"flex", alignItems:"center", gap:8 }}>
            <span>✅</span>
            <span>모든 메뉴의 단가 기준일이 30일 이내입니다.</span>
          </div>
        ) : (
          <div>
            <div style={{ fontSize:12, color:"var(--text-sub)", marginBottom:12 }}>
              아래 메뉴의 재료 단가가 오래됐습니다. 실제 원가율과 차이가 날 수 있어요.
            </div>
            {/* 메뉴별 그룹핑 */}
            {Array.from(new Set(staleIngs.map(x => x.menuName))).map(menuName => {
              const items = staleIngs.filter(x => x.menuName === menuName);
              const days = items[0].days;
              const badge = dateBadge(items[0].date);
              return (
                <div key={menuName} style={{ marginBottom:12, background:"var(--surface2)", borderRadius:10, padding:"12px 14px", border:`1px solid ${days >= 60 ? "rgba(255,92,92,0.3)" : "rgba(245,200,66,0.3)"}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>{menuName}</span>
                    {badge && <span style={{ fontSize:11, color:badge.color }}>{badge.text}</span>}
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {items.map((item, i) => (
                      <span key={i} style={{ fontSize:11, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:6, padding:"3px 10px", color:"var(--text-sub)" }}>
                        {item.ingName}
                        {item.price > 0 && <span style={{ marginLeft:4, fontFamily:"'DM Mono',monospace", color:days>=60?"var(--red)":"#f5c842" }}>{fmt(item.price)}원 기준</span>}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 판매가 역산 패널 ───────────────────────────────────────────────────────────
function ReversePanel() {
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [targetRate, setTargetRate] = useState(30);
  const [delivFee, setDelivFee] = useState(9.8);
  const [packCost, setPackCost] = useState(200);

  const cost = calcMenuCost(ings);
  const basic = targetRate > 0 && cost > 0 ? cost / (targetRate / 100) : 0;
  const full = targetRate > 0 && cost > 0 ? (cost + packCost) / ((targetRate / 100) * (1 - delivFee / 100)) : 0;
  const rounded = Math.ceil(full / 500) * 500;

  function addIng() { setIngs(p => [...p, { id:genId(), name:"", amount:0, purchaseQty:0, purchasePrice:0, yieldRate:100, priceDate:TODAY_STR }]); }
  function removeIng(idx: number) { setIngs(p => p.filter((_,i) => i!==idx)); }
  function updateIng(idx: number, field: keyof Ingredient, val: string) {
    setIngs(p => p.map((ing, i) => i===idx ? { ...ing, [field]: (field==="name"||field==="priceDate") ? val : (parseFloat(val)||0) } : ing));
  }

  return (
    <div>
      <div style={{ background:"rgba(245,200,66,0.07)", border:"1px solid rgba(245,200,66,0.2)", borderRadius:"var(--radius)", padding:"14px 18px", fontSize:13, color:"var(--text-sub)", lineHeight:1.7, marginBottom:20 }}>
        <strong style={{ color:"var(--accent)" }}>🎯 판매가 역산이란?</strong><br />
        식재료 원가 계산 → 목표 원가율 설정 → <strong style={{ color:"var(--text)" }}>최소 판매가 자동 계산</strong>
      </div>

      <div style={S.card}>
        <div style={{ fontSize:12, fontWeight:700, color:"var(--text-sub)", marginBottom:14, letterSpacing:"0.06em", textTransform:"uppercase" }}>식재료 원가 입력</div>
        <div style={{ display:"grid", gridTemplateColumns:"1.8fr 80px 80px 60px 72px 80px 32px", gap:5, marginBottom:6 }}>
          {["재료명","구매량(g)","구매가(원)","수율(%)","사용량(g)","100g단가",""].map((h,i) => (
            <div key={i} style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", paddingLeft: i<6?6:0 }}>{h}</div>
          ))}
        </div>
        {ings.map((ing, idx) => {
          const up = calcUnitPrice(ing);
          return (
            <div key={ing.id} style={{ display:"grid", gridTemplateColumns:"1.8fr 80px 80px 60px 72px 80px 32px", gap:5, marginBottom:6, alignItems:"center" }}>
              <input style={S.input} placeholder="재료명" value={ing.name} onChange={e => updateIng(idx,"name",e.target.value)} />
              <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }} placeholder="5400" value={ing.purchaseQty||""} onChange={e => updateIng(idx,"purchaseQty",e.target.value)} />
              <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }} placeholder="64000" value={ing.purchasePrice||""} onChange={e => updateIng(idx,"purchasePrice",e.target.value)} />
              <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }} placeholder="100" value={ing.yieldRate||""} onChange={e => updateIng(idx,"yieldRate",e.target.value)} />
              <input type="number" style={{ ...S.input, textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12 }} placeholder="300" value={ing.amount||""} onChange={e => updateIng(idx,"amount",e.target.value)} />
              <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8, padding:"8px 10px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:12, color: up > 0 ? "var(--accent)" : "var(--text-sub)" }}>
                {up > 0 ? `${fmtDec(up)}원` : "—"}
              </div>
              <button onClick={() => removeIng(idx)} style={{ width:32, height:34, borderRadius:6, border:"1px solid var(--border)", background:"transparent", color:"var(--text-sub)", fontSize:14, cursor:"pointer" }}>✕</button>
            </div>
          );
        })}
        <button onClick={addIng} style={{ width:"100%", padding:"7px", borderRadius:8, border:"1px dashed var(--border)", background:"transparent", color:"var(--text-sub)", fontFamily:"'Noto Sans KR',sans-serif", fontSize:12, cursor:"pointer", marginBottom:12 }}>
          ＋ 재료 추가
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:13, color:"var(--text-sub)" }}>계산된 식재료 원가</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color:"var(--accent)" }}>{fmt(cost)}원</span>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ fontSize:12, fontWeight:700, color:"var(--text-sub)", marginBottom:14, letterSpacing:"0.06em", textTransform:"uppercase" }}>목표 설정</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:5 }}>목표 원가율 (%)</div>
            <div style={{ position:"relative" }}><input type="number" style={{ ...S.input, fontFamily:"'DM Mono',monospace", paddingRight:28 }} value={targetRate} onChange={e => setTargetRate(parseFloat(e.target.value)||30)} /><span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"var(--text-sub)" }}>%</span></div>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:5 }}>배달 수수료 (%)</div>
            <div style={{ position:"relative" }}><input type="number" step="0.1" style={{ ...S.input, fontFamily:"'DM Mono',monospace", paddingRight:28 }} value={delivFee} onChange={e => setDelivFee(parseFloat(e.target.value)||0)} /><span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"var(--text-sub)" }}>%</span></div>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:5 }}>포장재·기타 (원)</div>
            <div style={{ position:"relative" }}><input type="number" style={{ ...S.input, fontFamily:"'DM Mono',monospace", paddingRight:28 }} value={packCost} onChange={e => setPackCost(parseFloat(e.target.value)||0)} /><span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"var(--text-sub)" }}>원</span></div>
          </div>
        </div>
      </div>

      <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"24px 20px", textAlign:"center" }}>
        <div style={{ fontSize:12, color:"var(--text-sub)", marginBottom:6 }}>식재료만 고려한 최소 판매가</div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:34, color:"var(--accent)", marginBottom:16 }}>{basic > 0 ? `${fmt(Math.ceil(basic/500)*500)}원~` : "—"}</div>
        <div style={{ height:1, background:"var(--border)", margin:"0 0 16px" }} />
        <div style={{ fontSize:12, color:"var(--text-sub)", marginBottom:6 }}>배달 수수료·포장비 포함 권장 판매가</div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:26, color:"var(--text)", marginBottom:8 }}>{full > 0 ? `${fmt(rounded)}원~` : "—"}</div>
        {full > 0 && <div style={{ fontSize:11, color:"var(--text-sub)" }}>식재료 {fmt(cost)}원 + 포장재 {fmt(packCost)}원 · 배달수수료 {delivFee}% 반영 · 500원 단위 올림</div>}
      </div>
    </div>
  );
}

// ── 메뉴 복사 드롭다운 ─────────────────────────────────────────────────────────
function CopyMenuDropdown({ stores, onCopy }: { stores: Store[]; onCopy: (id:string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position:"relative" }}>
      <button onClick={() => setOpen(p=>!p)} style={{ ...S.btn(), fontSize:12, padding:"7px 14px" }}>📋 메뉴 복사</button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10, minWidth:180, zIndex:10, overflow:"hidden" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"var(--text-sub)", padding:"10px 14px 6px", letterSpacing:"0.05em" }}>복사할 매장 선택</div>
          {stores.map(s => (
            <button key={s.id} onClick={() => { onCopy(s.id); setOpen(false); }} style={{ width:"100%", padding:"10px 14px", border:"none", background:"transparent", color:"var(--text)", fontFamily:"'Noto Sans KR',sans-serif", fontSize:13, textAlign:"left", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:s.color, flexShrink:0 }} />{s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
