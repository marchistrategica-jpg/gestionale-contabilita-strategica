// ============================================================
// FIREBASE-CONFIG.JS
// Inserisci qui le credenziali del tuo progetto Firebase.
// Le trovi in: Firebase Console → Impostazioni progetto → Le tue app → SDK config
// ============================================================

// ⚠️  DA COMPLETARE con i tuoi dati Firebase
const firebaseConfig = {
  apiKey:            "INSERISCI-API-KEY",
  authDomain:        "INSERISCI-AUTH-DOMAIN",
  projectId:         "INSERISCI-PROJECT-ID",
  storageBucket:     "INSERISCI-STORAGE-BUCKET",
  messagingSenderId: "INSERISCI-SENDER-ID",
  appId:             "INSERISCI-APP-ID"
}

// Inizializzazione Firebase (SDK v9 compat)
firebase.initializeApp(firebaseConfig)

// Istanza Firestore — usala in tutti i moduli
export const db = firebase.firestore()

// Shortcut collezioni
export const collections = {
  contratti:   () => db.collection('contratti'),
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
