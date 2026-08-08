/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp,
  addDoc,
  orderBy,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { toDate } from './utils';

export interface BudgetCategory {
  id: string;
  userId: string;
  name: string;
  monthlyLimit: number;
  rolloverEnabled: boolean;
  rolloverPercentage: number;
  rolledOverAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RolloverEntry {
  id: string;
  userId: string;
  fromMonth: string;
  toMonth: string;
  category: string;
  amount: number;
  percentage: number;
  createdAt: string;
}

export interface BudgetCategoryInput {
  name: string;
  monthlyLimit: number;
  rolloverEnabled?: boolean;
  rolloverPercentage?: number;
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  category: string;
  type: "expense" | "income";
  date: Date;
  description?: string;
}

export interface CategoryBudgetSuggestion {
  category: string;
  averageSpending: number;
  suggestedAmount: number;
  previousMonthSpending: number;
  modifiedAmount?: number;
  status: "accepted" | "rejected" | "modified";
}

export interface BudgetComparison {
  category: string;
  previous: number;
  suggested: number;
  difference: number;
}

export interface BudgetPlan {
  userId: string;
  month: string;
  totalBudget: number;
  categoryBudgets: Record<string, number>;
  confidenceScore: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_CATEGORIES = [
  'Housing',
  'Food & Dining',
  'Transportation',
  'Utilities',
  'Entertainment',
  'Healthcare',
  'Shopping',
  'Education',
  'Savings',
  'Other',
];

export function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getPreviousMonthKey(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function fetchLast3MonthsTransactions(
  userId: string,
): Promise<Transaction[]> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  try {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', userId),
      where('date', '>=', startDate),
      orderBy('date', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        userId: data.userId || '',
        amount: Number(data.amount) || 0,
        category: data.category || 'Other',
        type: data.type === 'income' ? 'income' : 'expense',
        date: toDate(data.date) || new Date(),
        description: data.description || '',
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'transactions');
    return [];
  }
}

export async function fetchPreviousMonthTransactions(
  userId: string,
): Promise<Transaction[]> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', userId),
      where('date', '>=', startDate),
      where('date', '<', endDate),
      orderBy('date', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        userId: data.userId || '',
        amount: Number(data.amount) || 0,
        category: data.category || 'Other',
        type: data.type === 'income' ? 'income' : 'expense',
        date: toDate(data.date) || new Date(),
        description: data.description || '',
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'transactions');
    return [];
  }
}

export function generateBudgetSuggestions(
  transactions: Transaction[],
  previousSpending: Record<string, number>,
): CategoryBudgetSuggestion[] {
  const categoryTotals: Record<string, { total: number; count: number }> = {};
  transactions.forEach((tx) => {
    if (tx.type !== 'expense') return;
    const category = tx.category || 'Other';
    const entry = categoryTotals[category] || { total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count += 1;
    categoryTotals[category] = entry;
  });

  return Object.entries(categoryTotals).map(([category, entry]) => {
    const averageSpending = Math.round((entry.total / Math.max(entry.count, 1)) * 100) / 100;
    const previousMonthSpending = Math.round((previousSpending[category] || averageSpending) * 100) / 100;
    const suggestedAmount = Math.round((averageSpending + previousMonthSpending * 0.1) * 100) / 100;
    return {
      category,
      averageSpending,
      previousMonthSpending,
      suggestedAmount,
      modifiedAmount: suggestedAmount,
      status: 'accepted',
    };
  });
}

export function calculateTotalBudget(
  suggestions: CategoryBudgetSuggestion[],
): number {
  return suggestions.reduce((sum, suggestion) => {
    const amount = suggestion.modifiedAmount ?? suggestion.suggestedAmount;
    return sum + amount;
  }, 0);
}

export function calculateConfidenceScore(
  transactions: Transaction[],
  baseline: Record<string, number>,
): number {
  const categories = Object.keys(baseline).length;
  const months = new Set(transactions.map((t) => `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`)).size;
  const dataScore = Math.min(months / 3, 1) * 40;
  const categoryScore = Math.min(categories / 10, 1) * 35;
  const volumeScore = Math.min(transactions.length / 60, 1) * 25;
  return Math.round(dataScore + categoryScore + volumeScore);
}

export async function fetchBudgetFromFirestore(
  userId: string,
  month: string,
): Promise<BudgetPlan | null> {
  try {
    const ref = doc(db, 'budgets', `${userId}_${month}`);
    const snap = await getDocs(query(collection(db, 'budgets'), where('userId','==',userId), where('month','==',month)));
    if (!snap.empty) {
      const data = snap.docs[0].data() as any;
      return {
        userId: data.userId || userId,
        month: data.month || month,
        totalBudget: data.totalBudget || 0,
        categoryBudgets: data.categoryBudgets || {},
        confidenceScore: data.confidenceScore || 0,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'budgets');
    return null;
  }
}

export async function saveBudgetToFirestore(
  budgetData: BudgetPlan,
): Promise<void> {
  try {
    const ref = doc(db, 'budgets', `${budgetData.userId}_${budgetData.month}`);
    await setDoc(ref, {
      ...budgetData,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'budgets');
    throw error;
  }
}

export function generateBudgetComparison(
  suggestions: CategoryBudgetSuggestion[],
  previousSpending: Record<string, number>,
): BudgetComparison[] {
  return suggestions.map((suggestion) => {
    const suggested = suggestion.modifiedAmount ?? suggestion.suggestedAmount;
    const previous = previousSpending[suggestion.category] || 0;
    return {
      category: suggestion.category,
      previous,
      suggested,
      difference: Math.round((suggested - previous) * 100) / 100,
    };
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export async function fetchBudgetCategories(userId: string): Promise<BudgetCategory[]> {
  try {
    const ref = collection(db, 'budget_categories');
    const q = query(ref, where('userId', '==', userId), orderBy('name', 'asc'));
    const snapshot = await getDocs(q);
    const categories: BudgetCategory[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      categories.push({
        id: docSnap.id,
        userId: data.userId || '',
        name: data.name || '',
        monthlyLimit: data.monthlyLimit || 0,
        rolloverEnabled: data.rolloverEnabled || false,
        rolloverPercentage: data.rolloverPercentage || 100,
        rolledOverAmount: data.rolledOverAmount || 0,
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
      });
    });
    return categories;
  } catch (error) {
    console.error('Error fetching budget categories:', error);
    handleFirestoreError(error, OperationType.LIST, 'budget_categories');
    return [];
  }
}

export async function createBudgetCategory(
  userId: string,
  input: BudgetCategoryInput
): Promise<BudgetCategory | null> {
  try {
    const id = doc(collection(db, 'budget_categories')).id;
    const now = new Date().toISOString();
    const category: Omit<BudgetCategory, 'id'> = {
      userId,
      name: input.name.trim(),
      monthlyLimit: input.monthlyLimit,
      rolloverEnabled: input.rolloverEnabled ?? false,
      rolloverPercentage: input.rolloverPercentage ?? 100,
      rolledOverAmount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'budget_categories', id), {
      ...category,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { ...category, id };
  } catch (error) {
    console.error('Error creating budget category:', error);
    handleFirestoreError(error, OperationType.CREATE, 'budget_categories');
    return null;
  }
}

export async function updateBudgetCategory(
  id: string,
  updates: Partial<Omit<BudgetCategory, 'id' | 'userId' | 'name' | 'createdAt'>>
): Promise<boolean> {
  try {
    const ref = doc(db, 'budget_categories', id);
    await updateDoc(ref, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error('Error updating budget category:', error);
    handleFirestoreError(error, OperationType.UPDATE, `budget_categories/${id}`);
    return false;
  }
}

export async function deleteBudgetCategory(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'budget_categories', id));
    return true;
  } catch (error) {
    console.error('Error deleting budget category:', error);
    handleFirestoreError(error, OperationType.DELETE, `budget_categories/${id}`);
    return false;
  }
}

export async function fetchRolloverHistory(userId: string): Promise<RolloverEntry[]> {
  try {
    const ref = collection(db, 'budget_rollovers');
    const q = query(ref, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const entries: RolloverEntry[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      entries.push({
        id: docSnap.id,
        userId: data.userId || '',
        fromMonth: data.fromMonth || '',
        toMonth: data.toMonth || '',
        category: data.category || '',
        amount: data.amount || 0,
        percentage: data.percentage || 0,
        createdAt: data.createdAt || '',
      });
    });
    return entries;
  } catch (error) {
    console.error('Error fetching rollover history:', error);
    handleFirestoreError(error, OperationType.LIST, 'budget_rollovers');
    return [];
  }
}

export async function createRolloverEntry(
  userId: string,
  fromMonth: string,
  toMonth: string,
  category: string,
  amount: number,
  percentage: number
): Promise<RolloverEntry | null> {
  try {
    const id = doc(collection(db, 'budget_rollovers')).id;
    const entry: Omit<RolloverEntry, 'id'> = {
      userId,
      fromMonth,
      toMonth,
      category,
      amount,
      percentage,
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'budget_rollovers', id), {
      ...entry,
      createdAt: serverTimestamp(),
    });
    return { ...entry, id };
  } catch (error) {
    console.error('Error creating rollover entry:', error);
    handleFirestoreError(error, OperationType.CREATE, 'budget_rollovers');
    return null;
  }
}

export async function resetAllRollovers(userId: string): Promise<boolean> {
  try {
    const batch = writeBatch(db);
    const ref = collection(db, 'budget_categories');
    const q = query(ref, where('userId', '==', userId));
    const snapshot = await getDocs(q);
    snapshot.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        rolledOverAmount: 0,
        rolloverEnabled: false,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    return true;
  } catch (error) {
    console.error('Error resetting rollovers:', error);
    handleFirestoreError(error, OperationType.WRITE, 'budget_categories');
    return false;
  }
}

export async function resetCategoryRollover(userId: string, categoryId: string): Promise<boolean> {
  try {
    const ref = doc(db, 'budget_categories', categoryId);
    await updateDoc(ref, {
      rolledOverAmount: 0,
      rolloverEnabled: false,
      rolloverPercentage: 100,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error('Error resetting category rollover:', error);
    handleFirestoreError(error, OperationType.UPDATE, `budget_categories/${categoryId}`);
    return false;
  }
}

export function calculateRolloverAmount(unusedBudget: number, percentage: number): number {
  if (unusedBudget <= 0) return 0;
  return Math.round(unusedBudget * (percentage / 100) * 100) / 100;
}

export function getRolloverStats(entries: RolloverEntry[], category?: string) {
  const filtered = category ? entries.filter((e) => e.category === category) : entries;
  const totalRolledOver = filtered.reduce((sum, e) => sum + e.amount, 0);
  const count = filtered.length;
  return { totalRolledOver, count };
}

export function initializeDefaultCategories(userId: string): BudgetCategory[] {
  const now = new Date().toISOString();
  return DEFAULT_CATEGORIES.map((name) => ({
    id: `${userId}_${name.replace(/\s+/g, '_').toLowerCase()}`,
    userId,
    name,
    monthlyLimit: 0,
    rolloverEnabled: false,
    rolloverPercentage: 100,
    rolledOverAmount: 0,
    createdAt: now,
    updatedAt: now,
  }));
}
