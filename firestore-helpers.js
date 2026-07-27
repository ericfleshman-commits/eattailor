/*
 * FIRESTORE HELPERS
 *
 * These functions replace localStorage with Firestore operations
 * All data is stored under users/{userId}/ structure
 */

/* Debug mode - set to false for production */
const DEBUG_MODE = false;
const debugLog = (...args) => { if (DEBUG_MODE) debugLog(...args); };
const debugError = (...args) => { if (DEBUG_MODE) debugError(...args); };

import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// ============================================
// DATE UTILITIES
// ============================================

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================
// MESSAGES
// ============================================

export async function saveMessagesToFirestore(db, userId, messages) {
  try {
    const messagesRef = doc(db, 'users', userId, 'data', 'messages');
    await setDoc(messagesRef, {
      messages: messages,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Messages saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving messages:', error);
  }
}

export async function loadMessagesFromFirestore(db, userId) {
  try {
    const messagesRef = doc(db, 'users', userId, 'data', 'messages');
    const docSnap = await getDoc(messagesRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      debugLog('✅ Messages loaded from Firestore');
      return data.messages || [];
    } else {
      debugLog('ℹ️ No messages found, starting fresh');
      return [];
    }
  } catch (error) {
    debugError('❌ Error loading messages:', error);
    return [];
  }
}

// ============================================
// CURRENT MACROS
// ============================================

export async function saveMacrosToFirestore(db, userId, macros) {
  try {
    const macrosRef = doc(db, 'users', userId, 'data', 'currentMacros');
    await setDoc(macrosRef, {
      ...macros,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Macros saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving macros:', error);
  }
}

export async function loadMacrosFromFirestore(db, userId) {
  try {
    const macrosRef = doc(db, 'users', userId, 'data', 'currentMacros');
    const docSnap = await getDoc(macrosRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      debugLog('✅ Macros loaded from Firestore');
      return {
        calories: data.calories || 0,
        protein: data.protein || 0,
        carbs: data.carbs || 0,
        fat: data.fat || 0,
        date: data.date || ''
      };
    } else {
      debugLog('ℹ️ No macros found, starting at 0');
      return { calories: 0, protein: 0, carbs: 0, fat: 0, date: '' };
    }
  } catch (error) {
    debugError('❌ Error loading macros:', error);
    return { calories: 0, protein: 0, carbs: 0, fat: 0, date: '' };
  }
}

// ============================================
// ACTIVITY TRACKER DATA
// ============================================

export async function saveActivityDataToFirestore(db, userId, activityData) {
  try {
    const activityRef = doc(db, 'users', userId, 'data', 'activityData');
    await setDoc(activityRef, {
      ...activityData,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Activity data saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving activity data:', error);
  }
}

export async function loadActivityDataFromFirestore(db, userId) {
  try {
    const activityRef = doc(db, 'users', userId, 'data', 'activityData');
    const docSnap = await getDoc(activityRef);

    if (docSnap.exists()) {
      debugLog('✅ Activity data loaded from Firestore');
      return docSnap.data();
    } else {
      debugLog('ℹ️ No activity data found');
      return null;
    }
  } catch (error) {
    debugError('❌ Error loading activity data:', error);
    return null;
  }
}

// ============================================
// DAILY TOTALS
// ============================================

export async function saveDailyTotalsToFirestore(db, userId, dailyTotals) {
  try {
    debugLog('💾 [SAVE DAILY TOTALS] ========== SAVING TO FIRESTORE ==========');
    debugLog('💾 [SAVE DAILY TOTALS] dailyTotals object:', JSON.stringify(dailyTotals, null, 2));
    debugLog('💾 [SAVE DAILY TOTALS] Keys:', Object.keys(dailyTotals));

    // Log each day's data
    Object.keys(dailyTotals).forEach(dateKey => {
      const dayData = dailyTotals[dateKey];
      debugLog(`💾 [SAVE DAILY TOTALS] ${dateKey}:`, {
        calories: dayData.calories,
        mealCount: dayData.meals?.length || 0,
        meals: dayData.meals
      });
    });

    const totalsRef = doc(db, 'users', userId, 'data', 'dailyTotals');
    await setDoc(totalsRef, {
      totals: dailyTotals,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Daily totals saved to Firestore successfully');
  } catch (error) {
    debugError('❌ Error saving daily totals:', error);
  }
}

export async function loadDailyTotalsFromFirestore(db, userId) {
  try {
    const totalsRef = doc(db, 'users', userId, 'data', 'dailyTotals');
    const docSnap = await getDoc(totalsRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      debugLog('✅ Daily totals loaded from Firestore');
      return data.totals || {};
    } else {
      debugLog('ℹ️ No daily totals found, starting fresh');
      return {};
    }
  } catch (error) {
    debugError('❌ Error loading daily totals:', error);
    return {};
  }
}

// ============================================
// WEEKLY DATA
// ============================================

export async function saveWeeklyDataToFirestore(db, userId, weeklyData) {
  try {
    const weeklyRef = doc(db, 'users', userId, 'data', 'weeklyData');
    await setDoc(weeklyRef, {
      data: weeklyData,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Weekly data saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving weekly data:', error);
  }
}

export async function loadWeeklyDataFromFirestore(db, userId) {
  try {
    const weeklyRef = doc(db, 'users', userId, 'data', 'weeklyData');
    const docSnap = await getDoc(weeklyRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      debugLog('✅ Weekly data loaded from Firestore');
      return data.data || {};
    } else {
      debugLog('ℹ️ No weekly data found, starting fresh');
      return {};
    }
  } catch (error) {
    debugError('❌ Error loading weekly data:', error);
    return {};
  }
}

// ============================================
// SIDEBAR STATE
// ============================================

export async function saveSidebarStateToFirestore(db, userId, state) {
  try {
    const sidebarRef = doc(db, 'users', userId, 'data', 'sidebarState');
    await setDoc(sidebarRef, {
      ...state,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Sidebar state saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving sidebar state:', error);
  }
}

export async function loadSidebarStateFromFirestore(db, userId) {
  try {
    const sidebarRef = doc(db, 'users', userId, 'data', 'sidebarState');
    const docSnap = await getDoc(sidebarRef);

    if (docSnap.exists()) {
      debugLog('✅ Sidebar state loaded from Firestore');
      return docSnap.data();
    } else {
      debugLog('ℹ️ No sidebar state found, defaulting to hidden');
      return { isOpen: false };
    }
  } catch (error) {
    debugError('❌ Error loading sidebar state:', error);
    return { isOpen: false };
  }
}

// ============================================
// MEAL HISTORY
// ============================================

export async function saveMealToHistory(db, userId, mealEntry) {
  try {
    const historyRef = doc(db, 'users', userId, 'data', 'mealHistory');
    const docSnap = await getDoc(historyRef);

    let meals = [];
    if (docSnap.exists()) {
      meals = docSnap.data().meals || [];
    }

    // Add new meal to beginning of array
    meals.unshift(mealEntry);

    // Keep only last 50 meals
    if (meals.length > 50) {
      meals = meals.slice(0, 50);
    }

    await setDoc(historyRef, {
      meals: meals,
      updatedAt: new Date().toISOString()
    });

    debugLog('✅ Meal saved to history');
  } catch (error) {
    debugError('❌ Error saving meal to history:', error);
  }
}

export async function loadMealHistory(db, userId, limit = 5) {
  try {
    const historyRef = doc(db, 'users', userId, 'data', 'mealHistory');
    const docSnap = await getDoc(historyRef);

    if (docSnap.exists()) {
      const meals = docSnap.data().meals || [];
      debugLog('✅ Meal history loaded');
      return meals.slice(0, limit); // Return last N meals
    } else {
      debugLog('ℹ️ No meal history found');
      return [];
    }
  } catch (error) {
    debugError('❌ Error loading meal history:', error);
    return [];
  }
}

// ============================================
// SETTINGS
// ============================================

export async function saveSettingsToFirestore(db, userId, settings) {
  try {
    const settingsRef = doc(db, 'users', userId, 'settings', 'userSettings');
    await setDoc(settingsRef, {
      ...settings,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Settings saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving settings:', error);
  }
}

export async function loadSettingsFromFirestore(db, userId) {
  try {
    debugLog('🔍 [FIRESTORE] Loading settings for user:', userId);
    debugLog('🔍 [FIRESTORE] Path: users/' + userId + '/settings/userSettings');
    const settingsRef = doc(db, 'users', userId, 'settings', 'userSettings');
    debugLog('🔍 [FIRESTORE] Document reference created');
    const docSnap = await getDoc(settingsRef);
    debugLog('🔍 [FIRESTORE] Document snapshot retrieved');
    debugLog('🔍 [FIRESTORE] Document exists?', docSnap.exists());

    if (docSnap.exists()) {
      const data = docSnap.data();
      debugLog('✅ Settings loaded from Firestore');
      debugLog('✅ Settings data:', JSON.stringify(data, null, 2));
      return data;
    } else {
      debugLog('⚠️ [FIRESTORE] No settings document found at path');
      debugLog('ℹ️ No settings found, returning defaults');
      return {
        profile: {},
        macroGoals: {
          calories: 2000,
          protein: 150,
          carbs: 225,
          fat: 65
        },
        aiPreferences: {
          dietaryInfo: ''
        }
      };
    }
  } catch (error) {
    debugError('❌ Error loading settings:', error);
    debugError('❌ Error details:', error.message);
    debugError('❌ Error stack:', error.stack);
    return {
      profile: {},
      macroGoals: {
        calories: 2000,
        protein: 150,
        carbs: 225,
        fat: 65
      },
      aiPreferences: {
        dietaryInfo: ''
      }
    };
  }
}

// ============================================
// STREAK TRACKING
// ============================================

export async function saveStreakData(db, userId, streakData) {
  try {
    const streakRef = doc(db, 'users', userId, 'stats', 'streak');
    await setDoc(streakRef, {
      ...streakData,
      updatedAt: new Date().toISOString()
    });
    debugLog('✅ Streak data saved to Firestore');
  } catch (error) {
    debugError('❌ Error saving streak data:', error);
  }
}

export async function loadStreakData(db, userId) {
  try {
    const streakRef = doc(db, 'users', userId, 'stats', 'streak');
    const docSnap = await getDoc(streakRef);

    if (docSnap.exists()) {
      debugLog('✅ Streak data loaded from Firestore');
      return docSnap.data();
    } else {
      debugLog('ℹ️ No streak data found, returning defaults');
      return {
        streak: 0,
        lastWorkoutDate: null,
        weeklyWorkouts: 0
      };
    }
  } catch (error) {
    debugError('❌ Error loading streak data:', error);
    return {
      streak: 0,
      lastWorkoutDate: null,
      weeklyWorkouts: 0
    };
  }
}
