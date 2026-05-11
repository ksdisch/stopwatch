// Firebase web client config for Tempo cloud sync (PR S0-1).
//
// PUBLIC client config — safe to commit per Firebase security model.
// Security enforcement lives in firestore.rules (per-user UID
// isolation; request.auth.uid == userId). The apiKey identifies
// the project, it does not grant access.
//
// This file is loaded passively — assigning to window.FirebaseConfig
// has no side effects on load. The auth wire-up in B-2 reads
// window.FirebaseConfig and initializes the SDK when the user
// enables cloud sync. Not yet referenced from index.html.
window.FirebaseConfig = {
  apiKey: "AIzaSyCzp2nWV-TSyZCGXga60mcJuu6mNrQLOPU",
  authDomain: "tempo-sync-6f7b2.firebaseapp.com",
  projectId: "tempo-sync-6f7b2",
  storageBucket: "tempo-sync-6f7b2.firebasestorage.app",
  messagingSenderId: "66959649115",
  appId: "1:66959649115:web:4cb4503bb0e8434f2f127e",
  measurementId: "G-QY51PWQDCR"
};
