// ============================================================
// COSTI.JS v2 — Modulo Costi & Break Even
//
// Modifiche rispetto alla v1:
//   - Rimosso tab "variabili" — si gestiscono solo i costi fissi
//   - Fix caricamento lista (rimosso orderBy che causava errore se
//     mancava l'indice Firestore)
//   - Nuovo grafico break even:
//       · Barre colorate: verde se incasso mensile > break even,
//         rosso se < break even
//       · Linea blu: valore contratti firmati per mese
//       · Linea tratteggiata rossa: soglia break even (costi fissi/mese)
//   - KPI: aggiunto margine su fatturato E su contratti
// ============================================================

import { collections, FieldValue } from '../../js/firebase-config.js'
import { formatEuro, formatPercent, toast, confirmDelete } from '../../js/utils.js'

// ── Stato locale ─────────────────────────────────────────────
let tuttICosti = []

// Coefficienti per normalizzare a mensile
const COEFF = {
  mensile:     1,
  trimestrale: 1 / 3,
  semestrale:  1 / 6,
  annuale:     1 / 12
}

function toMensile(importo, periodicita) {
  return importo * (COEFF[periodicita] ?? 1)
}

function classCategoria(cat) {
  const c = (cat || '').toLowerCase()
  if (c.includes('struttura'))  return 'cat-struttura'
  if (c.includes('personale'))  return 'cat-personale'
  if (c.includes('it'))         return 'cat-it'
  if (c.includes('marketing'))  return 'cat-marketing'
  return 'cat-altro'
}


// ============================================================
// INIT
// ============================================================
export async function init() {
  window.__costiModule = { openNew, openEdit, deleteCosto, saveCosto, closeModal }

  // Carica costi, movimenti e contratti in parallelo
  await Promise.all([
    caricaCosti(),
    calcolaBreakEven()
  ])

  aggiornaKPI()
  renderTabella()

  // Aggiorna preview mensile nel modal
  ['costo-importo', 'costo-periodicita'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', aggiornaPreviewMensile)
  })
}


// ============================================================
// CARICAMENTO COSTI
// Fix: rimosso orderBy per evitare errori su Firestore se manca
// l'indice. Ordiniamo lato client.
// ============================================================
async function caricaCosti() {
  try {
    const snap = await collections.costi().get()
    tuttICosti = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    // Ordina per descrizione alfabetica
    tuttICosti.sort((a, b) => (a.descrizione || '').localeCompare(b.descrizione || ''))
  } catch (err) {
    console.error('Errore caricamento costi:', err)
    toast('Errore nel caricamento dei costi', 'error')
    tuttICosti = []
  }
}


// ============================================================
// BREAK EVEN — carica movimenti + contratti e calcola
// ============================================================
async function calcolaBreakEven() {
  const beLoading = document.getElementById('be-loading')
  const beCanvas  = document.getElementById('be-chart')

  try {
    // Carica movimenti e contratti in parallelo
    const [snapMov, snapContratti] = await Promise.all([
      collections.movimenti().get(),
      collections.contratti().get()
    ])

    const movimenti  = snapMov.docs.map(d => d.data())
    const contratti  = snapContratti.docs.map(d => d.data())

    // Costi fissi mensili (attivi)
    const attivi = tuttICosti.filter(c => c.attivo !== false && c.tipo === 'fisso')
    const fissiMensili = attivi.reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)

    // Ultimi 12 mesi
    const oggi     = new Date()
    const mesi12   = []
    for (let i = 11; i >= 0; i--) {
      const ref = new Date(oggi.getFullYear(), oggi.getMonth() - i, 1)
      mesi12.push({ anno: ref.getFullYear(), mese: ref.getMonth(), label: ref.toLocaleString('it-IT', { month: 'short', year: '2-digit' }) })
    }

    // Raggruppa incassi per mese
    const incassiPerMese = mesi12.map(({ anno, mese }) =>
      movimenti
        .filter(m => {
          if (m.tipo !== 'incasso') return false
          const d = m.data?.toDate ? m.data.toDate() : new Date(m.data)
          return d.getFullYear() === anno && d.getMonth() === mese
        })
        .reduce((s, m) => s + (m.importo || 0), 0)
    )

    // Raggruppa valore contratti firmati per mese (data_inizio)
    const contrattiPerMese = mesi12.map(({ anno, mese }) =>
      contratti
        .filter(c => {
          const d = c.data_inizio?.toDate ? c.data_inizio.toDate() : new Date(c.data_inizio)
          return d.getFullYear() === anno && d.getMonth() === mese
        })
        .reduce((s, c) => s + (c.importo_totale || c.valore || 0), 0)
    )

    // Medie
    const mesiConIncassi = incassiPerMese.filter(v => v > 0)
    const mesiConContratti = contrattiPerMese.filter(v => v > 0)
    const mediaIncassi   = mesiConIncassi.length   > 0 ? mesiConIncassi.reduce((a, b) => a + b, 0) / mesiConIncassi.length : 0
    const mediaContratti = mesiConContratti.length > 0 ? mesiConContratti.reduce((a, b) => a + b, 0) / mesiConContratti.length : 0

    // Margini
    const margineIncassi   = fissiMensili > 0 && mediaIncassi   > 0 ? ((mediaIncassi   - fissiMensili) / mediaIncassi)   * 100 : null
    const margineContratti = fissiMensili > 0 && mediaContratti > 0 ? ((mediaContratti - fissiMensili) / mediaContratti) * 100 : null

    // ── Aggiorna KPI break even ──────────────────────────────
    const elBeFatturato     = document.getElementById('be-fatturato')
    const elBeFatturatoSub  = document.getElementById('be-fatturato-sub')
    const elBeContratti     = document.getElementById('be-contratti')
    const elBeContrattiSub  = document.getElementById('be-contratti-sub')
    const elBeMargine       = document.getElementById('be-margine')
    const elBeMarginesSub   = document.getElementById('be-margine-sub')
    const elBeMargCont      = document.getElementById('be-margine-cont')
    const elBeMargContSub   = document.getElementById('be-margine-cont-sub')
    const elBeSoglia        = document.getElementById('be-soglia')

    if (elBeFatturato)    elBeFatturato.textContent    = formatEuro(mediaIncassi)
    if (elBeFatturatoSub) elBeFatturatoSub.textContent = `${mesiConIncassi.length} mesi con dati`
    if (elBeContratti)    elBeContratti.textContent    = formatEuro(mediaContratti)
    if (elBeContrattiSub) elBeContrattiSub.textContent = `${mesiConContratti.length} mesi con contratti`
    if (elBeSoglia)       elBeSoglia.textContent       = formatEuro(fissiMensili)

    if (elBeMargine) {
      if (margineIncassi !== null) {
        elBeMargine.textContent    = formatPercent(margineIncassi)
        elBeMargine.style.color    = margineIncassi >= 0 ? 'var(--green)' : 'var(--red)'
        if (elBeMarginesSub) elBeMarginesSub.textContent = margineIncassi >= 0 ? '✓ sopra il break even' : '✗ sotto il break even'
      } else {
        elBeMargine.textContent = '—'
      }
    }

    if (elBeMargCont) {
      if (margineContratti !== null) {
        elBeMargCont.textContent    = formatPercent(margineContratti)
        elBeMargCont.style.color    = margineContratti >= 0 ? 'var(--green)' : 'var(--red)'
        if (elBeMargContSub) elBeMargContSub.textContent = margineContratti >= 0 ? '✓ sopra il break even' : '✗ sotto il break even'
      } else {
        elBeMargCont.textContent = '—'
      }
    }

    // Nota informativa
    const nota = document.getElementById('be-note')
    const notaTesto = document.getElementById('be-note-text')
    if (nota && notaTesto) {
      nota.style.display = 'block'
      if (fissiMensili === 0) {
        notaTesto.textContent = 'Nessun costo fisso registrato. Aggiungi i costi per calcolare il break even.'
      } else if (mediaIncassi === 0 && mediaContratti === 0) {
        notaTesto.textContent = 'Nessun dato di fatturato o contratti negli ultimi 12 mesi.'
      } else {
        notaTesto.textContent = `Costi fissi mensili: ${formatEuro(fissiMensili)}. Le barre verdi indicano i mesi in cui il fatturato supera il break even.`
      }
    }

    // ── Disegna barre di progresso ───────────────────────────
    renderBarreBreakEven(fissiMensili, mediaIncassi, mediaContratti, mesiConIncassi.length, mesiConContratti.length)

    if (beLoading) beLoading.style.display = 'none'

  } catch (err) {
    console.error('Errore calcolo break even:', err)
    if (beLoading) beLoading.innerHTML = `<span style="color:var(--red)">Errore nel calcolo. Controlla Firestore.</span>`
  }
}


// ============================================================
// BARRE BREAK EVEN
// ============================================================
function renderBarreBreakEven(soglia, mediaIncassi, mediaContratti, mesiInc, mesiCont) {
  const beEmpty       = document.getElementById('be-empty')
  const cardIncassi   = document.getElementById('be-card-incassi')
  const cardContratti = document.getElementById('be-card-contratti')

  if (soglia === 0 && mediaIncassi === 0 && mediaContratti === 0) {
    if (beEmpty)       beEmpty.style.display       = 'block'
    if (cardIncassi)   cardIncassi.style.display   = 'none'
    if (cardContratti) cardContratti.style.display = 'none'
    return
  }

  if (beEmpty) beEmpty.style.display = 'none'

  // ── Barra 1: Incassi registrati ─────────────────────────
  if (cardIncassi) cardIncassi.style.display = 'block'

  const pct1     = soglia > 0 ? Math.min((mediaIncassi / soglia) * 100, 100) : 100
  const pctReal1 = soglia > 0 ? ((mediaIncassi / soglia) * 100).toFixed(2)    : 0
  const sopra1   = mediaIncassi >= soglia && soglia > 0

  const fill1 = document.getElementById('be-bar1-fill')
  if (fill1) { fill1.style.width = `${pct1}%`; fill1.classList.toggle('sotto', !sopra1) }

  const s1 = document.getElementById('be-bar1-soglia')
  if (s1) s1.textContent = `Break-Even: ${formatEuro(soglia)}`

  const t1 = document.getElementById('be-bar1-text')
  if (t1) {
    if (soglia === 0) {
      t1.innerHTML = '<span style="color:var(--text2)">Inserisci i costi fissi per calcolare il break even</span>'
    } else {
      const m = `media su ${mesiInc} mese${mesiInc !== 1 ? 'i' : ''}`
      t1.innerHTML = sopra1
        ? `<span style="color:var(--green)">${pctReal1}% del break even — ${formatEuro(mediaIncassi)} / mese (${m}) — ✓ Coperti!</span>`
        : `<span style="color:var(--red)">${pctReal1}% del break even — ${formatEuro(mediaIncassi)} / mese (${m}) — mancano ${formatEuro(soglia - mediaIncassi)}</span>`
    }
  }

  // ── Barra 2: Contratti firmati ──────────────────────────
  if (cardContratti) cardContratti.style.display = 'block'

  const pct2     = soglia > 0 ? Math.min((mediaContratti / soglia) * 100, 100) : 100
  const pctReal2 = soglia > 0 ? ((mediaContratti / soglia) * 100).toFixed(2)    : 0
  const sopra2   = mediaContratti >= soglia && soglia > 0

  const fill2 = document.getElementById('be-bar2-fill')
  if (fill2) { fill2.style.width = `${pct2}%`; fill2.classList.toggle('sotto', !sopra2) }

  const s2 = document.getElementById('be-bar2-soglia')
  if (s2) s2.textContent = `Break-Even: ${formatEuro(soglia)}`

  const t2 = document.getElementById('be-bar2-text')
  if (t2) {
    if (soglia === 0) {
      t2.innerHTML = '<span style="color:var(--text2)">Inserisci i costi fissi per calcolare il break even</span>'
    } else {
      const m = `media su ${mesiCont} mese${mesiCont !== 1 ? 'i' : ''}`
      t2.innerHTML = sopra2
        ? `<span style="color:var(--secondary)">${pctReal2}% del break even — ${formatEuro(mediaContratti)} / mese (${m}) — ✓ In utile!</span>`
        : `<span style="color:var(--red)">${pctReal2}% del break even — ${formatEuro(mediaContratti)} / mese (${m}) — mancano ${formatEuro(soglia - mediaContratti)}</span>`
    }
  }
}
