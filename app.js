/* Simple Nutrition Chat with OpenAI API */

/* Debug mode - set to true to enable verbose logging */
const DEBUG_MODE = false;
const debugLog = (...args) => { if (DEBUG_MODE) console.log(...args); };
const debugError = (...args) => { if (DEBUG_MODE) console.error(...args); };

debugLog('🔥 APP.JS IS LOADING!!!');

/* API key is now stored securely on the server - see .env file */

const OPENAI_MODEL = "gpt-4o-mini";

// Import Firestore helpers
import {
  saveMessagesToFirestore,
  loadMessagesFromFirestore,
  saveMacrosToFirestore,
  loadMacrosFromFirestore,
  saveActivityDataToFirestore,
  loadActivityDataFromFirestore,
  saveDailyTotalsToFirestore,
  loadDailyTotalsFromFirestore,
  saveWeeklyDataToFirestore,
  loadWeeklyDataFromFirestore,
  saveSidebarStateToFirestore,
  loadSidebarStateFromFirestore,
  saveMealToHistory,
  loadMealHistory,
  loadSettingsFromFirestore,
  saveSettingsToFirestore,
  saveStreakData,
  loadStreakData,
  getLocalDateString
} from './firestore-helpers.js';

// Import settings module
import { initSettingsModal, loadAIPreferences } from './settings.js';

// Import onboarding module
import { checkFirstTimeUser, showOnboarding, initOnboarding } from './onboarding.js';

// Mock data module removed - using real Strava data only

// This will be set when Firebase is ready
let db, currentUser;

// Expose a function that index.html will call when Firebase is ready
window.startEatTailorApp = function() {
  debugLog('🚀 startEatTailorApp() called!');
  debugLog('🔍 Checking Firebase instances...');
  debugLog('window.firebaseDb:', window.firebaseDb);
  debugLog('window.currentUser:', window.currentUser);
  debugLog('window.firebaseAuth:', window.firebaseAuth);

  if (!window.firebaseDb || !window.currentUser) {
    debugError('❌ Firebase not ready!');
    debugError('window.firebaseDb:', window.firebaseDb);
    debugError('window.currentUser:', window.currentUser);
    throw new Error('Firebase instances not available');
  }

  db = window.firebaseDb;
  currentUser = window.currentUser;

  debugLog('✅ Firebase instances loaded:', { userId: currentUser.uid, email: currentUser.email });

  // Initialize the app
  initializeApp();
};

async function initializeApp() {
  debugLog('🎯 Initializing EatTailor app...');

  // Check if user is first-time (no settings saved)
  debugLog('🔍 Checking if user is first-time...');
  const isFirstTime = await checkFirstTimeUser(db, currentUser);
  debugLog('🔍 Is first time?', isFirstTime);

  if (isFirstTime) {
    debugLog('👋 First-time user detected, showing onboarding...');
    showOnboarding();
    initOnboarding(db, currentUser);
  } else {
    debugLog('👤 Existing user (has onboardingCompleted flag), loading app normally...');
    // Load the main app
    initApp().catch(error => {
      debugError('❌ Error initializing app:', error);
    });
  }
}


// DOM
const form = document.getElementById("form");
const input = document.getElementById("message");
const list = document.getElementById("messages");
const clearBtn = document.getElementById("clearBtn");
const activitySteps = document.getElementById("activitySteps");
const activityCalories = document.getElementById("activityCalories");
const activeMinutes = document.getElementById("activeMinutes");
const weeklyConsumed = document.getElementById("weeklyConsumed");
const weeklyBurned = document.getElementById("weeklyBurned");
const viewWeeklyBtn = document.getElementById("viewWeeklyBtn");
const weeklyModal = document.getElementById("weeklyModal");
const closeModalBtn = document.getElementById("closeModal");
const weeklyContent = document.getElementById("weeklyContent");

// State
let messages = [];
let activityData = null;
let weeklyData = {};
let dailyTotals = {};
let currentMacros = { calories: 0, protein: 0, carbs: 0, fat: 0, date: '' };
let lastUserMessage = ''; // Track last user message for meal history
let streakData = { streak: 0, lastWorkoutDate: null, weeklyWorkouts: 0 };

// Expose state globally for debugging
window.DEBUG = {
  messages: () => messages,
  activityData: () => activityData,
  weeklyData: () => weeklyData,
  dailyTotals: () => dailyTotals,
  currentMacros: () => currentMacros,
  streakData: () => streakData,
  // Helper to check Firestore directly
  checkFirestore: async () => {
    const userId = currentUser.uid;
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
    const docRef = doc(db, 'users', userId, 'data', 'dailyTotals');
    const docSnap = await getDoc(docRef);
    debugLog('🔥 Firestore dailyTotals exists:', docSnap.exists());
    debugLog('🔥 Firestore dailyTotals data:', docSnap.data());
    return docSnap.data();
  },
  // Helper to manually clean weeklyData
  cleanWeeklyData: async () => {
    debugLog('🗑️ Manual cleanup of weeklyData...');
    const oldKeys = Object.keys(weeklyData).filter(key => !/^\d{4}-\d{2}-\d{2}$/.test(key));
    debugLog('🗑️ Old format keys to delete:', oldKeys);
    oldKeys.forEach(key => delete weeklyData[key]);
    await saveWeeklyData();
    debugLog('✅ Cleanup complete. Current keys:', Object.keys(weeklyData));
    return weeklyData;
  }
};

debugLog('✅ DEBUG object exposed. Use window.DEBUG.dailyTotals() to inspect state');

/* =========================
   Utils
========================= */

function escapeHTML(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseMarkdown(str) {
  // Strip all markdown formatting and escape HTML
  let result = str;

  // Remove all markdown formatting
  result = result.replace(/\*\*/g, ''); // Remove bold **text**
  result = result.replace(/\*/g, '');   // Remove italic *text*
  result = result.replace(/\_\_/g, ''); // Remove bold __text__
  result = result.replace(/\_/g, '');   // Remove italic _text_
  result = result.replace(/\~/g, '');   // Remove strikethrough ~~text~~
  result = result.replace(/\`/g, '');   // Remove code `text`
  result = result.replace(/^###?\s+/gm, ''); // Remove headers

  // Escape HTML to prevent XSS
  result = escapeHTML(result);

  // Line breaks
  result = result.replace(/\n/g, '<br>');

  return result;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr) {
  // Parse YYYY-MM-DD locally to avoid UTC midnight shifting
  const [year, month, day] = dateStr.split('-');
  const d = new Date(year, month - 1, day);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function getTodayKey() {
  return getLocalDateString(new Date());
}

async function loadMessages() {
  messages = await loadMessagesFromFirestore(db, currentUser.uid);
}

async function saveMessages() {
  await saveMessagesToFirestore(db, currentUser.uid, messages);
}

function autogrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 150) + "px";
}

function scrollToBottom() {
  if (!list) return;

  // Scroll to the actual bottom (scrollHeight - clientHeight)
  const scrollToValue = list.scrollHeight - list.clientHeight;

  // AGGRESSIVE: Immediate scroll - no smooth behavior
  list.scrollTop = scrollToValue;

  // Multiple delayed scrolls to catch rendering lag
  setTimeout(() => {
    list.scrollTop = list.scrollHeight - list.clientHeight;
  }, 50);

  setTimeout(() => {
    list.scrollTop = list.scrollHeight - list.clientHeight;
  }, 100);

  setTimeout(() => {
    list.scrollTop = list.scrollHeight - list.clientHeight;
  }, 200);

  setTimeout(() => {
    list.scrollTop = list.scrollHeight - list.clientHeight;
  }, 400);
}

function showTypingIndicator() {
  const indicator = document.createElement("li");
  indicator.className = "typing-indicator";
  indicator.id = "typing-indicator";
  indicator.innerHTML = `
    <span class="typing-indicator__text">AI is typing</span>
    <div class="typing-indicator__dots">
      <div class="typing-indicator__dot"></div>
      <div class="typing-indicator__dot"></div>
      <div class="typing-indicator__dot"></div>
    </div>
  `;
  list.appendChild(indicator);
  scrollToBottom();
}

function hideTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) {
    indicator.remove();
  }
}

/* =========================
   Streak Tracking
========================= */


async function calculateAndUpdateStreak() {
  debugLog('🔥 ========== CALCULATING STREAK ==========');

  // Use LOCAL timezone, not UTC
  const now = new Date();
  const today = getLocalDateString(now);
  const timezoneOffset = now.getTimezoneOffset();

  debugLog('🔥 Current date/time info:');
  debugLog(`  - Browser time: ${now.toString()}`);
  debugLog(`  - Timezone offset: ${timezoneOffset} minutes (UTC${timezoneOffset > 0 ? '-' : '+'}${Math.abs(timezoneOffset / 60)})`);
  debugLog(`  - Today (local): ${today}`);

  const hasWorkoutToday = activityData && activityData.caloriesBurned > 0;
  debugLog(`  - Has workout today: ${hasWorkoutToday}`);
  debugLog(`  - Activity calories: ${activityData?.caloriesBurned || 0}`);

  debugLog('🔥 Current streak data from Firestore:');
  debugLog(`  - Streak: ${streakData.streak || 0}`);
  debugLog(`  - Last workout date: ${streakData.lastWorkoutDate || 'never'}`);

  // Calculate yesterday's date in local timezone
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getLocalDateString(yesterdayDate);

  // If no workout today, check if streak should be broken
  if (!hasWorkoutToday) {
    // If we have a streak and last workout wasn't yesterday, the streak is broken
    if (streakData.streak > 0 && streakData.lastWorkoutDate && streakData.lastWorkoutDate < yesterday) {
      debugLog('🔥 💔 STREAK BROKEN! Last workout was before yesterday, resetting to 0');
      const brokenStreak = {
        streak: 0,
        lastWorkoutDate: streakData.lastWorkoutDate,
        weeklyWorkouts: 0
      };
      await saveStreakData(db, currentUser.uid, brokenStreak);
      streakData = brokenStreak;
      debugLog('🔥 ========================================');
      return brokenStreak;
    }
    debugLog('🔥 ❌ No workout today, but streak still intact (within grace period)');
    debugLog('🔥 ========================================');
    return streakData;
  }

  // If already counted today's workout, don't update
  if (streakData.lastWorkoutDate === today) {
    debugLog('🔥 ✅ Already counted today\'s workout, no change needed');
    debugLog('🔥 ========================================');
    return streakData;
  }

  debugLog('🔥 Comparing dates:');
  debugLog(`  - Today: ${today}`);
  debugLog(`  - Yesterday: ${yesterday}`);
  debugLog(`  - Last workout: ${streakData.lastWorkoutDate || 'never'}`);

  let newStreak = 1;

  if (streakData.lastWorkoutDate === yesterday) {
    // Continue streak - workout yesterday AND workout today
    newStreak = (streakData.streak || 0) + 1;
    debugLog(`🔥 ✅ CONTINUING STREAK! (${streakData.streak} → ${newStreak})`);
  } else if (!streakData.lastWorkoutDate || streakData.lastWorkoutDate < yesterday) {
    // Streak broken - last workout was before yesterday
    newStreak = 1;
    debugLog(`🔥 🔄 STREAK RESET (last workout was ${streakData.lastWorkoutDate || 'never'})`);
  } else {
    // Shouldn't happen, but handle edge case
    newStreak = 1;
    debugLog(`🔥 ⚠️ EDGE CASE - resetting streak to 1`);
  }

  const updatedStreak = {
    streak: newStreak,
    lastWorkoutDate: today,
    weeklyWorkouts: 0 // Will be calculated separately in renderWeeklyTotals
  };

  debugLog('🔥 Updated streak data:');
  debugLog(`  - New streak: ${newStreak}`);
  debugLog(`  - Last workout date: ${today}`);

  // Save to Firestore
  debugLog('🔥 Saving to Firestore...');
  await saveStreakData(db, currentUser.uid, updatedStreak);
  streakData = updatedStreak;

  debugLog('🔥 ✅ Streak calculation complete');
  debugLog('🔥 ========================================');

  return updatedStreak;
}

/* =========================
   Activity Tracker Data
========================= */

async function loadActivityData() {
  debugLog('📊 loadActivityData() called');

  try {
    // Fetch Strava data
    debugLog('📥 Importing strava-integration.js...');
    const { isStravaConnected, fetchStravaActivities } = await import('./strava-integration.js');

    debugLog('🔍 Checking if Strava is connected...');
    const connected = await isStravaConnected(db, currentUser.uid);
    debugLog('🔍 Strava connected:', connected);

    if (!connected) {
      debugLog('❌ Strava not connected, no activity data available');
      activityData = null;
      return;
    }

    debugLog('🚴 Strava connected, fetching activities...');
    const stravaData = await fetchStravaActivities(db, currentUser.uid);
    debugLog('📦 Strava data returned:', stravaData);

    if (stravaData && stravaData.activities && stravaData.activities.length > 0) {
      const today = getLocalDateString(new Date());
      debugLog('📅 [CLIENT] Today (client local):', today);
      debugLog(`📅 [CLIENT] Processing ${stravaData.activities.length} activities from last 7 days`);

      // Group activities by date for weeklyData
      const activitiesByDate = {};
      stravaData.activities.forEach(activity => {
        const activityDate = getLocalDateString(new Date(activity.startDate));
        if (!activitiesByDate[activityDate]) {
          activitiesByDate[activityDate] = [];
        }
        activitiesByDate[activityDate].push(activity);
      });

      debugLog('📅 [CLIENT] Activities grouped by date:', Object.keys(activitiesByDate));

      // Store each day's activities in weeklyData
      for (const [dateKey, activities] of Object.entries(activitiesByDate)) {
        const totalCalories = activities.reduce((sum, a) => sum + (a.calories || 0), 0);
        const totalMinutes = Math.round(activities.reduce((sum, a) => sum + (a.movingTime / 60), 0));

        weeklyData[dateKey] = {
          caloriesBurned: totalCalories,
          steps: 0,
          activeMinutes: totalMinutes,
          date: dateKey,
          source: 'strava',
          activities: activities
        };
        debugLog(`📅 [CLIENT] Stored ${dateKey}: ${totalCalories} cal, ${activities.length} activities`);
      }

      // Save all weekly data to Firestore
      await saveWeeklyData();

      // Set today's activityData for the sidebar display
      const todaysActivities = activitiesByDate[today] || [];
      if (todaysActivities.length > 0) {
        const totalCalories = todaysActivities.reduce((sum, a) => sum + (a.calories || 0), 0);
        const totalMinutes = Math.round(todaysActivities.reduce((sum, a) => sum + (a.movingTime / 60), 0));

        activityData = {
          caloriesBurned: totalCalories,
          steps: 0,
          activeMinutes: totalMinutes,
          date: today,
          source: 'strava',
          activities: todaysActivities
        };
        debugLog('✅ Today\'s activity data:', activityData);
      } else {
        debugLog('⚠️ No activities from today (rest day)');
        activityData = {
          caloriesBurned: 0,
          steps: 0,
          activeMinutes: 0,
          date: today,
          source: 'strava',
          activities: []
        };
      }
      return;
    }

    if (stravaData) {
      debugLog('⚠️ Strava connected but no workouts in last 7 days');
      activityData = {
        caloriesBurned: 0,
        steps: 0,
        activeMinutes: 0,
        date: getLocalDateString(new Date()),
        source: 'strava',
        activities: []
      };
    } else {
      debugLog('⚠️ Strava data is null');
      activityData = null;
    }
  } catch (error) {
    debugError('❌ Error loading activity data:', error);
    debugError('❌ Error stack:', error.stack);
    activityData = null;
  }
}

function getActivitySummary() {
  if (!activityData) {
    return "Today's Activity Stats:\n- No activity data yet. Log a workout in chat or connect a tracker.";
  }
  const steps = typeof activityData.steps === "number" ? activityData.steps.toLocaleString() : "0";
  return `Today's Activity Stats:\n- Steps: ${steps}\n- Calories Burned: ${activityData.caloriesBurned || 0}\n- Active Minutes: ${activityData.activeMinutes || 0}`;
}

async function renderActivityStats() {
  const activityContent = document.getElementById('activityContent');
  const activityStreak = document.getElementById('activityStreak');
  const activitySource = document.getElementById('activitySource');

  if (!activityContent) return;

  // Check if Strava is connected. Best-effort: never throw upward, since a lapsed or
  // inactive Strava app must not break unrelated UI or look like a connection failure.
  let connected = false;
  try {
    const { isStravaConnected } = await import('./strava-integration.js');
    connected = await isStravaConnected(db, currentUser.uid);
  } catch (stravaErr) {
    console.warn('Strava availability check failed; treating as disconnected:', stravaErr);
  }

  // Show/hide Refresh Strava button
  const refreshStravaBtn = document.getElementById('refreshStravaBtn');
  if (refreshStravaBtn) {
    refreshStravaBtn.style.display = connected ? 'flex' : 'none';
  }

  // Hide streak display from Today's Activity card
  if (activityStreak) {
    activityStreak.textContent = '';
  }

  // STATE 1: Not connected to Strava
  if (!connected) {
    activityContent.innerHTML = `
      <div class="activity-connect">
        <div class="activity-connect__message">Not connected</div>
        <button class="activity-connect__button" id="connectStravaBtn">Connect Strava</button>
      </div>
    `;
    activitySource.textContent = 'Connect Strava to track workouts';

    // Add click handler
    document.getElementById('connectStravaBtn').addEventListener('click', () => {
      // Open settings modal to Integrations tab
      document.getElementById('settingsBtn').click();
    });
    return;
  }

  // STATE 2: Rest day (no workout today)
  if (!activityData || activityData.caloriesBurned === 0) {
    activityContent.innerHTML = `
      <div class="activity-rest">
        <div class="activity-rest__title">Rest Day</div>
        <div class="activity-rest__message">Keep your streak going tomorrow!</div>
      </div>
    `;
    activitySource.textContent = 'Source: Strava';
    return;
  }

  // STATE 3: Workout day
  // Build HTML for all activities
  let activitiesHTML = '';

  if (activityData.activities && activityData.activities.length > 0) {
    // Show list of all activities
    activitiesHTML = `
      <div class="activity-stat">
        <span class="activity-stat__label">Total Calories:</span>
        <span class="activity-stat__value">${activityData.caloriesBurned} cal</span>
      </div>
      <div class="activity-list">
        ${activityData.activities.map(activity => {
          const distance = activity.distance ? (activity.distance / 1609.34).toFixed(1) : '0.0';
          const duration = activity.movingTime ? Math.round(activity.movingTime / 60) : 0;
          return `
            <div class="activity-item">
              <div class="activity-item__name">${activity.name}</div>
              <div class="activity-item__stats">
                ${activity.calories} cal • ${distance} mi • ${duration} min
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    // Fallback to old format if no activities array
    const distance = activityData.distance || '0.0';
    activitiesHTML = `
      <div class="activity-stat">
        <span class="activity-stat__label">Calories Burned:</span>
        <span class="activity-stat__value">${activityData.caloriesBurned} cal</span>
      </div>
      <div class="activity-stat">
        <span class="activity-stat__label">Distance:</span>
        <span class="activity-stat__value">${distance} mi</span>
      </div>
      <div class="activity-stat">
        <span class="activity-stat__label">Duration:</span>
        <span class="activity-stat__value">${activityData.activeMinutes} min</span>
      </div>
    `;
  }

  activityContent.innerHTML = activitiesHTML;
  activitySource.textContent = `Source: ${activityData.source === 'strava' ? 'Strava' : 'Activity Tracker'}`;
}

// Display user info in sidebar footer
async function displayUserInfo() {
  const sidebarUserName = document.getElementById('sidebarUserName');

  if (!sidebarUserName) {
    console.warn('⚠️ Sidebar user name element not found');
    return;
  }

  try {
    // Load user settings to get their name
    const settings = await loadSettingsFromFirestore(db, currentUser.uid);

    // Display name if available, otherwise email
    const displayName = settings.profile?.name || currentUser.email || 'User';
    sidebarUserName.textContent = displayName;

    debugLog('✅ User info displayed:', displayName);
  } catch (error) {
    debugError('❌ Error loading user info:', error);
    // Fallback to email
    sidebarUserName.textContent = currentUser.email || 'User';
  }
}

/* =========================
   Weekly Data Tracking
========================= */

async function loadWeeklyData() {
  try {
    const data = await loadWeeklyDataFromFirestore(db, currentUser.uid);

    debugLog('📅 [LOAD WEEKLY DATA] Cleaning old format entries...');

    // Clean old data (keep only last 7 days AND remove old date format)
    const sevenDaysAgoDate = new Date();
    sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
    const sevenDaysAgo = getLocalDateString(sevenDaysAgoDate);

    const cleaned = {};
    let removedCount = 0;

    for (const [date, value] of Object.entries(data)) {
      // Check if date is in correct format (YYYY-MM-DD)
      const isCorrectFormat = /^\d{4}-\d{2}-\d{2}$/.test(date);

      if (!isCorrectFormat) {
        debugLog('🗑️ [LOAD WEEKLY DATA] Deleting old format key:', date);
        removedCount++;
        continue; // Skip this entry
      }

      // Keep only last 7 days
      if (date >= sevenDaysAgo) {
        cleaned[date] = value;
      }
    }

    // EMERGENCY FIX: Delete bad 2025-11-17 entry if it exists
    if (cleaned['2025-11-17']) {
      debugLog('🗑️ [EMERGENCY] Found bad 2025-11-17 entry, deleting...');
      delete cleaned['2025-11-17'];
      removedCount++;
    }

    weeklyData = cleaned;

    if (removedCount > 0) {
      debugLog(`🗑️ [LOAD WEEKLY DATA] Removed ${removedCount} old/bad entries`);
      debugLog('💾 [LOAD WEEKLY DATA] Saving cleaned data back to Firestore...');
      await saveWeeklyData(); // Save cleaned data back to Firestore
    }

    debugLog('📅 [LOAD WEEKLY DATA] Final weeklyData keys:', Object.keys(weeklyData));
  } catch (error) {
    debugError('❌ [LOAD WEEKLY DATA] Error:', error);
    weeklyData = {};
  }
}

async function saveWeeklyData() {
  await saveWeeklyDataToFirestore(db, currentUser.uid, weeklyData);
}

async function saveToWeeklyData(activityDataForDay) {
  // ALWAYS use YYYY-MM-DD format as the key for consistency
  const dateKey = activityDataForDay.date; // Should already be in YYYY-MM-DD format
  debugLog(`💾 Saving activity data to weeklyData with key: ${dateKey}`);
  weeklyData[dateKey] = activityDataForDay;
  await saveWeeklyData();
}

async function loadDailyTotals() {
  try {
    const data = await loadDailyTotalsFromFirestore(db, currentUser.uid);
    debugLog('📥 [LOAD DAILY TOTALS] Loaded from Firestore:', data);
    debugLog('📥 [LOAD DAILY TOTALS] Keys:', Object.keys(data));

    // Clean old data (keep only last 7 days) and migrate old date format
    const sevenDaysAgoDate = new Date();
    sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
    const sevenDaysAgo = getLocalDateString(sevenDaysAgoDate);

    const cleaned = {};
    let needsMigration = false;

    for (const [dateKey, value] of Object.entries(data)) {
      const parsedDate = new Date(dateKey);

      // Skip invalid dates or dates older than 7 days
      if (isNaN(parsedDate.getTime()) || parsedDate < sevenDaysAgo) {
        debugLog(`📥 [LOAD DAILY TOTALS] ❌ Skipped: "${dateKey}"`);
        continue;
      }

      // Convert old format ("Mon Nov 25 2025") to new format ("2025-11-25")
      const newKey = getLocalDateString(parsedDate);

      if (dateKey !== newKey) {
        debugLog(`📥 [LOAD DAILY TOTALS] 🔄 Migrating: "${dateKey}" -> "${newKey}"`);
        needsMigration = true;
      }

      // Merge if key already exists (in case both formats exist for same day)
      if (cleaned[newKey]) {
        cleaned[newKey].calories += value.calories || 0;
        cleaned[newKey].meals = [...(cleaned[newKey].meals || []), ...(value.meals || [])];
      } else {
        cleaned[newKey] = value;
      }
    }

    dailyTotals = cleaned;
    debugLog('📥 [LOAD DAILY TOTALS] Final dailyTotals:', dailyTotals);

    // Save migrated data back to Firestore if format changed
    if (needsMigration) {
      debugLog('📥 [LOAD DAILY TOTALS] 💾 Saving migrated data...');
      await saveDailyTotals();
    }
  } catch (error) {
    debugError('📥 [LOAD DAILY TOTALS] Error loading:', error);
    dailyTotals = {};
  }
}

async function saveDailyTotals() {
  await saveDailyTotalsToFirestore(db, currentUser.uid, dailyTotals);
}

async function loadCurrentMacros() {
  try {
    const data = await loadMacrosFromFirestore(db, currentUser.uid);

    // Reset if it's a new day
    if (!data.date || data.date !== getTodayKey()) {
      currentMacros = { calories: 0, protein: 0, carbs: 0, fat: 0, date: getTodayKey() };
      return;
    }

    currentMacros = data;
  } catch (error) {
    currentMacros = { calories: 0, protein: 0, carbs: 0, fat: 0, date: getTodayKey() };
  }
}

async function saveCurrentMacros(macros) {
  debugLog('💾 ========== SAVING MACROS TO FIRESTORE ==========');
  debugLog('💾 Input macros:', macros);

  // Validate macros object
  if (!macros || typeof macros !== 'object') {
    debugError('❌ Invalid macros object:', macros);
    return;
  }

  if (macros.calories === undefined || macros.protein === undefined ||
      macros.carbs === undefined || macros.fat === undefined) {
    debugError('❌ Missing required macro properties:', macros);
    return;
  }

  currentMacros = {
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    date: getTodayKey()
  };

  debugLog('💾 Updated currentMacros global variable to:', currentMacros);
  debugLog('💾 Calling saveMacrosToFirestore with userId:', currentUser.uid);

  await saveMacrosToFirestore(db, currentUser.uid, currentMacros);

  debugLog('💾 ✅ Firestore save complete');
  debugLog('💾 ========== SAVE COMPLETE ==========');
}


function getWeeklyTotals() {
  let totalConsumed = 0;
  let totalBurned = 0;

  // Calculate date range: last 7 days including today
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 6); // -6 to include today = 7 days total

  debugLog('📊 [WEEKLY TOTALS] Calculating for last 7 days...');
  debugLog('📊 [WEEKLY TOTALS] Range:', sevenDaysAgo.toDateString(), 'to', today.toDateString());

  // Sum calories consumed (last 7 days only)
  for (const [dateKey, data] of Object.entries(dailyTotals)) {
    const entryDate = new Date(dateKey);
    if (entryDate >= sevenDaysAgo && entryDate <= today) {
      totalConsumed += data.calories || 0;
      debugLog(`📊 [WEEKLY TOTALS] Consumed ${dateKey}: ${data.calories} cal`);
    }
  }

  // Sum calories burned from activity tracker (last 7 days only)
  for (const [dateKey, data] of Object.entries(weeklyData)) {
    const entryDate = new Date(dateKey);
    if (entryDate >= sevenDaysAgo && entryDate <= today) {
      debugLog(`📊 [WEEKLY TOTALS] ${dateKey}: ${data.caloriesBurned} calories (source: ${data.source || 'unknown'})`);
      totalBurned += data.caloriesBurned || 0;
    }
  }

  // Make sure today's activity data is included
  const todayKey = getTodayKey();
  if (activityData && activityData.date === getLocalDateString()) {
    // Check if today is already in weeklyData
    const todayInWeekly = weeklyData[todayKey];
    if (!todayInWeekly) {
      // Today not in weekly yet, add it
      debugLog(`📊 [WEEKLY TOTALS] Adding today's activity data: ${activityData.caloriesBurned} calories`);
      totalBurned += activityData.caloriesBurned || 0;
    } else {
      debugLog(`📊 [WEEKLY TOTALS] Today already in weeklyData`);
    }
  }

  debugLog(`📊 [WEEKLY TOTALS] Final (last 7 days): Consumed ${totalConsumed}, Burned ${totalBurned}`);

  return { consumed: totalConsumed, burned: totalBurned };
}

function renderWeeklyTotals() {
  debugLog('📊 ========== CALCULATING WEEKLY STATS ==========');

  // Calculate workout statistics for last 7 days (using local timezone)
  let workoutCount = 0;
  let totalActiveMinutes = 0;

  const now = new Date();
  const today = getLocalDateString(now);

  // Calculate last 7 days in YYYY-MM-DD format
  const last7Days = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    last7Days.push(getLocalDateString(date));
  }

  debugLog('📊 Date range for "This Week" (last 7 days):');
  debugLog('  - Range:', last7Days[6], 'to', last7Days[0]);
  debugLog('  - All 7 days:', last7Days);
  debugLog('  - Today (local):', today);

  debugLog('📊 All entries in weeklyData:', Object.keys(weeklyData));
  debugLog('📊 Current activityData:', activityData ? {
    date: activityData.date,
    calories: activityData.caloriesBurned,
    minutes: activityData.activeMinutes
  } : 'none');

  // Count workouts from last 7 days
  // weeklyData now uses YYYY-MM-DD format as keys
  for (const [dateKey, data] of Object.entries(weeklyData)) {
    debugLog(`📊 Checking weeklyData entry: ${dateKey}`);
    debugLog(`  - Calories burned: ${data.caloriesBurned}`);
    debugLog(`  - Active minutes: ${data.activeMinutes || 0}`);
    debugLog(`  - Number of activities: ${data.activities?.length || 0}`);
    debugLog(`  - In last 7 days? ${last7Days.includes(dateKey)}`);

    if (last7Days.includes(dateKey) && data.caloriesBurned > 0) {
      // Count individual activities, not just days
      const activitiesCount = data.activities?.length || 1; // Default to 1 if no activities array
      workoutCount += activitiesCount;
      totalActiveMinutes += data.activeMinutes || 0;
      debugLog(`  ✅ COUNTED: ${activitiesCount} workout(s) - Total so far: ${workoutCount}`);
    } else if (!last7Days.includes(dateKey)) {
      debugLog(`  ⏭️ SKIPPED: Outside last 7 days`);
    } else {
      debugLog(`  ⏭️ SKIPPED: No calories burned`);
    }
  }

  // Check if today's activity is already counted (using YYYY-MM-DD format)
  const todayAlreadyCounted = !!weeklyData[today];

  debugLog('📊 Today\'s activity check:');
  debugLog('  - Today (YYYY-MM-DD):', today);
  debugLog('  - Already in weeklyData?', todayAlreadyCounted);
  debugLog('  - Has activityData?', !!activityData);
  debugLog('  - Activity calories:', activityData?.caloriesBurned || 0);

  // Only add today if not already counted in weeklyData
  if (activityData && activityData.caloriesBurned > 0 && !todayAlreadyCounted) {
    const activitiesCount = activityData.activities?.length || 1;
    workoutCount += activitiesCount;
    totalActiveMinutes += activityData.activeMinutes || 0;
    debugLog(`  ✅ ADDED TODAY: ${activitiesCount} workout(s) - ${activityData.activeMinutes || 0} min`);
  } else if (todayAlreadyCounted) {
    debugLog(`  ℹ️ Today already counted in weeklyData`);
  }

  // Calculate average workout duration
  const avgDuration = workoutCount > 0 ? Math.round(totalActiveMinutes / workoutCount) : 0;

  // Format active time as hours and minutes
  const hours = Math.floor(totalActiveMinutes / 60);
  const minutes = totalActiveMinutes % 60;
  const activeTimeText = `${hours}h ${minutes}min`;

  debugLog('📊 ========== FINAL WEEKLY STATS ==========');
  debugLog(`  - Workouts: ${workoutCount}`);
  debugLog(`  - Total active minutes: ${totalActiveMinutes}`);
  debugLog(`  - Average duration: ${avgDuration} min`);
  debugLog('📊 =========================================');

  // Update DOM elements
  const weeklyWorkoutCount = document.getElementById('weeklyWorkoutCount');
  const weeklyActiveTime = document.getElementById('weeklyActiveTime');
  const weeklyAvgDuration = document.getElementById('weeklyAvgDuration');
  const weeklyStreak = document.getElementById('weeklyStreak');

  if (weeklyWorkoutCount) weeklyWorkoutCount.textContent = workoutCount;
  if (weeklyActiveTime) weeklyActiveTime.textContent = activeTimeText;
  if (weeklyAvgDuration) weeklyAvgDuration.textContent = `${avgDuration} min`;

  // Show streak in header if exists
  if (weeklyStreak && streakData && streakData.streak > 0) {
    weeklyStreak.textContent = `🔥 ${streakData.streak} DAY STREAK`;
  } else if (weeklyStreak) {
    weeklyStreak.textContent = '';
  }
}

// Render weekly summary in settings modal
window.renderWeeklySummaryInSettings = function renderWeeklySummaryInSettings() {
  debugLog('🚨🚨🚨 HISTORY FUNCTION CALLED 🚨🚨🚨');
  debugLog('🚨 Function renderWeeklySummaryInSettings() is executing');

  const weeklyContentSettings = document.getElementById('weeklyContentSettings');
  debugLog('🚨 weeklyContentSettings element:', weeklyContentSettings);

  if (!weeklyContentSettings) {
    debugError('❌ weeklyContentSettings element NOT FOUND!');
    return;
  }

  debugLog('📊 [SETTINGS HISTORY] ========== HISTORY TAB OPENED ==========');
  debugLog('📊 [SETTINGS HISTORY] Current time:', new Date().toString());
  debugLog('📊 [SETTINGS HISTORY] dailyTotals has', Object.keys(dailyTotals).length, 'entries');
  debugLog('📊 [SETTINGS HISTORY] Keys in dailyTotals:', Object.keys(dailyTotals));
  debugLog('📊 [SETTINGS HISTORY] Full dailyTotals object:', JSON.stringify(dailyTotals, null, 2));

  // Show what we're looking for vs what exists
  const todayKey = getTodayKey();
  debugLog('📊 [SETTINGS HISTORY] ========== DATE KEY COMPARISON ==========');
  debugLog('📊 [SETTINGS HISTORY] getTodayKey() returns:', `"${todayKey}"`);
  debugLog('📊 [SETTINGS HISTORY] Does dailyTotals have this key?', dailyTotals.hasOwnProperty(todayKey));
  if (dailyTotals.hasOwnProperty(todayKey)) {
    debugLog('📊 [SETTINGS HISTORY] ✅ TODAY\'S DATA EXISTS:', dailyTotals[todayKey]);
  } else {
    debugLog('📊 [SETTINGS HISTORY] ❌ TODAY\'S DATA NOT FOUND');
    debugLog('📊 [SETTINGS HISTORY] Available keys:', Object.keys(dailyTotals));
  }

  // Get last 7 days - TODAY FIRST, then descending
  const days = [];
  for (let i = 0; i <= 6; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = getLocalDateString(date); // YYYY-MM-DD format for both dailyTotals and weeklyData

    debugLog(`📊 [SETTINGS HISTORY] Day ${i}: dateKey="${dateKey}"`);
    debugLog(`📊 [SETTINGS HISTORY] Day ${i}: Found in dailyTotals:`, dailyTotals[dateKey]);
    debugLog(`📊 [SETTINGS HISTORY] Day ${i}: Found in weeklyData:`, weeklyData[dateKey]);

    const activityForDay = weeklyData[dateKey] || null;
    const totalsForDay = dailyTotals[dateKey] || { calories: 0, meals: [] };

    days.push({
      date: dateKey,
      activity: activityForDay,
      totals: totalsForDay
    });
  }

  // Render summary
  let html = '<div class="weekly-summary">';

  days.forEach(day => {
    debugLog(`📊 [SETTINGS HISTORY] ========== Rendering day ${day.date} ==========`);
    debugLog(`📊 [SETTINGS HISTORY] Day data:`, {
      hasActivity: !!day.activity,
      totalCalories: day.totals.calories,
      mealCount: day.totals.meals?.length || 0,
      meals: day.totals.meals
    });

    debugLog(`📊 [SETTINGS HISTORY] Checking conditions:`);
    debugLog(`  - day.totals.calories > 0? ${day.totals.calories > 0} (value: ${day.totals.calories})`);
    debugLog(`  - day.totals.meals exists? ${!!day.totals.meals}`);
    debugLog(`  - day.totals.meals.length? ${day.totals.meals?.length || 0}`);
    debugLog(`  - Will show meals? ${day.totals.calories > 0 && day.totals.meals && day.totals.meals.length > 0}`);

    // Build meals HTML
    let mealsHtml = '';
    if (day.totals.meals && day.totals.meals.length > 0) {
      debugLog(`📊 [SETTINGS HISTORY] Building HTML for ${day.totals.meals.length} meals...`);
      day.totals.meals.forEach((meal, index) => {
        debugLog(`📊 [RENDER MEAL ${index + 1}]`, meal);
        const mealHtml = `<li><span class="meal-time">${meal.time}</span> ${escapeHTML(meal.description)}</li>`;
        debugLog(`📊 [MEAL HTML ${index + 1}]`, mealHtml);
        mealsHtml += mealHtml;
      });
      debugLog(`📊 [ALL MEALS HTML]`, mealsHtml);
    } else {
      debugLog(`📊 [SETTINGS HISTORY] ⚠️ No meals to render`);
    }

    const dayHtml = `
      <div class="day-card">
        <div class="day-card__header">
          <h3>${formatDate(day.date)}</h3>
          <span class="day-card__date">${formatDate(day.date)}</span>
        </div>
        <div class="day-card__content">
          ${day.activity ? `
            <div class="day-stats">
              <div class="day-stat">
                <span class="day-stat__label">Burned</span>
                <span class="day-stat__value">${day.activity.caloriesBurned} cal</span>
              </div>
              <div class="day-stat">
                <span class="day-stat__label">Active</span>
                <span class="day-stat__value">${day.activity.activeMinutes} min</span>
              </div>
            </div>
          ` : '<p class="day-card__empty">No activity data</p>'}

          <div class="day-meals">
            <h4>Nutrition</h4>
            ${day.totals.meals && day.totals.meals.length > 0 ? `
              ${day.totals.calories > 0
                ? `<p class="day-total">Total: <strong>${day.totals.calories} calories</strong></p>`
                : `<p class="day-total">Total: <strong>Not tracked</strong></p>`
              }
              <ul class="meals-list">
                ${mealsHtml}
              </ul>
            ` : '<p class="day-card__empty">No meals logged</p>'}
          </div>
        </div>
      </div>
    `;

    debugLog(`📊 [DAY HTML LENGTH]`, dayHtml.length);
    debugLog(`📊 [DAY HTML]`, dayHtml);

    html += dayHtml;
  });

  html += '</div>';

  debugLog('📊 [SETTINGS HISTORY] ========== FINAL HTML ==========');
  debugLog('📊 [SETTINGS HISTORY] Total HTML length:', html.length);
  debugLog('📊 [SETTINGS HISTORY] Setting innerHTML now...');

  weeklyContentSettings.innerHTML = html;

  debugLog('📊 [SETTINGS HISTORY] ✅ innerHTML set');
  debugLog('📊 [SETTINGS HISTORY] DOM check - weeklyContentSettings.children.length:', weeklyContentSettings.children.length);
  debugLog('📊 [SETTINGS HISTORY] DOM check - First child:', weeklyContentSettings.children[0]);

  // Check if meal elements exist in DOM
  const mealLists = weeklyContentSettings.querySelectorAll('.meals-list');
  debugLog('📊 [SETTINGS HISTORY] Found', mealLists.length, 'meal lists in DOM');
  mealLists.forEach((list, index) => {
    debugLog(`📊 [SETTINGS HISTORY] Meal list ${index + 1}:`, list);
    debugLog(`  - Has ${list.children.length} meal items`);
    debugLog(`  - Display style:`, window.getComputedStyle(list).display);
    debugLog(`  - Visibility:`, window.getComputedStyle(list).visibility);
  });
};

/* =========================
   Weekly Summary View
========================= */

function showWeeklySummary() {
  if (!weeklyModal) return;

  // Get last 7 days - TODAY FIRST, then descending
  const days = [];
  for (let i = 0; i <= 6; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = getLocalDateString(date); // YYYY-MM-DD format for both dailyTotals and weeklyData

    const activityForDay = weeklyData[dateKey] || null;
    const totalsForDay = dailyTotals[dateKey] || { calories: 0, meals: [] };

    days.push({
      date: dateKey,
      activity: activityForDay,
      totals: totalsForDay
    });
  }

  // Render summary
  let html = '<div class="weekly-summary">';

  days.forEach(day => {
    debugLog(`📊 [HISTORY MODAL] Rendering day ${day.date}:`, {
      hasActivity: !!day.activity,
      totalCalories: day.totals.calories,
      mealCount: day.totals.meals?.length || 0,
      meals: day.totals.meals
    });

    html += `
      <div class="day-card">
        <div class="day-card__header">
          <h3>${formatDate(day.date)}</h3>
          <span class="day-card__date">${formatDate(day.date)}</span>
        </div>
        <div class="day-card__content">
          ${day.activity ? `
            <div class="day-stats">
              <div class="day-stat">
                <span class="day-stat__label">Burned</span>
                <span class="day-stat__value">${day.activity.caloriesBurned} cal</span>
              </div>
              <div class="day-stat">
                <span class="day-stat__label">Active</span>
                <span class="day-stat__value">${day.activity.activeMinutes} min</span>
              </div>
            </div>
          ` : '<p class="day-card__empty">No activity data</p>'}

          <div class="day-meals">
            <h4>Nutrition</h4>
            ${day.totals.meals && day.totals.meals.length > 0 ? `
              ${day.totals.calories > 0
                ? `<p class="day-total">Total: <strong>${day.totals.calories} calories</strong></p>`
                : `<p class="day-total">Total: <strong>Not tracked</strong></p>`
              }
              <ul class="meals-list">
                ${day.totals.meals.map(meal => `
                  <li><span class="meal-time">${meal.time}</span> ${escapeHTML(meal.description)}</li>
                `).join('')}
              </ul>
            ` : '<p class="day-card__empty">No meals logged</p>'}
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  weeklyContent.innerHTML = html;
  weeklyModal.style.display = 'flex';
}

function closeWeeklySummary() {
  if (weeklyModal) weeklyModal.style.display = 'none';
}

/* =========================
   AI Response Parser
========================= */

// Infer meal type based on time of day
function inferMealType() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 18) return 'snack';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'snack';
}

// Old parseAIResponse function removed - now using structured JSON from API

async function updateMacrosSidebar(macros) {
  debugLog('=== UPDATING SIDEBAR ===');
  debugLog('Macros to update:', macros);

  // Load user goals from settings
  let goals = {
    calories: 2000,
    protein: 150,
    carbs: 225,
    fat: 65,
    adjustForActivity: true
  };

  if (db && currentUser) {
    try {
      const { loadSettingsFromFirestore } = await import('./firestore-helpers.js');
      const settings = await loadSettingsFromFirestore(db, currentUser.uid);
      if (settings.macroGoals) {
        goals = {
          ...settings.macroGoals,
          adjustForActivity: settings.macroGoals.adjustForActivity !== false // Default to true
        };
      }
    } catch (error) {
      console.warn('⚠️ Could not load goals, using defaults:', error);
    }
  }

  // Calculate activity adjustment and adjusted macro targets
  let adjustedTargets = {
    calories: goals.calories,
    protein: goals.protein,
    carbs: goals.carbs,
    fat: goals.fat
  };

  if (goals.adjustForActivity && activityData && activityData.caloriesBurned) {
    const activityCalories = activityData.caloriesBurned;
    const newCalorieTarget = goals.calories + activityCalories;

    // Calculate percentage of each macro from base goals
    // 1g Protein = 4 cal, 1g Carbs = 4 cal, 1g Fat = 9 cal
    const proteinCalories = goals.protein * 4;
    const carbsCalories = goals.carbs * 4;
    const fatCalories = goals.fat * 9;

    const proteinPercent = proteinCalories / goals.calories;
    const carbsPercent = carbsCalories / goals.calories;
    const fatPercent = fatCalories / goals.calories;

    // Apply same percentages to new calorie target
    adjustedTargets = {
      calories: newCalorieTarget,
      protein: Math.round((newCalorieTarget * proteinPercent) / 4),
      carbs: Math.round((newCalorieTarget * carbsPercent) / 4),
      fat: Math.round((newCalorieTarget * fatPercent) / 9)
    };

    debugLog('🔥 Activity adjustment applied:', {
      activityCalories,
      baseGoals: goals,
      percentages: { proteinPercent, carbsPercent, fatPercent },
      adjustedTargets
    });
  }

  // Update calories
  const caloriesText = document.getElementById('caloriesText');
  const caloriesFill = document.getElementById('caloriesFill');
  debugLog('Calories elements:', { caloriesText, caloriesFill });
  if (caloriesText) {
    caloriesText.textContent = `${macros.calories} / ${adjustedTargets.calories}`;
    debugLog('✅ Updated calories text to:', caloriesText.textContent);
  }
  if (caloriesFill) {
    const percent = Math.min(100, (macros.calories / adjustedTargets.calories) * 100);
    caloriesFill.style.width = `${percent}%`;
    debugLog('✅ Updated calories bar to:', percent + '%');
  }

  // Update protein
  const proteinText = document.getElementById('proteinText');
  const proteinFill = document.getElementById('proteinFill');
  debugLog('Protein elements:', { proteinText, proteinFill });
  if (proteinText) {
    proteinText.textContent = `${macros.protein}g / ${adjustedTargets.protein}g`;
    debugLog('✅ Updated protein text to:', proteinText.textContent);
  }
  if (proteinFill) {
    const percent = Math.min(100, (macros.protein / adjustedTargets.protein) * 100);
    proteinFill.style.width = `${percent}%`;
    debugLog('✅ Updated protein bar to:', percent + '%');
  }

  // Update carbs
  const carbsText = document.getElementById('carbsText');
  const carbsFill = document.getElementById('carbsFill');
  debugLog('Carbs elements:', { carbsText, carbsFill });
  if (carbsText) {
    carbsText.textContent = `${macros.carbs}g / ${adjustedTargets.carbs}g`;
    debugLog('✅ Updated carbs text to:', carbsText.textContent);
  }
  if (carbsFill) {
    const percent = Math.min(100, (macros.carbs / adjustedTargets.carbs) * 100);
    carbsFill.style.width = `${percent}%`;
    debugLog('✅ Updated carbs bar to:', percent + '%');
  }

  // Update fat
  const fatText = document.getElementById('fatText');
  const fatFill = document.getElementById('fatFill');
  debugLog('Fat elements:', { fatText, fatFill });
  if (fatText) {
    fatText.textContent = `${macros.fat}g / ${adjustedTargets.fat}g`;
    debugLog('✅ Updated fat text to:', fatText.textContent);
  }
  if (fatFill) {
    const percent = Math.min(100, (macros.fat / adjustedTargets.fat) * 100);
    fatFill.style.width = `${percent}%`;
    debugLog('✅ Updated fat bar to:', percent + '%');
  }

  // Update empty macros state
  updateEmptyMacrosState();

  debugLog('=== SIDEBAR UPDATE COMPLETE ===');
}

/* =========================
   Rendering
========================= */

function renderAll() {
  list.innerHTML = "";

  if (messages.length === 0) {
    showEmptyChatState();
    return;
  }

  messages.forEach(renderMessage);
  scrollToBottom();
}

function renderMessage(msg) {
  debugLog('🎨 Rendering message:', msg.role, msg.text.substring(0, 50));
  const li = document.createElement("li");
  li.className = "message";
  if (msg.role === "user") {
    li.classList.add("message--self");
  }

  const text = document.createElement("div");
  text.className = "message__text";
  // Use parseMarkdown for AI messages to support bold formatting
  text.innerHTML = msg.role === "assistant" ? parseMarkdown(msg.text) : escapeHTML(msg.text);

  const meta = document.createElement("div");
  meta.className = "message__meta";
  meta.innerHTML =
    `<span>${msg.role === "user" ? "You" : "AI"}</span>` +
    `<span>${formatTime(msg.time)}</span>`;

  li.appendChild(text);
  li.appendChild(meta);

  if (msg.role === "assistant" && msg.isProactive) {
    const actions = document.createElement("div");
    actions.className = "message__actions";
    actions.style.marginTop = "8px";
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.innerHTML = `
      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.8rem;" onclick="rateMessage('${msg.id}', 1)" ${msg.thumbs === 1 ? 'disabled' : ''}>👍 Helpful</button>
      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.8rem;" onclick="rateMessage('${msg.id}', -1)" ${msg.thumbs === -1 ? 'disabled' : ''}>👎 Not Helpful</button>
    `;
    li.appendChild(actions);
  }

  list.appendChild(li);
  debugLog('✅ Message added to DOM');
}

window.rateMessage = async function(messageId, thumbs) {
  if (!currentUser) return;
  try {
    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/rate-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({ messageId, thumbs })
    });
    
    if (response.ok) {
      // Update local state and re-render
      const msgIndex = messages.findIndex(m => m.id === messageId);
      if (msgIndex !== -1) {
        messages[msgIndex].thumbs = thumbs;
        renderAll();
      }
    }
  } catch (err) {
    console.error("Failed to rate message:", err);
  }
}


/* =========================
   UX Polish: Custom Confirmation Modal
========================= */

// Show custom confirmation modal (replaces browser confirm)
window.showConfirmModal = function(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const overlay = modal.querySelector('.confirm-modal__overlay');

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Show modal
    modal.style.display = 'flex';

    // Handle OK
    const handleOk = () => {
      cleanup();
      resolve(true);
    };

    // Handle Cancel
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Cleanup listeners and hide modal
    const cleanup = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleCancel);
    };

    // Attach listeners
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleCancel);
  });
}

/* =========================
   UX Polish: Formatting & Error Handling
========================= */

// Strip ALL markdown formatting from AI responses
function formatAIResponse(text) {
  if (!text) return text;

  // Remove all markdown formatting
  text = text.replace(/\*\*/g, ''); // Remove bold **text**
  text = text.replace(/\*/g, '');   // Remove italic *text*
  text = text.replace(/\_\_/g, ''); // Remove bold __text__
  text = text.replace(/\_/g, '');   // Remove italic _text_
  text = text.replace(/\~/g, '');   // Remove strikethrough ~~text~~
  text = text.replace(/\`/g, '');   // Remove code `text`

  return text;
}

// Show error toast notification
function showErrorToast(message) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Remove after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Check if macros are empty and show/hide empty state
function updateEmptyMacrosState() {
  const emptyState = document.getElementById('emptyMacrosState');
  if (!emptyState) return;

  const hasAnyMacros = currentMacros.calories > 0 ||
                       currentMacros.protein > 0 ||
                       currentMacros.carbs > 0 ||
                       currentMacros.fat > 0;

  if (hasAnyMacros) {
    emptyState.style.display = 'none';
  } else {
    emptyState.style.display = 'block';
  }
}

// Show empty chat state for new users
function showEmptyChatState() {
  if (messages.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.className = 'empty-state';
    emptyState.id = 'empty-chat-state';
    emptyState.innerHTML = `
      <div class="empty-state__icon">💬</div>
      <div class="empty-state__title">Welcome to EatTailor!</div>
      <div class="empty-state__text">
        Hi! I'm your nutrition AI assistant.<br>
        Tell me what you ate and I'll track your macros.
      </div>
    `;
    list.appendChild(emptyState);
  }
}

// Remove empty chat state when first message sent
function hideEmptyChatState() {
  const emptyState = document.getElementById('empty-chat-state');
  if (emptyState) {
    emptyState.remove();
  }
}

/* =========================
   Form handler
========================= */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  debugLog('🚀 Form submitted!');

  const value = input.value.trim();
  if (!value) return;

  debugLog('📝 User message:', value);

  // Track last user message for meal history contexts if needed
  lastUserMessage = value;

  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  input.disabled = true;

  hideEmptyChatState();

  const userMsg = { role: "user", text: value, time: Date.now() };
  messages.push(userMsg);
  saveMessages();
  renderMessage(userMsg);
  scrollToBottom();

  input.value = "";
  autogrow(input);

  showTypingIndicator();

  try {
    debugLog('🤖 Calling API /api/chat...');
    
    // We send the whole messages history in OpenAI format
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.text
    }));

    const idToken = await currentUser.getIdToken(true);
    
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        messages: formattedMessages
      })
    });

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/auth';
        return;
      }
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    hideTypingIndicator();
    
    // Render AI reply
    if (data.reply) {
      const formattedText = formatAIResponse(data.reply);
      messages.push({
        role: "assistant",
        text: formattedText,
        time: Date.now()
      });
      saveMessages();
      renderMessage(messages[messages.length - 1]);
      scrollToBottom();
    }
    
    // Update authoritative totals in UI directly from server payload
    if (data.totals) {
      currentMacros = data.totals;
      await updateMacrosSidebar(currentMacros);
      
      // Update the daily totals map in memory so UI reflects it
      const today = getTodayKey();
      if (!dailyTotals[today]) {
        dailyTotals[today] = { calories: 0, meals: [] };
      }
      dailyTotals[today].calories = currentMacros.calories;
      
      // Add the new meals to our in-memory history if there are any
      if (data.meals && data.meals.length > 0) {
        for (const item of data.meals) {
          dailyTotals[today].meals.push({
            ...item,
            description: value,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      // NOTE: We DO NOT call saveCurrentMacros or saveDailyTotals or saveMealHistory here.
      // The server already wrote them to Firestore via the Admin SDK. 
      // We only update our local memory and UI so it reflects the backend truth.
      // UI refresh is best-effort. A failure here (for example Strava being unavailable)
      // must never surface as a connection error, because the meal is already saved.
      try {
        await renderActivityStats();
        await renderWeeklyTotals();
        await calculateAndUpdateStreak();
        checkStreak();
      } catch (uiErr) {
        console.warn('Post-log UI refresh failed (the log itself was saved):', uiErr);
      }
    }
    
  } catch (err) {
    console.error('❌ Error during chat:', err);
    hideTypingIndicator();
    
    const errorMsg = { 
      role: "assistant", 
      text: "⚠️ I'm having trouble connecting right now. Please try again.", 
      time: Date.now(),
      isError: true
    };
    messages.push(errorMsg);
    saveMessages();
    renderMessage(errorMsg);
    scrollToBottom();
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
    input.disabled = false;
    input.focus();
  }
});

/* =========================
   Event Listeners
========================= */

input.addEventListener("input", () => autogrow(input));

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// Removed - moved to iOS-specific section below

// clearBtn removed from footer - now in Advanced settings
// clearBtn.addEventListener("click", () => {
//   const ok = confirm("Clear chat history?");
//   if (!ok) return;
//   messages = [];
//   saveMessages();
//   renderAll();
// });

if (viewWeeklyBtn) {
  viewWeeklyBtn.addEventListener("click", showWeeklySummary);
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", closeWeeklySummary);
}

if (weeklyModal) {
  weeklyModal.addEventListener("click", (e) => {
    if (e.target === weeklyModal) closeWeeklySummary();
  });
}

// Refresh Strava button
const refreshStravaBtn = document.getElementById("refreshStravaBtn");
if (refreshStravaBtn) {
  refreshStravaBtn.addEventListener("click", async () => {
    debugLog('🔄 Refresh Strava button clicked');

    // Show loading state
    refreshStravaBtn.classList.add('loading');
    refreshStravaBtn.disabled = true;

    try {
      // Clear cache (user-specific)
      localStorage.removeItem(`strava-cache-${currentUser.uid}`);
      debugLog('🔄 Strava cache cleared');

      // Reload activity data
      await loadActivityData();

      // Save today's activity data to weeklyData
      if (activityData && activityData.date) {
        debugLog('💾 Saving refreshed activity data to weeklyData:', activityData);
        await saveToWeeklyData(activityData);
      }

      // Re-render the activity stats to show updated data
      await renderActivityStats();
      debugLog('✅ Activity stats re-rendered');

      // Re-render weekly totals to show updated count
      renderWeeklyTotals();
      debugLog('✅ Weekly totals re-rendered');

      // Show success message
      showToast('Strava data updated ✓');

    } catch (error) {
      debugError('❌ Error refreshing Strava:', error);
      showToast('Failed to refresh Strava data');
    } finally {
      // Remove loading state
      refreshStravaBtn.classList.remove('loading');
      refreshStravaBtn.disabled = false;
    }
  });
}

// Helper function to show toast messages
function showToast(message) {
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1e2431;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    border: 1px solid #6366f1;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Footer buttons removed - now in Advanced settings tab
// const resetTodayBtn = document.getElementById("resetTodayBtn");
// const exportTextBtn = document.getElementById("exportTextBtn");
// const exportJsonBtn = document.getElementById("exportJsonBtn");

// if (resetTodayBtn) {
//   resetTodayBtn.addEventListener("click", resetToday);
// }

// if (exportTextBtn) {
//   exportTextBtn.addEventListener("click", exportAsText);
// }

// if (exportJsonBtn) {
//   exportJsonBtn.addEventListener("click", exportAsJSON);
// }

// Advanced settings buttons
const clearBtnSettings = document.getElementById("clearBtnSettings");
const resetTodayBtnSettings = document.getElementById("resetTodayBtnSettings");
const exportTextBtnSettings = document.getElementById("exportTextBtnSettings");
const exportJsonBtnSettings = document.getElementById("exportJsonBtnSettings");

if (clearBtnSettings) {
  clearBtnSettings.addEventListener("click", async () => {
    const ok = await showConfirmModal(
      'Clear Chat History',
      'This will permanently delete your chat history. This cannot be undone.'
    );
    if (!ok) return;
    messages = [];
    saveMessages();
    renderAll();
    // Close settings modal
    document.getElementById('settingsModal').style.display = 'none';
  });
}

if (resetTodayBtnSettings) {
  resetTodayBtnSettings.addEventListener("click", async () => {
    await resetToday();
    // Keep settings modal open so user can continue managing settings
  });
}

if (exportTextBtnSettings) {
  exportTextBtnSettings.addEventListener("click", () => {
    exportAsText();
    // Close settings modal
    document.getElementById('settingsModal').style.display = 'none';
  });
}

if (exportJsonBtnSettings) {
  exportJsonBtnSettings.addEventListener("click", () => {
    exportAsJSON();
    // Close settings modal
    document.getElementById('settingsModal').style.display = 'none';
  });
}

/* =========================
   Sidebar Toggle (Hamburger Menu)
========================= */

const SIDEBAR_STATE_KEY = 'sidebar-state';

// Load sidebar state from Firestore
async function loadSidebarState() {
  try {
    // First, check localStorage for instant restore (cache)
    const cachedState = localStorage.getItem('sidebar-state-cache');
    if (cachedState) {
      const cached = JSON.parse(cachedState);
      document.body.classList.add('sidebar-loading');
      if (cached.isOpen) {
        document.body.classList.remove('sidebar-hidden');
      } else {
        document.body.classList.add('sidebar-hidden');
      }
      requestAnimationFrame(() => {
        document.body.classList.remove('sidebar-loading');
      });
    }

    // Then load from Firestore (authoritative source)
    const stateDoc = await loadSidebarStateFromFirestore(db, currentUser.uid);

    document.body.classList.add('sidebar-loading');

    if (stateDoc && stateDoc.isOpen) {
      document.body.classList.remove('sidebar-hidden');
      localStorage.setItem('sidebar-state-cache', JSON.stringify({ isOpen: true }));
    } else {
      document.body.classList.add('sidebar-hidden');
      localStorage.setItem('sidebar-state-cache', JSON.stringify({ isOpen: false }));
    }

    requestAnimationFrame(() => {
      document.body.classList.remove('sidebar-loading');
    });
  } catch (error) {
    // Default to hidden on error (no animation)
    document.body.classList.add('sidebar-loading');
    document.body.classList.add('sidebar-hidden');
    requestAnimationFrame(() => {
      document.body.classList.remove('sidebar-loading');
    });
  }
}

// Save sidebar state to Firestore
async function saveSidebarState(isOpen) {
  try {
    // Save to localStorage immediately (cache)
    localStorage.setItem('sidebar-state-cache', JSON.stringify({ isOpen }));
    // Save to Firestore (authoritative)
    await saveSidebarStateToFirestore(db, currentUser.uid, { isOpen });
  } catch (error) {
    debugError('Error saving sidebar state:', error);
  }
}

const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarClose = document.getElementById('sidebarClose');

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    document.body.classList.remove('sidebar-hidden');
    saveSidebarState(true);
  });
}

if (sidebarClose) {
  sidebarClose.addEventListener('click', () => {
    document.body.classList.add('sidebar-hidden');
    saveSidebarState(false);
  });
}

/* =========================
   Manual Testing (call from browser console)
========================= */

// Test the parsing with the exact format from the AI
window.testParsing = function(text) {
  debugLog('🧪 MANUAL TEST: Testing parsing with text:', text);
  parseAIResponse(text);
};

// Test sidebar update directly
window.testSidebar = function(calories, protein, carbs, fat) {
  debugLog('🧪 MANUAL TEST: Testing sidebar update with:', {calories, protein, carbs, fat});
  updateMacrosSidebar({
    calories: calories || 290,
    protein: protein || 21,
    carbs: carbs || 18,
    fat: fat || 14
  });
};

// Debug: Check current Firebase data
window.debugFirebase = async function() {
  debugLog('🔍 ========== FIREBASE DEBUG ==========');
  debugLog('📅 Today\'s date key:', getTodayKey());
  debugLog('📊 currentMacros (in memory):', currentMacros);
  debugLog('📊 dailyTotals (in memory):', dailyTotals);

  try {
    // Reload from Firebase
    const fbMacros = await loadMacrosFromFirestore(db, currentUser.uid);
    const fbDailyTotals = await loadDailyTotalsFromFirestore(db, currentUser.uid);

    debugLog('💾 currentMacros (from Firebase):', fbMacros);
    debugLog('💾 dailyTotals (from Firebase):', fbDailyTotals);
    debugLog('💾 Today\'s meals from Firebase:', fbDailyTotals[getTodayKey()]);

    // Calculate what the total SHOULD be
    const today = getTodayKey();
    if (fbDailyTotals[today] && fbDailyTotals[today].meals) {
      debugLog('🍽️ Total meals logged today:', fbDailyTotals[today].meals.length);
      fbDailyTotals[today].meals.forEach((meal, idx) => {
        debugLog(`  ${idx + 1}. [${meal.time}] ${meal.description}`);
      });
    }

    debugLog('🔍 ========== END DEBUG ==========');
  } catch (error) {
    debugError('❌ Error loading Firebase data:', error);
  }
};

// Clean up old Garmin data from Firebase
window.cleanupGarminData = async function() {
  debugLog('🧹 ========== CLEANING GARMIN DATA ==========');

  try {
    const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');

    // Try to delete old garminData document
    const garminRef = doc(db, 'users', currentUser.uid, 'data', 'garminData');
    await deleteDoc(garminRef);
    debugLog('✅ Deleted old garminData document');

  } catch (error) {
    if (error.code === 'not-found') {
      debugLog('ℹ️ No garminData found (already clean)');
    } else {
      debugError('❌ Error cleaning Garmin data:', error);
    }
  }

  debugLog('🧹 ========== CLEANUP COMPLETE ==========');
};

// Quick reset today's data
window.resetToday = async function() {
  const today = getTodayKey();
  debugLog('🔄 Resetting data for:', today);

  currentMacros = { calories: 0, protein: 0, carbs: 0, fat: 0, date: today };
  dailyTotals[today] = { calories: 0, meals: [] };

  await saveCurrentMacros(currentMacros);
  await saveDailyTotals();
  await updateMacrosSidebar(currentMacros);

  debugLog('✅ Reset complete!');
  location.reload();
};

/* =========================
   Init
========================= */

async function initApp() {
  debugLog('🚀 Initializing app with Firestore...');

  // CLEANUP: Clear old Strava cache formats and current cache to force fresh fetch
  try {
    localStorage.removeItem(`stravaCache_${currentUser.uid}`); // Old format
    localStorage.removeItem(`strava-cache-${currentUser.uid}`); // Current format
    localStorage.removeItem('strava-cache'); // Legacy non-user-specific format
    debugLog('🗑️ Cleared Strava cache');
  } catch (error) {
    debugLog('ℹ️ Could not clear Strava cache');
  }

  // Load all data from Firestore
  await Promise.all([
    loadMessages(),
    loadActivityData(),
    loadWeeklyData(),
    loadDailyTotals(),
    loadCurrentMacros(),
    loadSidebarState(),
    loadAIPreferences(db, currentUser),
    loadStreakData(db, currentUser.uid).then(data => { streakData = data; })
  ]);

  debugLog('✅ All data loaded from Firestore');

  // Save today's activity data to weekly data if available
  if (activityData && activityData.date) {
    debugLog('💾 Saving today\'s activity data to weeklyData:', activityData);
    await saveToWeeklyData(activityData);
  }

  // Always calculate and update streak (to check if it should be broken on rest days)
  debugLog('🔥 Calculating streak...');
  await calculateAndUpdateStreak();

  // Initialize settings modal
  initSettingsModal(db, currentUser);

  // Display user info in sidebar footer
  displayUserInfo();

  // Render UI
  renderAll();
  renderActivityStats();
  renderWeeklyTotals();
  autogrow(input);

  // Update macro sidebar to show adjusted targets
  // (Even if currentMacros is 0, we want to show the goals with activity adjustment)
  debugLog('📊 Updating macro sidebar with current macros:', currentMacros);
  debugLog('📊 Activity data for adjustment:', activityData);
  updateMacrosSidebar(currentMacros);
}

/* =========================
   Mobile Menu Handler
========================= */

// Prevent iOS rubber-band scrolling
function preventIOSBounce() {
  let startY = 0;

  document.addEventListener('touchstart', (e) => {
    startY = e.touches[0].pageY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const element = e.target;
    const scrollable = element.closest('.chat__messages') ||
                      element.closest('.settings-panel') ||
                      element.closest('.sidebar') ||
                      element.closest('[data-panel]');

    if (!scrollable) {
      e.preventDefault();
    }
  }, { passive: false });

  debugLog('✅ iOS bounce prevention initialized');
}

// Fix settings button for mobile
function ensureSettingsButtonWorks() {
  const settingsBtn = document.getElementById('settingsBtn') ||
                     document.querySelector('.settings-icon') ||
                     document.querySelector('[data-action="settings"]');

  if (settingsBtn) {
    debugLog('🔧 Settings button found:', settingsBtn);

    // Ensure it's clickable on mobile
    settingsBtn.style.zIndex = '9999';
    settingsBtn.style.pointerEvents = 'auto';
    settingsBtn.style.cursor = 'pointer';
    settingsBtn.style.touchAction = 'manipulation';
    settingsBtn.style.webkitTapHighlightColor = 'transparent';

    // Add debug logging for click events
    settingsBtn.addEventListener('click', (e) => {
      debugLog('⚙️ Settings button CLICK event!', e);
      debugLog('⚙️ Event type:', e.type);
      debugLog('⚙️ Target:', e.target);
    }, { capture: true });

    // Add touch event logging for mobile
    settingsBtn.addEventListener('touchstart', (e) => {
      debugLog('⚙️ Settings button TOUCHSTART event!', e);
    }, { capture: true, passive: true });

    settingsBtn.addEventListener('touchend', (e) => {
      debugLog('⚙️ Settings button TOUCHEND event!', e);
    }, { capture: true, passive: true });

    debugLog('✅ Settings button enhanced for mobile with touch handlers');
  } else {
    console.warn('⚠️ Settings button not found');
  }
}

function initMobileMenu() {
  debugLog('📱 ========== INITIALIZING MOBILE MENU ==========');

  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileBackdrop = document.getElementById('mobileBackdrop');
  const sidebar = document.querySelector('.sidebar');
  const sidebarCloseMobile = document.getElementById('sidebarCloseMobile');

  debugLog('📱 Element check:');
  debugLog('  - Menu button (mobileMenuBtn):', mobileMenuBtn);
  debugLog('  - Backdrop (mobileBackdrop):', mobileBackdrop);
  debugLog('  - Sidebar (.sidebar):', sidebar);
  debugLog('  - Close button (sidebarCloseMobile):', sidebarCloseMobile);

  if (!mobileMenuBtn) {
    debugError('❌ CRITICAL: Mobile menu button not found! ID: mobileMenuBtn');
    return;
  }
  if (!mobileBackdrop) {
    debugError('❌ CRITICAL: Mobile backdrop not found! ID: mobileBackdrop');
    return;
  }
  if (!sidebar) {
    debugError('❌ CRITICAL: Sidebar not found! Class: .sidebar');
    return;
  }

  debugLog('✅ All required elements found');

  // Detect iOS and add class to body
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    document.body.classList.add('is-ios');
    debugLog('🍎 iOS detected - added is-ios class to body');

    // iOS keyboard handling - auto-scroll when keyboard opens
    const messageInput = document.getElementById('message');
    if (messageInput) {
      messageInput.addEventListener('focus', () => {
        debugLog('🍎 iOS: Input focused, keyboard opening');
        document.body.classList.add('keyboard-open');

        // Scroll messages to bottom with delay for keyboard animation
        setTimeout(() => {
          const chatMessages = document.querySelector('.chat__messages');
          if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
            debugLog('🍎 iOS: Scrolled messages to bottom');
          }

          // Also scroll whole page to bring input into view
          window.scrollTo(0, document.body.scrollHeight);
        }, 300);
      });

      messageInput.addEventListener('blur', () => {
        debugLog('🍎 iOS: Input blurred, keyboard closing');
        document.body.classList.remove('keyboard-open');
      });
    }
  }

  // Toggle sidebar
  function toggleSidebar() {
    const isOpen = sidebar.classList.contains('sidebar--open');

    debugLog('📱 ========== TOGGLE SIDEBAR FUNCTION ==========');
    debugLog('📱 Current state - isOpen:', isOpen);

    if (isOpen) {
      sidebar.classList.remove('sidebar--open');
      mobileBackdrop.classList.remove('mobile-backdrop--visible');
      mobileMenuBtn.classList.remove('mobile-menu-btn--hidden');
      document.body.classList.remove('modal-open');
      debugLog('📱 ✅ CLOSED - Removed classes');
    } else {
      sidebar.classList.add('sidebar--open');
      mobileBackdrop.classList.add('mobile-backdrop--visible');
      mobileMenuBtn.classList.add('mobile-menu-btn--hidden');
      document.body.classList.add('modal-open');
      debugLog('📱 ✅ OPENED - Added classes, hamburger hidden');
    }

    debugLog('📱 Sidebar classes AFTER:', sidebar.className);
    debugLog('📱 Hamburger classes AFTER:', mobileMenuBtn.className);
    debugLog('📱 ========== END TOGGLE ==========');
  }

  // Menu button click (hamburger)
  mobileMenuBtn.addEventListener('click', (e) => {
    debugLog('📱 ========== HAMBURGER MENU CLICKED ==========');
    debugLog('📱 Event:', e);
    debugLog('📱 Target:', e.target);
    debugLog('📱 Current sidebar state:', sidebar.classList.contains('sidebar--open') ? 'OPEN' : 'CLOSED');
    toggleSidebar();
  });

  // Close button click (X inside sidebar)
  if (sidebarCloseMobile) {
    sidebarCloseMobile.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent event from bubbling
      debugLog('📱 ========== SIDEBAR CLOSE BUTTON CLICKED ==========');
      debugLog('📱 Event:', e);
      toggleSidebar();
    });
  } else {
    console.warn('⚠️ Sidebar close button not found!');
  }

  // Backdrop click - close sidebar
  mobileBackdrop.addEventListener('click', (e) => {
    debugLog('📱 ========== BACKDROP CLICKED ==========');
    debugLog('📱 Event:', e);
    toggleSidebar();
  });

  // Prevent sidebar clicks from bubbling to backdrop (iOS fix)
  sidebar.addEventListener('click', (e) => {
    // Always stop propagation so clicks don't reach backdrop
    e.stopPropagation();

    // Don't close if clicking the close button (already handled above)
    if (e.target.closest('#sidebarCloseMobile')) {
      return;
    }

    // Close for other buttons (like settings)
    if (e.target.tagName === 'BUTTON' && window.innerWidth <= 768) {
      // Wait a bit before closing so user sees the action
      setTimeout(toggleSidebar, 300);
    }
  });

  debugLog('✅ Mobile menu initialized');
}

// Fix for Android Chrome's address bar affecting viewport
function setAndroidViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
  debugLog('📱 Viewport height set:', vh);
}

// Update placeholder text based on screen size
function updatePlaceholder() {
  const textarea = document.getElementById('message');
  if (!textarea) return;

  if (window.innerWidth <= 768) {
    // Mobile: simple placeholder
    textarea.placeholder = 'Type a message...';
  } else {
    // Desktop: detailed placeholder
    textarea.placeholder = textarea.getAttribute('data-placeholder-desktop') || 'Press Enter to send • Shift+Enter for new line';
  }
}

// Initialize all mobile features
function initMobileFeatures() {
  debugLog('📱 Initializing mobile features...');
  debugLog('📱 User agent:', navigator.userAgent);

  // AGGRESSIVE AUTO-SCROLL: Watch for new messages and scroll immediately
  if (list) {
    const scrollObserver = new MutationObserver(() => {
      scrollToBottom();
    });

    scrollObserver.observe(list, {
      childList: true,
      subtree: true
    });

    debugLog('✅ MutationObserver set up for auto-scroll');
  }

  // Initialize mobile menu
  initMobileMenu();

  // Fix settings button
  ensureSettingsButtonWorks();

  // Update placeholder for mobile
  updatePlaceholder();
  window.addEventListener('resize', updatePlaceholder);

  // ANDROID CHROME: Dynamic keyboard detection
  const isAndroid = /Android/.test(navigator.userAgent);
  if (isAndroid && list) {
    const messageInput = document.getElementById('message');

    if (messageInput) {
      // Track keyboard state
      let keyboardOpen = false;

      // When input is focused, assume keyboard is opening
      messageInput.addEventListener('focus', () => {
        debugLog('📱 Android: Input focused - keyboard opening');
        keyboardOpen = true;
        list.style.paddingBottom = '400px';
        scrollToBottom();
      });

      // When input loses focus, keyboard is closing
      messageInput.addEventListener('blur', () => {
        debugLog('📱 Android: Input blurred - keyboard closing');
        keyboardOpen = false;
        list.style.paddingBottom = '70px'; // Back to composer height
      });

      // Also detect window resize (keyboard open/close changes viewport height)
      let lastHeight = window.innerHeight;
      window.addEventListener('resize', () => {
        const currentHeight = window.innerHeight;

        // If height decreased significantly, keyboard opened
        if (currentHeight < lastHeight - 100 && !keyboardOpen) {
          debugLog('📱 Android: Viewport shrunk - keyboard opened');
          keyboardOpen = true;
          list.style.paddingBottom = '400px';
          scrollToBottom();
        }
        // If height increased significantly, keyboard closed
        else if (currentHeight > lastHeight + 100 && keyboardOpen) {
          debugLog('📱 Android: Viewport expanded - keyboard closed');
          keyboardOpen = false;
          list.style.paddingBottom = '70px'; // Back to composer height
        }

        lastHeight = currentHeight;
      });

      debugLog('✅ Android keyboard detection set up');
    }
  }

  // Fix viewport height for Android (Chrome/Brave address bar)
  setAndroidViewportHeight();
  window.addEventListener('resize', setAndroidViewportHeight);
  window.addEventListener('orientationchange', setAndroidViewportHeight);

  // Prevent iOS bounce (only on iOS)
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    debugLog('📱 iOS device detected, enabling bounce prevention');
    preventIOSBounce();
  }

  debugLog('✅ All mobile features initialized');
}

// Initialize mobile features on page load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileFeatures);
  } else {
    initMobileFeatures();
  }
}

// Scroll to bottom on page load
window.addEventListener('load', () => {
  setTimeout(scrollToBottom, 500);
  debugLog('📜 Page loaded - scrolling to bottom');
});

// App will be started by index.html calling window.startEatTailorApp()
debugLog('✅ app.js loaded, waiting for startEatTailorApp() to be called...');
