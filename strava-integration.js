/* Strava Integration Helper */

import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

/* Debug mode - set to false for production */
const DEBUG_MODE = false;
const debugLog = (...args) => { if (DEBUG_MODE) debugLog(...args); };
const debugError = (...args) => { if (DEBUG_MODE) debugError(...args); };

debugLog('🚴 Strava integration module loaded');

// Wait for Firebase to be initialized
async function waitForFirebase() {
  debugLog('🚴 Waiting for Firebase to initialize...');
  debugLog('🚴 Checking for window.db or window.firebaseDb...');

  let attempts = 0;
  while (!(window.db || window.firebaseDb) && attempts < 100) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;

    if (attempts % 10 === 0) {
      debugLog(`🚴 Still waiting... (${attempts * 100}ms elapsed)`);
    }
  }

  const db = window.db || window.firebaseDb;

  if (!db) {
    debugError('❌ Firebase check failed:');
    debugError('   window.db:', window.db);
    debugError('   window.firebaseDb:', window.firebaseDb);
    throw new Error('Firebase failed to initialize after 10 seconds');
  }

  debugLog('✅ Firebase is ready!', db);
  return db;
}

// Connect to Strava - Open OAuth popup
export async function connectStrava(userId) {
  try {
    debugLog('🚴 Starting Strava OAuth flow for user:', userId);

    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const authUrl = `/api/strava/authorize?userId=${userId}`;
    debugLog('🚴 Opening popup to:', authUrl);

    const authWindow = window.open(
      authUrl,
      'Strava Authorization',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!authWindow) {
      throw new Error('Popup blocked! Please allow popups for this site.');
    }

    debugLog('🚴 Popup opened, waiting for OAuth callback...');

    // Listen for OAuth callback
    return new Promise((resolve, reject) => {
      debugLog('🎧 Setting up message listener for OAuth callback...');

      const messageHandler = async (event) => {
        debugLog('📬 Message received:', event.data);

        if (event.data.type === 'strava-auth-success') {
          debugLog('✅ Strava auth success message received!');
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);

          const { tokens, userId } = event.data;
          debugLog('💾 Saving tokens for user:', userId);

          // Save tokens to Firestore
          try {
            await saveStravaTokens(userId, tokens);
            debugLog('✅ Tokens saved, resolving promise...');
            resolve(tokens);
          } catch (error) {
            debugError('❌ Error saving tokens:', error);
            reject(error);
          }
        } else {
          debugLog('ℹ️ Ignoring message type:', event.data.type);
        }
      };

      window.addEventListener('message', messageHandler);
      debugLog('✅ Message listener attached');

      // Check if popup was closed
      const checkClosed = setInterval(() => {
        if (authWindow.closed) {
          console.warn('⚠️ Popup was closed by user');
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
          reject(new Error('Authorization cancelled'));
        }
      }, 500);
    });
  } catch (error) {
    debugError('❌ Strava connection error:', error);
    throw error;
  }
}

// Save Strava tokens to Firestore
async function saveStravaTokens(userId, tokens, db) {
  debugLog('💾 saveStravaTokens() called - VERSION 2025.11.14.3');

  try {
    // Wait for Firebase if not passed
    if (!db) {
      debugLog('💾 Waiting for Firebase...');
      db = await waitForFirebase();
    }

    debugLog('💾 Creating doc reference: users/' + userId + '/data/stravaAuth');
    const stravaAuthRef = doc(db, 'users', userId, 'data', 'stravaAuth');

    const dataToSave = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      athlete: tokens.athlete || null,
      connectedAt: new Date().toISOString(),
      lastSync: null,
      updatedAt: new Date().toISOString()
    };

    debugLog('💾 Saving to Firestore...');
    await setDoc(stravaAuthRef, dataToSave);

    debugLog('✅ Strava tokens saved successfully');
  } catch (error) {
    debugError('❌ Error saving Strava tokens:', error);
    throw error;
  }
}

// Load Strava tokens from Firestore
export async function loadStravaTokens(db, userId) {
  try {
    // Wait for Firebase if not passed
    if (!db) {
      db = await waitForFirebase();
    }

    const stravaAuthRef = doc(db, 'users', userId, 'data', 'stravaAuth');
    const docSnap = await getDoc(stravaAuthRef);

    if (docSnap.exists()) {
      return docSnap.data();
    }
    return null;
  } catch (error) {
    debugError('❌ Error loading Strava tokens:', error);
    return null;
  }
}

// Disconnect from Strava
export async function disconnectStrava(db, userId) {
  try {
    // Wait for Firebase if not passed
    if (!db) {
      db = await waitForFirebase();
    }

    const stravaAuthRef = doc(db, 'users', userId, 'data', 'stravaAuth');
    await setDoc(stravaAuthRef, {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      athlete: null,
      connectedAt: null,
      lastSync: null,
      disconnectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    debugLog('✅ Strava disconnected');
    return true;
  } catch (error) {
    debugError('❌ Error disconnecting Strava:', error);
    throw error;
  }
}

// Fetch today's Strava activities
export async function fetchStravaActivities(db, userId) {
  debugLog('🚴 fetchStravaActivities() called with userId:', userId);

  try {
    debugLog('🔍 Loading Strava tokens...');
    const tokens = await loadStravaTokens(db, userId);

    if (!tokens || !tokens.accessToken) {
      debugLog('⚠️ No Strava tokens found');
      return null;
    }

    debugLog('✅ Strava tokens found, accessToken exists:', !!tokens.accessToken);

    // Check cache first (30 minute cache)
    debugLog('🔍 Checking cache...');
    const cached = getCachedStravaData(userId);
    if (cached) {
      debugLog('📦 Using cached Strava data:', cached);
      return cached;
    }

    debugLog('❌ No cache found, fetching from server...');

    // Fetch from server
    debugLog('📡 Calling /api/strava/activities...');
    const response = await fetch('/api/strava/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      })
    });

    debugLog('📡 Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      debugError('❌ Fetch failed:', errorText);
      throw new Error('Failed to fetch Strava activities');
    }

    const data = await response.json();
    debugLog('✅ Strava data received:', data);

    // Wait for Firebase if not passed
    if (!db) {
      db = await waitForFirebase();
    }

    // Update tokens if refreshed
    if (data.newTokens) {
      await saveStravaTokens(userId, data.newTokens, db);
    }

    // Update last sync time
    const stravaAuthRef = doc(db, 'users', userId, 'data', 'stravaAuth');
    await setDoc(stravaAuthRef, {
      ...tokens,
      lastSync: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Cache the data
    cacheStravaData(userId, data);

    debugLog('✅ Strava activities fetched:', data);
    return data;

  } catch (error) {
    debugError('❌ Error fetching Strava activities:', error);
    return null;
  }
}

// Cache Strava data in localStorage (30 min cache) - user-specific
function cacheStravaData(userId, data) {
  try {
    const cacheData = {
      data: data,
      timestamp: Date.now()
    };
    localStorage.setItem(`strava-cache-${userId}`, JSON.stringify(cacheData));
  } catch (error) {
    debugError('Error caching Strava data:', error);
  }
}

// Get cached Strava data if still valid - user-specific
function getCachedStravaData(userId) {
  try {
    const cached = localStorage.getItem(`strava-cache-${userId}`);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    if (Date.now() - timestamp < CACHE_DURATION) {
      return data;
    }

    // Cache expired, remove it
    localStorage.removeItem(`strava-cache-${userId}`);
    return null;
  } catch (error) {
    debugError('Error reading Strava cache:', error);
    return null;
  }
}

// Check if user is connected to Strava
export async function isStravaConnected(db, userId) {
  const tokens = await loadStravaTokens(db, userId);
  return tokens && tokens.accessToken ? true : false;
}
