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
