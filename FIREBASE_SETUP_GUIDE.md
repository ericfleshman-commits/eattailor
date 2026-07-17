# Firebase Setup Guide for NutriTrack

## Step 1: Create Firebase Project

1. Go to https://console.firebase.google.com/
2. Click "Add project" (or select existing project)
3. Enter project name (e.g., "nutritrack")
4. Disable Google Analytics (optional, not needed for this app)
5. Click "Create project"

## Step 2: Enable Email/Password Authentication

1. In Firebase Console, click "Authentication" in left sidebar
2. Click "Get started"
3. Click "Email/Password" in the Sign-in method tab
4. Toggle "Enable" to ON
5. Click "Save"

## Step 3: Create Firestore Database

1. In Firebase Console, click "Firestore Database" in left sidebar
2. Click "Create database"
3. Select "Start in **test mode**" (we'll add security rules later)
4. Choose your region (closest to your users)
5. Click "Enable"

## Step 4: Get Your Firebase Config

1. In Firebase Console, click the gear icon ⚙️ (Project Settings)
2. Scroll down to "Your apps" section
3. Click the `</>` (Web) icon
4. Register app nickname (e.g., "nutritrack-web")
5. **DO NOT** check "Set up Firebase Hosting"
6. Click "Register app"
7. You'll see a `firebaseConfig` object that looks like:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456:web:abc123"
};
```

8. **COPY THIS ENTIRE OBJECT**

## Step 5: Add Config to Your App

### Option A: Update auth.html

1. Open `auth.html` in your editor
2. Find this section (around line 95):

```javascript
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  // ... etc
};
```

3. Replace the placeholder values with YOUR values from Step 4

### Option B: Update index.html (coming next)

Same process - replace the placeholder config values

## Step 6: Set Up Firestore Security Rules (IMPORTANT!)

1. In Firebase Console, go to "Firestore Database"
2. Click the "Rules" tab
3. Replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow users to read/write only their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click "Publish"

**This is CRITICAL for security!** It ensures users can only access their own data.

## Step 7: Test Your Setup

1. Open `auth.html` in your browser
2. Try creating an account with email/password
3. Check Firebase Console → Authentication → Users to see if account was created
4. Try logging in with those credentials

## Troubleshooting

### Error: "Firebase: Error (auth/configuration-not-found)"
- You forgot to replace the placeholder config values
- Go back to Step 5

### Error: "auth/operation-not-allowed"
- Email/Password auth is not enabled
- Go back to Step 2

### Error: "Missing or insufficient permissions"
- Firestore security rules are too restrictive or not set up
- Go back to Step 6

### Can't see Firestore data
- Check Firestore console → Data tab
- Data will appear under: `users/{userId}/...`

## What's Next

After you've added your Firebase config:
1. The auth system will work
2. Users can sign up / log in
3. Next step: Update `index.html` to check for authentication
4. Then: Replace localStorage with Firestore

## Security Note

**Your Firebase config values (apiKey, projectId, etc.) are safe to expose in client-side code.**

The actual security comes from:
1. Firestore Security Rules (Step 6)
2. Authentication (users must be logged in)
3. Rules that check `request.auth.uid` matches the data owner

Don't worry about committing these values to Git - they're meant to be public!
