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
          <button onClick={handleSyncProfit} style={{ ...S.btn("primary"), fontSize:12, padding:"7px 14px" }}>
            📊 손익분석기 연동
          </button>
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

      <div style={{ textAlign:"center", marginTop:48, color:"var(--text-sub)", fontSize:12 }}>
        단꿈 원가율 계산기 · made by <a href="https://danggum.net" target="_blank" style={{ color:"var(--accent)", textDecoration:"none" }}>단꿈TV</a>
      </div>

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
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", gap:24, padding:24 }}>
      <div style={{ fontSize:40 }}>🧮</div>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:24, fontWeight:900, marginBottom:8 }}>단꿈 <span style={{ color:"var(--accent)" }}>원가율</span> 계산기</div>
        <div style={{ fontSize:14, color:"var(--text-sub)", lineHeight:1.7 }}>매장별 메뉴 원가율을 관리하고<br />손익분석기와 연동하세요</div>
      </div>
      <button onClick={onLogin} style={{ display:"flex", alignItems:"center", gap:10, background:"#fff", color:"#1f1f1f", border:"none", borderRadius:10, padding:"13px 24px", fontSize:14, fontWeight:700, fontFamily:"'Noto Sans KR',sans-serif", cursor:"pointer" }}>
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#4285F4" d="M24 9.5c3.5 0 6.3 1.2 8.4 3.1l6.3-6.3C34.9 2.9 29.8.5 24 .5 14.8.5 7 6.1 3.6 14l7.4 5.7C12.8 13.1 17.9 9.5 24 9.5z"/>
          <path fill="#34A853" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.2 5.2-4.7 6.8l7.3 5.7c4.3-4 6.8-9.9 6.8-16.5z"/>
          <path fill="#FBBC05" d="M11 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7L3.6 14C1.3 18 0 22.4 0 24s1.3 6 3.6 10l7.4-5.3z"/>
          <path fill="#EA4335" d="M24 47.5c6 0 11-2 14.7-5.3l-7.3-5.7c-2 1.3-4.6 2.1-7.4 2.1-6.1 0-11.2-3.6-13-8.9l-7.4 5.7C7 41.9 14.8 47.5 24 47.5z"/>
        </svg>
        Google로 시작하기
      </button>
      <div style={{ fontSize:12, color:"var(--text-sub)" }}>made by <a href="https://danggum.net" target="_blank" style={{ color:"var(--accent)", textDecoration:"none" }}>단꿈TV</a></div>
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
  const withData = menus.filter(m => m.price > 0);
  const avgRate = withData.length > 0
    ? withData.reduce((s, m) => s + calcRate(calcMenuCost(m.ingredients||[]), m.price), 0) / withData.length : 0;

  return (
    <div>
      {menus.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text-sub)", fontSize:14 }}>원가 계산 탭에서 메뉴를 추가해주세요</div>
      ) : (
        <div style={S.card}>
          <div style={{ fontSize:12, fontWeight:700, color:"var(--text-sub)", letterSpacing:"0.06em", marginBottom:16, textTransform:"uppercase" }}>전체 메뉴 원가율 비교</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr>{["메뉴명","판매가","원가","원가율","마진","평가"].map(h => (
                  <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, color:"var(--text-sub)", borderBottom:"1px solid var(--border)", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {menus.map((m, i) => {
                  const cost = calcMenuCost(m.ingredients||[]);
                  const rate = calcRate(cost, m.price);
                  const col = MENU_COLORS[i % MENU_COLORS.length];
                  return (
                    <tr key={m.id}>
                      <td style={{ padding:"11px 10px", borderBottom:"1px solid var(--border)" }}>
                        <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:col, marginRight:8 }} />{m.name || "(이름 없음)"}
                      </td>
                      <td style={{ padding:"11px 10px", borderBottom:"1px solid var(--border)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>{m.price ? `${fmt(m.price)}원` : "—"}</td>
                      <td style={{ padding:"11px 10px", borderBottom:"1px solid var(--border)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>{cost > 0 ? `${fmt(cost)}원` : "—"}</td>
                      <td style={{ padding:"11px 10px", borderBottom:"1px solid var(--border)" }}>
                        {rate > 0 ? <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:99, fontFamily:"'DM Mono',monospace", fontSize:12, background:`${rateColor(rate)}22`, color:rateColor(rate) }}>{rate.toFixed(1)}%</span> : "—"}
                      </td>
                      <td style={{ padding:"11px 10px", borderBottom:"1px solid var(--border)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>{m.price > cost && cost > 0 ? `${fmt(m.price - cost)}원` : "—"}</td>
                      <td style={{ padding:"11px 10px", borderBottom:"1px solid var(--border)", fontSize:12 }}>{rateLabel(rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {avgRate > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, background:"var(--surface2)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border)", marginTop:16 }}>
              <div style={{ textAlign:"center" }}><div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:4 }}>전체 메뉴 수</div><div style={{ fontFamily:"'DM Mono',monospace", fontSize:20 }}>{withData.length}개</div></div>
              <div style={{ textAlign:"center" }}><div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:4 }}>평균 원가율</div><div style={{ fontFamily:"'DM Mono',monospace", fontSize:20, color:rateColor(avgRate) }}>{avgRate.toFixed(1)}%</div></div>
              <div style={{ textAlign:"center" }}><div style={{ fontSize:10, fontWeight:700, color:"var(--text-sub)", marginBottom:4 }}>평가</div><div style={{ fontSize:16 }}>{rateLabel(avgRate)}</div></div>
            </div>
          )}
        </div>
      )}
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
