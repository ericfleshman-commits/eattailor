/* Onboarding Flow Logic */

import { loadSettingsFromFirestore, saveSettingsToFirestore } from './firestore-helpers.js';

/* Debug mode - set to false for production */
const DEBUG_MODE = false;
const debugLog = (...args) => { if (DEBUG_MODE) console.log(...args); };
const debugError = (...args) => { if (DEBUG_MODE) console.error(...args); };

// Macro presets for onboarding (duplicated to avoid circular import issues)
const ONBOARDING_PRESETS = {
  'gym-bro': {
    name: 'Gym Bro',
    icon: '💪',
    calories: 2400,
    protein: 200,
    carbs: 200,
    fat: 80
  },
  'runner': {
    name: 'Runner',
    icon: '🏃',
    calories: 2500,
    protein: 120,
    carbs: 350,
    fat: 70
  },
  'balanced': {
    name: 'Balanced',
    icon: '⚖️',
    calories: 2000,
    protein: 150,
    carbs: 225,
    fat: 65
  },
  'custom': {
    name: 'Custom',
    icon: '✏️',
    calories: 2000,
    protein: 150,
    carbs: 225,
    fat: 65
  }
};

let currentStep = 1;
let selectedPreset = null;
let db, currentUser;
let isOnboardingInitialized = false;

// Check if user is first-time (no settings in Firestore)
export async function checkFirstTimeUser(firestoreDb, user) {
  try {
    debugLog('🔍 [ONBOARDING] ========== CHECKING FIRST TIME USER ==========');
    debugLog('🔍 [ONBOARDING] User ID:', user.uid);
    debugLog('🔍 [ONBOARDING] User email:', user.email);

    // Use user-specific localStorage key
    const localStorageKey = `onboardingCompleted_${user.uid}`;
    const localOnboardingComplete = localStorage.getItem(localStorageKey);
    debugLog('🔍 [ONBOARDING] localStorage key:', localStorageKey);
    debugLog('🔍 [ONBOARDING] localStorage value:', localOnboardingComplete);

    if (localOnboardingComplete === 'true') {
      debugLog('✅ Onboarding already completed (from localStorage for user:', user.uid, ')');
      return false;
    }

    debugLog('🔍 [ONBOARDING] Loading settings from Firestore...');
    const settings = await loadSettingsFromFirestore(firestoreDb, user.uid);
    debugLog('🔍 [ONBOARDING] Settings loaded:', JSON.stringify(settings, null, 2));

    // CRITICAL FIX: Check if settings actually exist in Firestore
    // If loadSettingsFromFirestore returns defaults (no doc exists), then it's a new user
    // We can detect this by checking if updatedAt exists (only present if doc was saved)
    const settingsExistInFirestore = settings.updatedAt !== undefined;

    debugLog('📋 [ONBOARDING CHECK] Settings from Firestore:', settings);
    debugLog('📋 [ONBOARDING CHECK] Settings exist in Firestore?', settingsExistInFirestore);
    debugLog('📋 [ONBOARDING CHECK] onboardingCompleted flag:', settings.onboardingCompleted);

    // User is first-time if:
    // 1. No settings exist in Firestore (new user), OR
    // 2. Settings exist but onboardingCompleted is explicitly false (incomplete onboarding)
    // If settings exist AND onboardingCompleted is true (or undefined for legacy users), skip onboarding
    let isFirstTime;
    if (!settingsExistInFirestore) {
      // No settings at all - definitely first time
      isFirstTime = true;
      debugLog('📋 [ONBOARDING CHECK] No settings in Firestore - first time user');
    } else if (settings.onboardingCompleted === false) {
      // Settings exist but onboarding explicitly marked incomplete
      isFirstTime = true;
      debugLog('📋 [ONBOARDING CHECK] onboardingCompleted is false - show onboarding');
    } else if (settings.onboardingCompleted === true) {
      // Explicitly completed onboarding
      isFirstTime = false;
      debugLog('📋 [ONBOARDING CHECK] onboardingCompleted is true - skip onboarding');
    } else {
      // Legacy user: settings exist but no onboardingCompleted field
      // Assume they're a returning user and skip onboarding
      isFirstTime = false;
      debugLog('📋 [ONBOARDING CHECK] Legacy user (no flag) - skip onboarding');

      // AUTOMATICALLY ADD THE FLAG to their settings so this check is faster next time
      debugLog('📋 [ONBOARDING CHECK] Auto-adding onboardingCompleted flag for legacy user');
      settings.onboardingCompleted = true;
      try {
        await saveSettingsToFirestore(firestoreDb, user.uid, settings);
        debugLog('✅ [ONBOARDING CHECK] Successfully added onboardingCompleted flag to Firestore');
      } catch (error) {
        debugError('❌ [ONBOARDING CHECK] Failed to add onboardingCompleted flag:', error);
      }
    }

    debugLog('📋 [ONBOARDING CHECK] Is first time?', isFirstTime);

    // Cache the result in localStorage for iOS Safari (user-specific)
    if (!isFirstTime) {
      localStorage.setItem(localStorageKey, 'true');
      debugLog('✅ Cached onboarding completion for user:', user.uid);
    }

    return isFirstTime;
  } catch (error) {
    debugError('❌ Error checking first-time user:', error);
    // Check localStorage as fallback (user-specific)
    const localStorageKey = `onboardingCompleted_${user.uid}`;
    const localOnboardingComplete = localStorage.getItem(localStorageKey);
    if (localOnboardingComplete === 'true') {
      debugLog('✅ Using localStorage fallback - onboarding completed for user:', user.uid);
      return false;
    }
    return true; // Show onboarding if both checks fail
  }
}

// Show onboarding overlay
export function showOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  overlay.style.display = 'flex';

  // Add onboarding-active class
  document.body.classList.add('onboarding-active');

  // CRITICAL: Force body to allow scrolling
  document.body.style.overflow = 'auto';
  document.body.style.position = 'static';
  document.body.style.width = 'auto';
  document.body.style.height = 'auto';

  debugLog('✅ Onboarding overlay shown');
  debugLog('✅ Body classes:', document.body.className);
  debugLog('✅ Body overflow:', window.getComputedStyle(document.body).overflow);
  debugLog('✅ Body position:', window.getComputedStyle(document.body).position);
}

// Hide onboarding overlay
function hideOnboarding() {
  document.getElementById('onboardingOverlay').style.display = 'none';
  document.body.classList.remove('onboarding-active');
  debugLog('✅ Onboarding overlay hidden');
}

// Initialize onboarding flow
export function initOnboarding(firestoreDb, user) {
  // Prevent duplicate initialization that causes event listener stacking
  if (isOnboardingInitialized) {
    debugLog('⚠️ Onboarding already initialized, skipping...');
    return;
  }
  isOnboardingInitialized = true;

  db = firestoreDb;
  currentUser = user;

  // Reset to step 1
  currentStep = 1;
  selectedPreset = null;
  updateStepDisplay();

  // Step 1: Preset card selection
  const presetCards = document.querySelectorAll('.onboarding-preset');
  debugLog('🎯 [ONBOARDING] Found preset cards:', presetCards.length);

  presetCards.forEach((card, index) => {
    debugLog(`🎯 [ONBOARDING] Attaching listener to card ${index}:`, card.dataset.preset);

    // Try both click and touchend for iOS
    const handleClick = (e) => {
      debugLog('🎯 [ONBOARDING] ========== CARD CLICKED ==========');
      debugLog('🎯 [ONBOARDING] Event type:', e.type);
      debugLog('🎯 [ONBOARDING] Target:', e.target);
      debugLog('🎯 [ONBOARDING] Current target:', e.currentTarget);
      e.preventDefault();
      e.stopPropagation();
      const preset = card.dataset.preset;
      debugLog('🎯 [ONBOARDING] Preset from dataset:', preset);
      handlePresetSelection(card, preset);
    };

    card.addEventListener('click', handleClick, { passive: false });
    card.addEventListener('touchend', handleClick, { passive: false });
    debugLog(`🎯 [ONBOARDING] ✅ Listeners attached to card ${index}`);
  });

  // Step 1: Next button (with touch support for iOS)
  const step1NextBtn = document.getElementById('onboardingStep1NextBtn');
  const handleStep1Next = (e) => {
    e.preventDefault();
    if (selectedPreset) {
      goToStep(2);
    }
  };
  step1NextBtn.addEventListener('click', handleStep1Next);
  step1NextBtn.addEventListener('touchend', handleStep1Next);

  // Step 2: Back button
  const step2BackBtn = document.getElementById('onboardingStep2BackBtn');
  const handleStep2Back = (e) => { e.preventDefault(); goToStep(1); };
  step2BackBtn.addEventListener('click', handleStep2Back);
  step2BackBtn.addEventListener('touchend', handleStep2Back);

  // Step 2: Next button
  const step2NextBtn = document.getElementById('onboardingStep2NextBtn');
  const handleStep2Next = (e) => { e.preventDefault(); goToStep(3); };
  step2NextBtn.addEventListener('click', handleStep2Next);
  step2NextBtn.addEventListener('touchend', handleStep2Next);

  // Step 3: Back button
  const step3BackBtn = document.getElementById('onboardingStep3BackBtn');
  const handleStep3Back = (e) => { e.preventDefault(); goToStep(2); };
  step3BackBtn.addEventListener('click', handleStep3Back);
  step3BackBtn.addEventListener('touchend', handleStep3Back);

  // Step 3: Skip button
  const skipBtn = document.getElementById('onboardingSkipBtn');
  const handleSkip = async (e) => { e.preventDefault(); await completeOnboarding(true); };
  skipBtn.addEventListener('click', handleSkip);
  skipBtn.addEventListener('touchend', handleSkip);

  // Step 3: Finish button
  const finishBtn = document.getElementById('onboardingFinishBtn');
  const handleFinish = async (e) => { e.preventDefault(); await completeOnboarding(false); };
  finishBtn.addEventListener('click', handleFinish);
  finishBtn.addEventListener('touchend', handleFinish);

  // Character counter for dietary preferences
  const dietaryTextarea = document.getElementById('onboardingDietaryInfo');
  const charCount = document.getElementById('onboardingCharCount');

  dietaryTextarea.addEventListener('input', () => {
    charCount.textContent = dietaryTextarea.value.length;
  });

  debugLog('✅ Onboarding initialized');
}

// Handle preset card selection
function handlePresetSelection(cardElement, presetKey) {
  debugLog('🎯 [ONBOARDING] handlePresetSelection called');
  debugLog('🎯 [ONBOARDING] Card element:', cardElement);
  debugLog('🎯 [ONBOARDING] Preset key:', presetKey);

  selectedPreset = presetKey;
  const preset = ONBOARDING_PRESETS[presetKey];

  debugLog('✅ Preset selected:', preset.name);

  // Update UI: highlight selected card
  document.querySelectorAll('.onboarding-preset').forEach(card => {
    card.classList.remove('onboarding-preset--selected');
  });
  cardElement.classList.add('onboarding-preset--selected');

  // Enable Step 1 Next button
  const nextBtn = document.getElementById('onboardingStep1NextBtn');
  debugLog('🎯 [ONBOARDING] Next button before:', nextBtn);
  debugLog('🎯 [ONBOARDING] Next button disabled?', nextBtn.disabled);
  nextBtn.disabled = false;
  debugLog('🎯 [ONBOARDING] Next button after enabling:', nextBtn.disabled);
  debugLog('🎯 [ONBOARDING] Next button visible?', window.getComputedStyle(nextBtn).display);
  debugLog('🎯 [ONBOARDING] Next button z-index:', window.getComputedStyle(nextBtn).zIndex);

  // Pre-fill Step 2 inputs with selected preset values
  document.getElementById('onboardingCalories').value = preset.calories;
  document.getElementById('onboardingProtein').value = preset.protein;
  document.getElementById('onboardingCarbs').value = preset.carbs;
  document.getElementById('onboardingFat').value = preset.fat;

  debugLog('🎯 [ONBOARDING] Preset selection complete');
}

// Go to specific step
function goToStep(stepNumber) {
  currentStep = stepNumber;
  updateStepDisplay();
}

// Update step display and progress bar
function updateStepDisplay() {
  // Update progress text
  document.getElementById('onboardingProgressText').textContent = `Step ${currentStep} of 3`;

  // Update progress bar
  const progressFill = document.getElementById('onboardingProgressFill');
  const progressPercent = (currentStep / 3) * 100;
  progressFill.style.width = `${progressPercent}%`;

  // Show/hide steps
  document.querySelectorAll('.onboarding-step').forEach(step => {
    step.classList.remove('onboarding-step--active');
  });
  const activeStep = document.querySelector(`[data-step="${currentStep}"]`);
  if (activeStep) {
    activeStep.classList.add('onboarding-step--active');
  }

  debugLog(`✅ Now on step ${currentStep}`);
}

// Complete onboarding and save to Firestore
async function completeOnboarding(skipDietaryInfo) {
  try {
    // Gather macro values from Step 2 inputs
    const macroGoals = {
      calories: parseInt(document.getElementById('onboardingCalories').value) || 2000,
      protein: parseInt(document.getElementById('onboardingProtein').value) || 150,
      carbs: parseInt(document.getElementById('onboardingCarbs').value) || 225,
      fat: parseInt(document.getElementById('onboardingFat').value) || 65
    };

    // Gather dietary preferences (empty if skipped)
    const dietaryInfo = skipDietaryInfo ? '' : document.getElementById('onboardingDietaryInfo').value.trim();

    // Build settings object
    const settings = {
      profile: {
        name: '',
        weight: null,
        height: null,
        goal: 'maintain'
      },
      macroGoals: macroGoals,
      aiPreferences: {
        dietaryInfo: dietaryInfo
      },
      onboardingCompleted: true
    };

    // Save to Firestore
    await saveSettingsToFirestore(db, currentUser.uid, settings);

    // Store onboarding completion in localStorage for iOS Safari (user-specific)
    const localStorageKey = `onboardingCompleted_${currentUser.uid}`;
    localStorage.setItem(localStorageKey, 'true');
    debugLog('✅ Saved onboarding completion to localStorage for user:', currentUser.uid);

    // Store AI preferences globally
    window.userAIPreferences = dietaryInfo;

    debugLog('✅ Onboarding complete, settings saved:', settings);

    // Show success toast
    showSuccessToast();

    // Hide onboarding after 1.5 seconds and reload
    setTimeout(() => {
      hideOnboarding();
      window.location.reload();
    }, 1500);

  } catch (error) {
    debugError('❌ Error completing onboarding:', error);
    alert('Failed to save settings. Please try again.');
  }
}

// Show success toast notification
function showSuccessToast() {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'onboarding-toast';
  toast.textContent = '✅ Setup complete! Welcome to EatTailor';

  // Add toast styles
  toast.style.position = 'fixed';
  toast.style.bottom = '32px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = '#51cf66';
  toast.style.color = '#0f1115';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '10px';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '14px';
  toast.style.zIndex = '10001';
  toast.style.animation = 'fadeIn 0.3s ease-out';

  document.body.appendChild(toast);

  // Remove after 2 seconds
  setTimeout(() => {
    toast.remove();
  }, 2000);
}
