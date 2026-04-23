import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);

// Auth
export const loginWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logout = () => signOut(auth);
export const onAuthChange = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb);

// Types
export interface Ingredient {
  id: string;
  name: string;
  amount: number;       // 1회 사용량(g)
  purchaseQty: number;  // 구매량(g)
  purchasePrice: number;// 구매가격(원)
  yieldRate: number;    // 수율(%) 기본 100
  priceDate: string;    // 기준날짜 YYYY-MM-DD
  unitPrice?: number;   // 하위호환
}

export interface Menu {
  id: string;
  name: string;
  price: number;
  targetRate: number;
  priceDate?: string;    // 기준날짜 (메뉴 단위)
  ingredients: Ingredient[];
  costRate?: number;
  cost?: number;
  updatedAt?: unknown;
}

export interface Store {
  id: string;
  name: string;
  color: string;
  createdAt?: unknown;
}

// Stores
export async function getStores(uid: string): Promise<Store[]> {
  const q = query(collection(db, "users", uid, "stores"), orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Store));
}

export async function addStore(uid: string, data: Omit<Store, "id">) {
  return addDoc(collection(db, "users", uid, "stores"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function updateStore(uid: string, storeId: string, data: Partial<Store>) {
  return updateDoc(doc(db, "users", uid, "stores", storeId), data);
}

export async function deleteStore(uid: string, storeId: string) {
  // 메뉴도 함께 삭제
  const menuSnap = await getDocs(collection(db, "users", uid, "stores", storeId, "menus"));
  await Promise.all(menuSnap.docs.map(d => deleteDoc(d.ref)));
  return deleteDoc(doc(db, "users", uid, "stores", storeId));
}

// Menus
export async function getMenus(uid: string, storeId: string): Promise<Menu[]> {
  const q = query(
    collection(db, "users", uid, "stores", storeId, "menus"),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Menu));
}

export async function saveMenu(uid: string, storeId: string, menu: Menu) {
  const { id, ...data } = menu;
  const cost = menu.ingredients.reduce((s, ing) => {
    const qty = ing.purchaseQty || 0;
    const price = ing.purchasePrice || 0;
    const yr = (ing.yieldRate && ing.yieldRate > 0) ? ing.yieldRate : 100;
    const up = (qty > 0 && price > 0) ? (price / (qty * yr / 100)) * 100 : (ing.unitPrice || 0);
    return s + (ing.amount / 100) * up;
  }, 0);
  const costRate = menu.price > 0 ? (cost / menu.price) * 100 : 0;
  if (id) {
    return setDoc(doc(db, "users", uid, "stores", storeId, "menus", id), {
      ...data,
      cost,
      costRate,
      updatedAt: serverTimestamp(),
    });
  } else {
    return addDoc(collection(db, "users", uid, "stores", storeId, "menus"), {
      ...data,
      cost,
      costRate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function deleteMenu(uid: string, storeId: string, menuId: string) {
  return deleteDoc(doc(db, "users", uid, "stores", storeId, "menus", menuId));
}

export async function copyMenusToStore(
  uid: string,
  fromStoreId: string,
  toStoreId: string
): Promise<number> {
  const menus = await getMenus(uid, fromStoreId);
  await Promise.all(
    menus.map(menu => {
      const { id, ...data } = menu;
      return addDoc(collection(db, "users", uid, "stores", toStoreId, "menus"), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    })
  );
  return menus.length;
}

// 손익분석기 연동: 해당 매장의 이번 달 costRate 업데이트
export async function syncCostRateToProfit(
  uid: string,
  storeId: string,
  costRate: number,
  year: number,
  month: number
) {
  const monthId = `${year}-${String(month + 1).padStart(2, "0")}`;
  const ref = doc(db, "users", uid, "stores", storeId, "months", monthId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return updateDoc(ref, { costRate: parseFloat(costRate.toFixed(1)) });
  } else {
    return setDoc(ref, { costRate: parseFloat(costRate.toFixed(1)) }, { merge: true });
  }
}
