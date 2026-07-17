/*
 * FIREBASE CONFIGURATION
 *
 * TO SET UP:
 * 1. Go to https://console.firebase.google.com/
 * 2. Select your project (or create new one)
 * 3. Click the gear icon (Project Settings)
 * 4. Scroll down to "Your apps" section
 * 5. Click the </> (Web) icon to add a web app
 * 6. Copy the firebaseConfig object
 * 7. Paste your values below (replace the PASTE_YOUR_XXX_HERE values)
 *
 * SECURITY NOTE: These values are safe to expose in client-side code.
 * The actual security is handled by Firestore Security Rules.
 */

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE"
};

// Initialize Firebase (will be done in auth.js)
export { firebaseConfig };
