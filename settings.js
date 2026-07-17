/* Settings Modal Logic */

/* Debug mode - set to false for production */
const DEBUG_MODE = false;
const debugLog = (...args) => { if (DEBUG_MODE) console.log(...args); };
const debugError = (...args) => { if (DEBUG_MODE) console.error(...args); };

// Macro presets
const MACRO_PRESETS = {
  'gym-bro': {
    calories: 2400,
    protein: 200,
    carbs: 200,
    fat: 80
  },
  'runner': {
    calories: 2500,
    protein: 120,
    carbs: 350,
    fat: 70
  },
  'balanced': {
    calories: 2000,
    protein: 150,
    carbs: 225,
    fat: 65
  },
  'custom': {
    calories: 2000,
    protein: 150,
    carbs: 225,
    fat: 65
  }
};

// Export for use in app.js
export { MACRO_PRESETS };

// Track if settings have been modified
let hasUnsavedChanges = false;
let originalSettings = null;
let isLoading = false; // Flag to prevent marking changes during load

// Mark settings as changed
function markAsChanged() {
  if (!isLoading) {
    hasUnsavedChanges = true;
  }
}

// Initialize settings modal
export function initSettingsModal(db, currentUser) {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsModal = document.getElementById('closeSettingsModal');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');

  // Ensure modal is hidden on init
  if (settingsModal) {
    settingsModal.style.display = 'none';
    debugLog('✅ Settings modal initialized as hidden');
  }

  // Tab switching
  const tabButtons = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.settings-panel');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;

      debugLog('⚙️ [SETTINGS] Tab clicked:', tabName);

      // Update active tab
      tabButtons.forEach(btn => btn.classList.remove('settings-tab--active'));
      button.classList.add('settings-tab--active');

      // Update active panel
      panels.forEach(panel => panel.classList.remove('settings-panel--active'));
      document.querySelector(`[data-panel="${tabName}"]`).classList.add('settings-panel--active');

      // If History tab, render weekly summary
      debugLog('⚙️ [SETTINGS] Checking if History tab...');
      debugLog('⚙️ [SETTINGS] tabName === "history"?', tabName === 'history');
      debugLog('⚙️ [SETTINGS] window.renderWeeklySummaryInSettings exists?', !!window.renderWeeklySummaryInSettings);
      debugLog('⚙️ [SETTINGS] window.renderWeeklySummaryInSettings:', window.renderWeeklySummaryInSettings);

      if (tabName === 'history') {
        debugLog('🚨 [SETTINGS] HISTORY TAB DETECTED - Attempting to call render function...');
        if (window.renderWeeklySummaryInSettings) {
          debugLog('🚨 [SETTINGS] Calling window.renderWeeklySummaryInSettings()...');
          window.renderWeeklySummaryInSettings();
          debugLog('🚨 [SETTINGS] ✅ Function call completed');
        } else {
          debugError('❌ [SETTINGS] window.renderWeeklySummaryInSettings is NOT DEFINED!');
        }
      }
    });
  });

  // Preset buttons
  const presetButtons = document.querySelectorAll('.preset-btn');
  presetButtons.forEach(button => {
    button.addEventListener('click', () => {
      const preset = button.dataset.preset;
      const values = MACRO_PRESETS[preset];

      document.getElementById('macroCalories').value = values.calories;
      document.getElementById('macroProtein').value = values.protein;
      document.getElementById('macroCarbs').value = values.carbs;
      document.getElementById('macroFat').value = values.fat;

      markAsChanged(); // Mark as changed when preset selected
    });
  });

  // AI preferences character count
  const aiPreferencesTextarea = document.getElementById('aiPreferences');
  const charCount = document.getElementById('aiCharCount');

  aiPreferencesTextarea.addEventListener('input', () => {
    charCount.textContent = aiPreferencesTextarea.value.length;
    markAsChanged();
  });

  // Track changes on all form inputs
  const formInputs = [
    'settingsName', 'settingsWeight', 'settingsHeight', 'settingsGoal',
    'macroCalories', 'macroProtein', 'macroCarbs', 'macroFat', 'aiPreferences'
  ];

  formInputs.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', markAsChanged);
      input.addEventListener('change', markAsChanged);
    }
  });

  // Open modal
  settingsBtn.addEventListener('click', async () => {
    debugLog('🔧 ========== SETTINGS BUTTON CLICKED ==========');
    debugLog('🔧 User agent:', navigator.userAgent);
    debugLog('🔧 Window width:', window.innerWidth);
    debugLog('🔧 Is mobile?', window.innerWidth <= 768);

    const modal = document.getElementById('settingsModal');
    debugLog('🔧 Modal element:', modal);
    debugLog('🔧 Modal exists?', !!modal);

    if (!modal) {
      debugError('❌ CRITICAL: settingsModal element not found in DOM!');
      return;
    }

    await loadSettings(db, currentUser);
    hasUnsavedChanges = false; // Reset after loading

    // Show modal with forced visibility for mobile
    debugLog('🔧 Setting modal display to flex...');
    modal.style.display = 'flex';

    // Force visibility on mobile with !important overrides
    if (window.innerWidth <= 768) {
      debugLog('📱 Mobile detected, applying force overrides...');
      modal.style.setProperty('display', 'flex', 'important');
      modal.style.setProperty('position', 'fixed', 'important');
      modal.style.setProperty('z-index', '99999', 'important');
      modal.style.setProperty('visibility', 'visible', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      modal.style.setProperty('top', '0', 'important');
      modal.style.setProperty('left', '0', 'important');
      modal.style.setProperty('width', '100vw', 'important');
      modal.style.setProperty('height', '100vh', 'important');
    }

    debugLog('🔧 After setting display:');
    debugLog('🔧 Modal display:', window.getComputedStyle(modal).display);
    debugLog('🔧 Modal visibility:', window.getComputedStyle(modal).visibility);
    debugLog('🔧 Modal opacity:', window.getComputedStyle(modal).opacity);
    debugLog('🔧 Modal z-index:', window.getComputedStyle(modal).zIndex);
    debugLog('🔧 Modal position:', window.getComputedStyle(modal).position);
    debugLog('🔧 Modal top:', window.getComputedStyle(modal).top);
    debugLog('🔧 Modal left:', window.getComputedStyle(modal).left);
    debugLog('🔧 Modal width:', window.getComputedStyle(modal).width);
    debugLog('🔧 Modal height:', window.getComputedStyle(modal).height);
    debugLog('🔧 ========== MODAL SHOULD BE VISIBLE NOW ==========');
  });

  // Close modal with unsaved changes check
  const closeModal = async () => {
    debugLog('🔧 closeModal() called');
    if (hasUnsavedChanges) {
      const confirmClose = await window.showConfirmModal(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to close without saving?'
      );
      if (!confirmClose) {
        debugLog('🔧 User cancelled close');
        return;
      }
    }
    debugLog('🔧 Hiding modal...');
    settingsModal.style.display = 'none';
    hasUnsavedChanges = false;
    debugLog('🔧 Modal hidden, display:', window.getComputedStyle(settingsModal).display);
  };

  closeSettingsModal.addEventListener('click', (e) => {
    debugLog('🔧 Close button clicked');
    e.preventDefault();
    e.stopPropagation();
    closeModal();
  });

  // Close on outside click (both click and touch events for mobile)
  settingsModal.addEventListener('click', (e) => {
    debugLog('🔧 Modal clicked:', e.target);
    debugLog('🔧 Is backdrop?', e.target === settingsModal);
    if (e.target === settingsModal) {
      debugLog('🔧 Closing modal via backdrop click');
      closeModal();
    }
  });

  settingsModal.addEventListener('touchend', (e) => {
    debugLog('🔧 Modal touched:', e.target);
    if (e.target === settingsModal) {
      debugLog('🔧 Closing modal via backdrop touch');
      e.preventDefault();
      closeModal();
    }
  }, { passive: false });

  // Save settings
  saveSettingsBtn.addEventListener('click', async () => {
    debugLog('🔧 Save settings button clicked');
    await saveSettings(db, currentUser);
    hasUnsavedChanges = false; // Reset after saving
    debugLog('🔧 Closing modal after save...');
    settingsModal.style.display = 'none';
    debugLog('🔧 Modal closed');
  });

  // Sidebar logout button
  sidebarLogoutBtn.addEventListener('click', () => {
    if (window.logout) {
      window.logout();
    }
  });
}

// Load settings from Firestore
async function loadSettings(db, currentUser) {
  try {
    isLoading = true; // Disable change tracking during load

    const { loadSettingsFromFirestore } = await import('./firestore-helpers.js');
    const settings = await loadSettingsFromFirestore(db, currentUser.uid);

    // Populate profile fields
    document.getElementById('settingsName').value = settings.profile?.name || '';
    document.getElementById('settingsEmail').value = currentUser.email || '';
    document.getElementById('settingsWeight').value = settings.profile?.weight || '';
    document.getElementById('settingsHeight').value = settings.profile?.height || '';
    document.getElementById('settingsGoal').value = settings.profile?.goal || 'maintain';

    // Populate macro fields
    document.getElementById('macroCalories').value = settings.macroGoals?.calories || 2000;
    document.getElementById('macroProtein').value = settings.macroGoals?.protein || 150;
    document.getElementById('macroCarbs').value = settings.macroGoals?.carbs || 225;
    document.getElementById('macroFat').value = settings.macroGoals?.fat || 65;
    document.getElementById('adjustForActivity').checked = settings.macroGoals?.adjustForActivity !== false; // Default to true

    // Populate AI preferences
    const aiPrefs = settings.aiPreferences?.dietaryInfo || '';
    document.getElementById('aiPreferences').value = aiPrefs;
    document.getElementById('aiCharCount').textContent = aiPrefs.length;

    // Load Strava connection status
    await loadStravaConnectionStatus(db, currentUser);

    debugLog('✅ Settings loaded');
  } catch (error) {
    debugError('❌ Error loading settings:', error);
  } finally {
    isLoading = false; // Re-enable change tracking
  }
}

// Load and display Strava connection status
async function loadStravaConnectionStatus(db, currentUser) {
  try {
    const { isStravaConnected, loadStravaTokens } = await import('./strava-integration.js');
    const connected = await isStravaConnected(db, currentUser.uid);
    const statusContainer = document.getElementById('stravaConnectionStatus');

    if (connected) {
      const tokens = await loadStravaTokens(db, currentUser.uid);
      const lastSync = tokens.lastSync ? new Date(tokens.lastSync).toLocaleString() : 'Never';

      statusContainer.innerHTML = `
        <div class="strava-status">
          <div class="strava-status__info">
            <div class="strava-status__connected">✓ Connected to Strava</div>
            <div class="strava-status__lastSync">Last sync: ${lastSync}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="refreshStravaBtn" class="strava-btn" style="background: #fc4c02;">Refresh Data</button>
            <button id="disconnectStravaBtn" class="strava-btn strava-btn--disconnect">Disconnect</button>
          </div>
        </div>
      `;

      // Add refresh handler
      document.getElementById('refreshStravaBtn').addEventListener('click', async () => {
        try {
          // Clear cache to force fresh fetch (user-specific)
          localStorage.removeItem(`strava-cache-${currentUser.uid}`);
          debugLog('🔄 Cache cleared, reloading page to fetch fresh Strava data...');

          // Reload page to fetch fresh data
          window.location.reload();
        } catch (error) {
          debugError('Failed to refresh Strava data:', error);
          alert('Failed to refresh Strava data. Please try again.');
        }
      });

      // Add disconnect handler
      document.getElementById('disconnectStravaBtn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to disconnect Strava?')) {
          const { disconnectStrava } = await import('./strava-integration.js');
          await disconnectStrava(db, currentUser.uid);
          await loadStravaConnectionStatus(db, currentUser);

          // Clear cache and reload to use mock data (user-specific)
          localStorage.removeItem(`strava-cache-${currentUser.uid}`);
          window.location.reload();
        }
      });
    } else {
      statusContainer.innerHTML = `
        <button id="connectStravaBtn" class="strava-btn">
          <span>🚴</span>
          <span>Connect Strava</span>
        </button>
        <p style="margin-top:8px; font-size:12px; color:var(--muted);">
          Connect your Strava account to automatically adjust your macro targets based on your workouts.
        </p>
      `;

      // Add connect handler
      document.getElementById('connectStravaBtn').addEventListener('click', async () => {
        try {
          const { connectStrava } = await import('./strava-integration.js');
          await connectStrava(currentUser.uid);

          // Clear Strava cache to force fresh data fetch (user-specific)
          localStorage.removeItem(`strava-cache-${currentUser.uid}`);

          await loadStravaConnectionStatus(db, currentUser);

          // Reload to fetch fresh Strava data
          window.location.reload();
        } catch (error) {
          debugError('Failed to connect Strava:', error);
          alert('Failed to connect to Strava. Please try again.');
        }
      });
    }
  } catch (error) {
    debugError('❌ Error loading Strava status:', error);
  }
}

// Save settings to Firestore
async function saveSettings(db, currentUser) {
  try {
    const { saveSettingsToFirestore } = await import('./firestore-helpers.js');

    const settings = {
      profile: {
        name: document.getElementById('settingsName').value.trim(),
        weight: parseFloat(document.getElementById('settingsWeight').value) || null,
        height: parseFloat(document.getElementById('settingsHeight').value) || null,
        goal: document.getElementById('settingsGoal').value
      },
      macroGoals: {
        calories: parseInt(document.getElementById('macroCalories').value) || 2000,
        protein: parseInt(document.getElementById('macroProtein').value) || 150,
        carbs: parseInt(document.getElementById('macroCarbs').value) || 225,
        fat: parseInt(document.getElementById('macroFat').value) || 65,
        adjustForActivity: document.getElementById('adjustForActivity').checked
      },
      aiPreferences: {
        dietaryInfo: document.getElementById('aiPreferences').value.trim()
      }
    };

    await saveSettingsToFirestore(db, currentUser.uid, settings);

    // Store AI preferences globally for chat
    window.userAIPreferences = settings.aiPreferences.dietaryInfo;

    // Update the Daily Goals display in sidebar
    updateDailyGoalsDisplay(settings.macroGoals);

    debugLog('✅ Settings saved:', settings);
  } catch (error) {
    debugError('❌ Error saving settings:', error);
    alert('Failed to save settings. Please try again.');
  }
}

// Update Daily Goals display in sidebar
function updateDailyGoalsDisplay(macroGoals) {
  const dailyGoalsSection = document.querySelector('.daily-goals');
  if (!dailyGoalsSection) return;

  const rows = dailyGoalsSection.querySelectorAll('.daily-goals__row');
  if (rows.length >= 4) {
    rows[0].querySelector('.daily-goals__value').textContent = `${macroGoals.calories} kcal`;
    rows[1].querySelector('.daily-goals__value').textContent = `${macroGoals.protein} g`;
    rows[2].querySelector('.daily-goals__value').textContent = `${macroGoals.carbs} g`;
    rows[3].querySelector('.daily-goals__value').textContent = `${macroGoals.fat} g`;
  }

  debugLog('✅ Daily goals display updated');
}

// Load AI preferences on app start
export async function loadAIPreferences(db, currentUser) {
  try {
    const { loadSettingsFromFirestore } = await import('./firestore-helpers.js');
    const settings = await loadSettingsFromFirestore(db, currentUser.uid);
    window.userAIPreferences = settings.aiPreferences?.dietaryInfo || '';

    // Also load and display macro goals
    if (settings.macroGoals) {
      updateDailyGoalsDisplay(settings.macroGoals);
    }

    debugLog('✅ AI preferences loaded:', window.userAIPreferences ? 'Yes' : 'No');
  } catch (error) {
    debugError('❌ Error loading AI preferences:', error);
    window.userAIPreferences = '';
  }
}
