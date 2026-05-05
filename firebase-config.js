// Firebase web SDK config for Tempo cloud sync.
//
// Safe to commit and serve publicly: Firebase API keys identify the
// project, not authenticate access. Real authorization is enforced by
// firestore.rules (per-user data isolation via request.auth.uid == uid).
//
// SETUP — fill in the values from your Firebase project before first use:
//   1. https://console.firebase.google.com → create project (or pick existing)
//   2. Project settings → "Your apps" → Add Web app → register app
//   3. Copy the firebaseConfig object below from the console
//   4. Authentication → Sign-In method → enable Apple + Google
//   5. Firestore Database → Create database → Native mode → pick region
//   6. (Optional) Firebase CLI: `firebase deploy --only firestore:rules`
//
// Until this file is filled in, Cloud sync is hard-disabled at runtime —
// `js/cloud/firebase-init.js` checks for the placeholder string below and
// short-circuits without booting the SDK. The app behaves identically to
// pre-cloud-sync builds.

window.TEMPO_FIREBASE_CONFIG = {
  apiKey:            'PASTE_API_KEY_FROM_FIREBASE_CONSOLE',
  authDomain:        'PASTE_PROJECT_ID.firebaseapp.com',
  projectId:         'PASTE_PROJECT_ID',
  storageBucket:     'PASTE_PROJECT_ID.appspot.com',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId:             'PASTE_APP_ID',
};
