// ============================================================
// FIREBASE-CONFIG.JS
// Inserisci qui le credenziali del tuo progetto Firebase.
// Le trovi in: Firebase Console → Impostazioni progetto → Le tue app → SDK config
// ============================================================

// ⚠️  DA COMPLETARE con i tuoi dati Firebase
const firebaseConfig = {
  apiKey:            "AIzaSyDxwnqouHo_t8mNaOGQDEqbcRdd-Buvi5w",
authDomain:        "strategica-mns.firebaseapp.com",
projectId:         "strategica-mns",
storageBucket:     "strategica-mns.firebasestorage.app",
messagingSenderId: "546507455703",
appId:             "1:546507455703:web:3a8ac23a6b90853e2d4492"
}

// Inizializzazione Firebase (SDK v9 compat)
firebase.initializeApp(firebaseConfig)

// Istanza Firestore — usala in tutti i moduli
export const db = firebase.firestore()

// Shortcut collezioni
export const collections = {
  contratti:   () => db.collection('contratti'),
  rate:        () => db.collection('rate'),        // Piano pagamenti contratti
  movimenti:   () => db.collection('movimenti'),
  conti:       () => db.collection('conti'),
  costi:       () => db.collection('costi'),
  provvigioni: () => db.collection('provvigioni'),
  soci:        () => db.collection('soci'),
  compensi:    () => db.collection('compensi')
}

// Utility Firestore
export const FieldValue = firebase.firestore.FieldValue
export const Timestamp  = firebase.firestore.Timestamp

// Converti data JS in Timestamp Firestore
export function toTimestamp(dateStr) {
  if (!dateStr) return null
  return Timestamp.fromDate(new Date(dateStr))
}
