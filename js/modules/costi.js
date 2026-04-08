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
let beChart    = null

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

  await caricaChartJS()

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

    // ── Disegna grafico ──────────────────────────────────────
    disegnaGrafico(
      mesi12.map(m => m.label),
      incassiPerMese,
      contrattiPerMese,
      fissiMensili
    )

    if (beLoading) beLoading.style.display = 'none'
    if (beCanvas)  beCanvas.style.display  = 'block'

  } catch (err) {
    console.error('Errore calcolo break even:', err)
    if (beLoading) beLoading.innerHTML = `<span style="color:var(--red)">Errore nel calcolo. Controlla Firestore.</span>`
  }
}


// ============================================================
// GRAFICO BREAK EVEN
// Barre colorate (verde/rosso vs soglia) + linea contratti + linea BE
// ============================================================
function disegnaGrafico(labels, incassiMensili, contrattiMensili, beValue) {
  const canvas = document.getElementById('be-chart')
  if (!canvas || typeof Chart === 'undefined') return

  if (beChart) { beChart.destroy(); beChart = null }

  // Colora ogni barra in base al confronto con il break even
  const coloriIncassi = incassiMensili.map(v =>
    v >= beValue && beValue > 0
      ? 'rgba(16,185,129,0.82)'   // verde = sopra BE
      : v > 0
      ? 'rgba(248,113,113,0.82)'  // rosso = sotto BE (ma con dati)
      : 'rgba(220,220,220,0.4)'   // grigio = nessun dato
  )

  const coloriIncassiBorder = incassiMensili.map(v =>
    v >= beValue && beValue > 0 ? 'rgba(16,185,129,1)' : v > 0 ? 'rgba(248,113,113,1)' : 'rgba(200,200,200,0.6)'
  )

  // Linea break even: valore costante per tutti i mesi
  const lineaBE = labels.map(() => beValue)

  const ctx = canvas.getContext('2d')
  beChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          // Barre: incassi mensili (verdi/rosse)
          label: 'Incassi mensili',
          type: 'bar',
          data: incassiMensili,
          backgroundColor: coloriIncassi,
          borderColor: coloriIncassiBorder,
          borderWidth: 1.5,
          borderRadius: 4,
          order: 2,
        },
        {
          // Linea: valore contratti firmati per mese
          label: 'Contratti firmati',
          type: 'line',
          data: contrattiMensili,
          borderColor: 'var(--secondary)',
          backgroundColor: 'rgba(15,80,123,0.08)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: 'var(--secondary)',
          fill: false,
          tension: 0.3,
          order: 1,
        },
        {
          // Linea tratteggiata: soglia break even
          label: `Break Even (${formatEuro(beValue)}/mese)`,
          type: 'line',
          data: lineaBE,
          borderColor: 'rgba(230,22,92,0.7)',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 0,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },  // usiamo la legenda HTML custom
        tooltip: {
          backgroundColor: '#1b3050',
          titleFont: { family: 'Montserrat', size: 11, weight: '700' },
          bodyFont:  { family: 'Montserrat', size: 11 },
          callbacks: {
            label: ctx => {
              const val = ctx.raw
              if (val === null || val === undefined) return null
              return ` ${ctx.dataset.label}: ${formatEuro(val)}`
            },
            afterBody: (items) => {
              // Mostra se il mese è sopra o sotto il break even
              const incasso = items.find(i => i.datasetIndex === 0)?.raw || 0
              if (beValue > 0 && incasso > 0) {
                const diff = incasso - beValue
                return diff >= 0
                  ? [`  ✓ +${formatEuro(diff)} sopra il BE`]
                  : [`  ✗ ${formatEuro(diff)} sotto il BE`]
              }
              return []
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Montserrat', size: 10 }, color: '#8fa3b8' }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: {
            font: { family: 'Montserrat', size: 10 },
            color: '#8fa3b8',
            callback: v => v >= 1000 ? `€${(v/1000).toFixed(0)}k` : `€${v}`
          }
        }
      }
    }
  })
}


// ============================================================
// KPI COSTI
// ============================================================
function aggiornaKPI() {
  const attivi = tuttICosti.filter(c => c.attivo !== false && c.tipo === 'fisso')
  const tutti  = tuttICosti.filter(c => c.tipo === 'fisso')

  const fissiMensili = attivi.reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)
  const annuali      = fissiMensili * 12

  const el = id => document.getElementById(id)
  if (el('kpi-fissi'))       el('kpi-fissi').textContent       = formatEuro(fissiMensili)
  if (el('kpi-fissi-sub'))   el('kpi-fissi-sub').textContent   = `${attivi.length} voci attive`
  if (el('kpi-annuale'))     el('kpi-annuale').textContent     = formatEuro(annuali)
  if (el('kpi-count'))       el('kpi-count').textContent       = attivi.length
  if (el('kpi-count-sub'))   el('kpi-count-sub').textContent   = `di ${tutti.length} totali`
}


// ============================================================
// TABELLA COSTI FISSI
// ============================================================
function renderTabella() {
  const wrap = document.getElementById('table-costi-wrap')
  if (!wrap) return

  const dati = tuttICosti.filter(c => c.tipo === 'fisso')

  if (dati.length === 0) {
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
    <thead>
      <tr>
        <th>Descrizione</th>
        <th>Categoria</th>
        <th>Periodicità</th>
        <th class="text-right">€/mese</th>
        <th>Stato</th>
        <th class="text-right">Azioni</th>
      </tr>
    </thead>
    <tbody>${righe}</tbody>
  </table>`
}


// ============================================================
// MODAL — APRI NUOVO
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

// ============================================================
// MODAL — APRI MODIFICA
// ============================================================
function openEdit(id) {
  const c = tuttICosti.find(x => x.id === id)
  if (!c) return

  document.getElementById('costo-id').value          = c.id
  document.getElementById('costo-descrizione').value = c.descrizione || ''
  document.getElementById('costo-importo').value     = c.importo ?? ''
  document.getElementById('costo-periodicita').value = c.periodicita || 'mensile'
  document.getElementById('costo-categoria').value   = c.categoria  || ''
  document.getElementById('costo-attivo').checked    = c.attivo !== false
  aggiornaPreviewMensile()
  document.getElementById('modal-costo-title').textContent = 'Modifica costo'
  document.getElementById('modal-costo').classList.add('open')
}

// ============================================================
// MODAL — CHIUDI
// ============================================================
function closeModal() {
  document.getElementById('modal-costo').classList.remove('open')
}

// ============================================================
// PREVIEW MENSILE
// ============================================================
function aggiornaPreviewMensile() {
  const importo     = parseFloat(document.getElementById('costo-importo')?.value) || 0
  const periodicita = document.getElementById('costo-periodicita')?.value
  const mensile     = toMensile(importo, periodicita)
  const preview     = document.getElementById('costo-preview')
  const previewVal  = document.getElementById('costo-preview-val')

  if (importo > 0) {
    if (preview) preview.style.display = 'block'
    if (previewVal) previewVal.textContent = `${formatEuro(mensile)} / mese`
  } else {
    if (preview) preview.style.display = 'none'
  }
}


// ============================================================
// SALVA COSTO
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
    console.error('Errore salvataggio costo:', err)
    toast('Errore nel salvataggio', 'error')
  }
}


// ============================================================
// ELIMINA COSTO
// ============================================================
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


// ============================================================
// CARICA CHART.JS DA CDN
// ============================================================
function caricaChartJS() {
  return new Promise(resolve => {
    if (typeof Chart !== 'undefined') { resolve(); return }
    const s = document.createElement('script')
    s.src   = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
    s.onload  = resolve
    s.onerror = () => { console.error('Chart.js non caricato'); resolve() }
    document.head.appendChild(s)
  })
}
