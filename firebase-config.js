// ─────────────────────────────────────────────────────────────
// SPAR Malta Hub — Firebase settings
//
// Replace the placeholder values below with the ones Firebase gives
// you (Firebase console → Project settings → Your apps → Web app →
// "SDK setup and configuration" → Config). See SETUP.md, step 3.
//
// These values are NOT secret — they only identify your project.
// The real protection is the login plus the database rules
// (firestore.rules).
// ─────────────────────────────────────────────────────────────
window.SPAR_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAJGn2Q8-5-BqS80BRgheNUbc-ingJZSRQ",
  authDomain: "spar-rom-hub.firebaseapp.com",
  projectId: "spar-rom-hub",
  storageBucket: "spar-rom-hub.firebasestorage.app",
  messagingSenderId: "696277361289",
  appId: "1:696277361289:web:987a5645c04f912f001c58"
};

// Where DAP photos and files are uploaded (the "SPAR DAP email" Google script,
// deployed as a Web app). Files are saved in the sparmaltahub Google Drive.
window.SPAR_UPLOAD_URL = "https://script.google.com/macros/s/AKfycbxIQikUA6DR6pH8LCMuMlxfLtFx3coV1U1sxH-wZtVPyEKEjIpVNysAW_A6o_Q_k6p-ew/exec";
