// ============================================================
// SEED.JS — Crea l'intera struttura del database Firebase
//
// COME USARLO (una volta sola):
// 1. Apri il terminale nella cartella del progetto
// 2. Lancia: node firebase/seed.js
//
// ⚠️  Richiede Node.js e firebase-admin installato:
//     npm install firebase-admin
// ⚠️  Scarica la tua Service Account Key da:
//     Firebase Console → Impostazioni progetto → Account di servizio
//     → Genera nuova chiave privata → salva come firebase/serviceAccount.json
// ============================================================

const admin = require('firebase-admin')
const serviceAccount = require('./serviceAccount.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

// ---- Dati iniziali ----

const SOCI = [
  { nome: 'Socio 1', quota_percentuale: 50, email: 'socio1@esempio.com' },
  { nome: 'Socio 2', quota_percentuale: 50, email: 'socio2@esempio.com' }
]

const CONTI = [
  { nome: 'Conto corrente principale', iban: 'IT00X0000000000000000000000', saldo_iniziale: 0, banca: 'Banca Esempio' }
]

const COSTI_FISSI = [
  { descrizione: 'Affitto ufficio',     importo: 0, tipo: 'fisso',     periodicita: 'mensile',  categoria: 'Struttura' },
  { descrizione: 'Software / SaaS',     importo: 0, tipo: 'fisso',     periodicita: 'mensile',  categoria: 'IT' },
  { descrizione: 'Telefonia',           importo: 0, tipo: 'fisso',     periodicita: 'mensile',  categoria: 'Struttura' },
  { descrizione: 'Commercialista',      importo: 0, tipo: 'fisso',     periodicita: 'annuale',  categoria: 'Professionisti' },
  { descrizione: 'Assicurazioni',       importo: 0, tipo: 'fisso',     periodicita: 'annuale',  categoria: 'Struttura' },
]

// ---- Funzione principale ----

async function seed() {
  console.log('🌱 Avvio creazione database...\n')

  // Batch write per efficienza
  let batch = db.batch()
  let count = 0

  // Helper per aggiungere documenti
  const add = (collection, data) => {
    const ref = db.collection(collection).doc()
    batch.set(ref, {
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    })
    count++
    // Firebase limita i batch a 500 operazioni
    if (count % 499 === 0) {
      batch.commit()
      batch = db.batch()
    }
    return ref.id
  }

  // ---- Soci ----
  console.log('👥 Creazione soci...')
  SOCI.forEach(s => add('soci', s))

  // ---- Conti ----
  console.log('🏦 Creazione conti correnti...')
  CONTI.forEach(c => add('conti', c))

  // ---- Costi ----
  console.log('📊 Creazione costi fissi di esempio...')
  COSTI_FISSI.forEach(c => add('costi', c))

  // ---- Collezioni vuote (struttura) ----
  // Firebase crea le collezioni automaticamente al primo documento.
  // Inseriamo un documento placeholder che puoi eliminare subito dopo.
  const EMPTY_COLLECTIONS = ['contratti', 'movimenti', 'provvigioni', 'compensi']
  EMPTY_COLLECTIONS.forEach(col => {
    const ref = db.collection(col).doc('_placeholder')
    batch.set(ref, {
      _note: 'Documento placeholder — eliminabile',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    })
  })

  // ---- Commit ----
  await batch.commit()

  console.log('\n✅ Database creato con successo!')
  console.log(`   Documenti inseriti: ${count}`)
  console.log('\n📝 Prossimi passi:')
  console.log('   1. Vai su Firebase Console → Firestore Database')
  console.log('   2. Verifica che tutte le collezioni siano presenti')
  console.log('   3. Elimina i documenti "_placeholder" dalle collezioni vuote')
  console.log('   4. Aggiorna i dati di Soci e Conti con i valori reali')
  console.log('\n🚀 Pronto per iniziare!\n')

  process.exit(0)
}

seed().catch(err => {
  console.error('❌ Errore durante il seed:', err)
  process.exit(1)
})
