// ============================================================
// COSTI.JS v3 — Solo costi fissi + barre break even
// ============================================================

import { collections, FieldValue } from '../../js/firebase-config.js'
import { formatEuro, formatPercent, toast, confirmDelete } from '../../js/utils.js'

let tuttICosti = []

const COEFF = { mensile:1, trimestrale:1/3, semestrale:1/6, annuale:1/12 }

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
  window.__costiModule = { openNew, openEdit, deleteCosto, saveCosto, closeModal, registraMese }

  await Promise.all([ caricaCosti(), calcolaBreakEven() ])

  aggiornaKPI()
  renderTabella()

  document.getElementById('costo-importo')?.addEventListener('input', aggiornaPreview)
  document.getElementById('costo-periodicita')?.addEventListener('change', aggiornaPreview)
}


// ============================================================
// CARICA COSTI (senza orderBy per evitare errori indice)
// ============================================================
async function caricaCosti() {
  try {
    const snap = await collections.costi().get()
    tuttICosti = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    tuttICosti.sort((a, b) => (a.descrizione || '').localeCompare(b.descrizione || ''))
  } catch (err) {
    console.error('Errore caricamento costi:', err)
    toast('Errore nel caricamento dei costi', 'error')
    tuttICosti = []
  }
}


// ============================================================
// KPI
// ============================================================
function aggiornaKPI() {
  const attivi = tuttICosti.filter(c => c.attivo !== false && c.tipo === 'fisso')
  const tutti  = tuttICosti.filter(c => c.tipo === 'fisso')
  const fissiMensili = attivi.reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  set('kpi-fissi',     formatEuro(fissiMensili))
  set('kpi-fissi-sub', `${attivi.length} voci attive`)
  set('kpi-annuale',   formatEuro(fissiMensili * 12))
  set('kpi-count',     attivi.length)
  set('kpi-count-sub', `di ${tutti.length} totali`)
}


// ============================================================
// TABELLA
// ============================================================
function renderTabella() {
  const wrap = document.getElementById('table-costi-wrap')
  if (!wrap) return

  const dati = tuttICosti.filter(c => c.tipo === 'fisso')

  if (!dati.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
        <p>Nessun costo fisso registrato.</p>
        <p style="margin-top:6px;font-size:11px;">Clicca "Aggiungi costo" per iniziare.</p>
      </div>`
    return
  }

  const righe = dati.map(c => {
    const mensile  = toMensile(c.importo || 0, c.periodicita)
    const catClass = classCategoria(c.categoria)
    const inattivo = c.attivo === false ? 'costo-inattivo' : ''
    const badge    = c.attivo !== false
      ? '<span class="badge badge-green">Attivo</span>'
      : '<span class="badge badge-gray">Inattivo</span>'

    return `<tr class="${inattivo}">
      <td style="font-weight:600;color:var(--text0);">${c.descrizione || '—'}</td>
      <td><span class="badge ${catClass}">${c.categoria || '—'}</span></td>
      <td style="text-transform:capitalize;font-size:12px;">${c.periodicita || '—'}</td>
      <td class="text-right" style="font-weight:700;color:var(--text0);font-family:monospace;">${formatEuro(mensile)}</td>
      <td>${badge}</td>
      <td class="text-right">
        <button class="btn-icon btn btn-sm" title="Modifica" onclick="window.__costiModule.openEdit('${c.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon btn btn-sm" title="Elimina" style="color:var(--red);border-color:rgba(248,113,113,.25);" onclick="window.__costiModule.deleteCosto('${c.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </td>
    </tr>`
  }).join('')

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Descrizione</th><th>Categoria</th><th>Periodicità</th>
      <th class="text-right">€/mese</th><th>Stato</th><th class="text-right">Azioni</th>
    </tr></thead>
    <tbody>${righe}</tbody>
  </table>`
}


// ============================================================
// BREAK EVEN — calcolo e render barre
// ============================================================
async function calcolaBreakEven() {
  const beLoading = document.getElementById('be-loading')

  try {
    const [snapMov, snapContratti] = await Promise.all([
      collections.movimenti().get(),
      collections.contratti().get()
    ])

    const movimenti = snapMov.docs.map(d => d.data())
    const contratti = snapContratti.docs.map(d => d.data())

    // Costi fissi mensili totali
    const attivi = tuttICosti.filter(c => c.attivo !== false && c.tipo === 'fisso')
    const fissiMensili = attivi.reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)

    // Aggiorna KPI soglia
    const elSoglia = document.getElementById('be-soglia')
    if (elSoglia) elSoglia.textContent = formatEuro(fissiMensili)

    // Ultimi 12 mesi
    const oggi   = new Date()
    const mesi12 = []
    for (let i = 11; i >= 0; i--) {
      const ref = new Date(oggi.getFullYear(), oggi.getMonth() - i, 1)
      mesi12.push({ anno: ref.getFullYear(), mese: ref.getMonth() })
    }

    // Incassi medi mensili (da movimenti)
    const incassiPerMese = mesi12.map(({ anno, mese }) =>
      movimenti
        .filter(m => {
          if (m.tipo !== 'incasso') return false
          const d = m.data?.toDate ? m.data.toDate() : new Date(m.data)
          return !isNaN(d) && d.getFullYear() === anno && d.getMonth() === mese
        })
        .reduce((s, m) => s + (m.importo || 0), 0)
    )

    // Valore contratti firmati per mese (data_inizio)
    const contrattiPerMese = mesi12.map(({ anno, mese }) =>
      contratti
        .filter(c => {
          const d = c.data_inizio?.toDate ? c.data_inizio.toDate() : new Date(c.data_inizio)
          return !isNaN(d) && d.getFullYear() === anno && d.getMonth() === mese
        })
        .reduce((s, c) => s + (c.importo_totale || c.valore || 0), 0)
    )

    const mesiInc  = incassiPerMese.filter(v => v > 0)
    const mesiCont = contrattiPerMese.filter(v => v > 0)

    const mediaIncassi   = mesiInc.length  > 0 ? mesiInc.reduce((a,b)=>a+b,0)  / mesiInc.length  : 0
    const mediaContratti = mesiCont.length > 0 ? mesiCont.reduce((a,b)=>a+b,0) / mesiCont.length : 0

    // Render barre
    renderBarra(1, fissiMensili, mediaIncassi,   mesiInc.length,  false)
    renderBarra(2, fissiMensili, mediaContratti, mesiCont.length, true)

    // Mostra/nascondi
    const beEmpty = document.getElementById('be-empty')
    if (fissiMensili === 0 && mediaIncassi === 0 && mediaContratti === 0) {
      if (beEmpty) beEmpty.style.display = 'block'
      document.getElementById('be-card-1').style.display = 'none'
      document.getElementById('be-card-2').style.display = 'none'
    } else {
      if (beEmpty) beEmpty.style.display = 'none'
      document.getElementById('be-card-1').style.display = 'block'
      document.getElementById('be-card-2').style.display = 'block'
    }

  } catch (err) {
    console.error('Errore calcolo break even:', err)
    if (beLoading) beLoading.innerHTML =
      `<span style="color:var(--red)">Errore nel calcolo. Controlla Firestore.</span>`
    return
  }

  if (beLoading) beLoading.style.display = 'none'
}


// ── Popola una singola barra ──────────────────────────────────
function renderBarra(n, soglia, media, nMesi, isBlue) {
  // Percentuale copertura (cappata a 100% per la barra)
  const pctBarra = soglia > 0 ? Math.min((media / soglia) * 100, 100) : (media > 0 ? 100 : 0)
  // Percentuale reale (può superare 100%)
  const pctReale = soglia > 0 ? (media / soglia) * 100 : 0
  const sopra    = media >= soglia && soglia > 0

  const fill  = document.getElementById(`be-fill-${n}`)
  const label = document.getElementById(`be-label-${n}`)
  const sogEl = document.getElementById(`be-soglia-${n}`)

  if (sogEl) sogEl.textContent = `Break-Even: ${formatEuro(soglia)}`

  if (fill) {
    // Breve delay per permettere alla transizione CSS di scattare
    setTimeout(() => { fill.style.width = `${pctBarra}%` }, 80)
    fill.classList.toggle('sotto', !sopra && soglia > 0)
  }

  if (label) {
    if (soglia === 0) {
      label.innerHTML = '<span style="color:var(--text2);">Inserisci i costi fissi per attivare il break even</span>'
    } else if (media === 0) {
      label.innerHTML = `<span style="color:var(--text2);">Nessun dato disponibile (${nMesi} mesi con dati)</span>`
    } else {
      const pctStr   = pctReale.toFixed(2).replace('.', ',')
      const tipo     = isBlue ? 'su contratti firmati' : 'su fatturato registrato'
      const mesiStr  = `${nMesi} mes${nMesi === 1 ? 'e' : 'i'} con dati`
      const mediaStr = `${formatEuro(media)} / mese (${mesiStr})`

      if (sopra) {
        label.innerHTML = `<span style="color:${isBlue ? 'var(--secondary)' : 'var(--green)'};">${pctStr}% ${tipo} — ✓ ${isBlue ? 'In utile!' : 'Coperti!'}</span>`
      } else {
        const diff = formatEuro(soglia - media)
        label.innerHTML = `<span style="color:var(--red);">${pctStr}% ${tipo} — mancano ${diff} al break even</span>`
      }
    }
  }
}


// ============================================================
// MODAL
// ============================================================
function openNew() {
  document.getElementById('costo-id').value          = ''
  document.getElementById('costo-descrizione').value = ''
  document.getElementById('costo-importo').value     = ''
  document.getElementById('costo-periodicita').value = 'mensile'
  document.getElementById('costo-categoria').value   = ''
  document.getElementById('costo-attivo').checked    = true
  document.getElementById('costo-preview').style.display = 'none'
  document.getElementById('modal-costo-title').textContent = 'Nuovo costo fisso'
  document.getElementById('modal-costo').classList.add('open')
}

function openEdit(id) {
  const c = tuttICosti.find(x => x.id === id)
  if (!c) return
  document.getElementById('costo-id').value          = c.id
  document.getElementById('costo-descrizione').value = c.descrizione || ''
  document.getElementById('costo-importo').value     = c.importo ?? ''
  document.getElementById('costo-periodicita').value = c.periodicita || 'mensile'
  document.getElementById('costo-categoria').value   = c.categoria  || ''
  document.getElementById('costo-attivo').checked    = c.attivo !== false
  aggiornaPreview()
  document.getElementById('modal-costo-title').textContent = 'Modifica costo'
  document.getElementById('modal-costo').classList.add('open')
}

function closeModal() {
  document.getElementById('modal-costo').classList.remove('open')
}

function aggiornaPreview() {
  const importo     = parseFloat(document.getElementById('costo-importo')?.value) || 0
  const periodicita = document.getElementById('costo-periodicita')?.value
  const mensile     = toMensile(importo, periodicita)
  const preview     = document.getElementById('costo-preview')
  const val         = document.getElementById('costo-preview-val')
  if (importo > 0) {
    if (preview) preview.style.display = 'block'
    if (val) val.textContent = `${formatEuro(mensile)} / mese`
  } else {
    if (preview) preview.style.display = 'none'
  }
}


// ============================================================
// CRUD
// ============================================================
async function saveCosto() {
  const id          = document.getElementById('costo-id').value
  const descrizione = document.getElementById('costo-descrizione').value.trim()
  const importo     = parseFloat(document.getElementById('costo-importo').value)
  const periodicita = document.getElementById('costo-periodicita').value
  const categoria   = document.getElementById('costo-categoria').value.trim()
  const attivo      = document.getElementById('costo-attivo').checked

  if (!descrizione) { toast('Inserisci una descrizione', 'error'); return }
  if (!importo || importo <= 0) { toast('Importo non valido', 'error'); return }
  if (!categoria) { toast('Inserisci una categoria', 'error'); return }

  const dati = { descrizione, importo, periodicita, tipo: 'fisso', categoria, attivo }

  try {
    if (id) {
      await collections.costi().doc(id).update(dati)
      toast('Costo aggiornato', 'success')
    } else {
      dati.createdAt = FieldValue.serverTimestamp()
      await collections.costi().add(dati)
      toast('Costo aggiunto', 'success')
    }
    closeModal()
    await caricaCosti()
    aggiornaKPI()
    renderTabella()
    await calcolaBreakEven()
  } catch (err) {
    console.error('Errore salvataggio:', err)
    toast('Errore nel salvataggio', 'error')
  }
}

async function deleteCosto(id) {
  const c = tuttICosti.find(x => x.id === id)
  if (!confirmDelete(`Eliminare "${c?.descrizione || 'questo costo'}"?`)) return
  try {
    await collections.costi().doc(id).delete()
    toast('Costo eliminato', 'success')
    await caricaCosti()
    aggiornaKPI()
    renderTabella()
    await calcolaBreakEven()
  } catch (err) {
    console.error('Errore eliminazione:', err)
    toast("Errore nell'eliminazione", 'error')
  }
}
