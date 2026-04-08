// ============================================================
// COSTI.JS — Modulo Costi & Break Even
// Esporta init() chiamata dal router dopo l'inject del HTML.
// ============================================================

import { db, collections, toTimestamp } from '../../js/firebase-config.js'
import { formatEuro, formatPercent, toast, confirmDelete } from '../../js/utils.js'

// ── Stato locale del modulo ──────────────────────────────────
let tuttICosti   = []   // tutti i costi caricati da Firestore
let tabAttiva    = 'fissi'  // tab visibile: 'fissi' | 'variabili'
let beChart      = null     // istanza Chart.js break even

// ── Coefficienti normalizzazione a mensile ───────────────────
const COEFF = {
  mensile:      1,
  trimestrale:  1 / 3,
  semestrale:   1 / 6,
  annuale:      1 / 12
}

// ── Palette badge categorie (classe CSS locale) ──────────────
function classCategoria(cat) {
  const c = (cat || '').toLowerCase()
  if (c.includes('struttura'))  return 'cat-struttura'
  if (c.includes('personale'))  return 'cat-personale'
  if (c.includes('it'))         return 'cat-it'
  if (c.includes('marketing'))  return 'cat-marketing'
  return 'cat-altro'
}

// ── Normalizza importo a valore mensile ──────────────────────
function toMensile(importo, periodicita) {
  const coeff = COEFF[periodicita] ?? 1
  return importo * coeff
}

// ============================================================
// INIT — punto di ingresso chiamato dal router
// ============================================================
export async function init() {
  // Espone le azioni al DOM (pulsanti usano onclick con namespace)
  window.__costiModule = {
    switchTab,
    openNew,
    openEdit,
    deleteCosto,
    saveCosto,
    closeModal
  }

  // Carica Chart.js da CDN se non già presente
  await caricaChartJS()

  // Carica i dati in parallelo
  await Promise.all([
    caricaCosti(),
    calcolaBreakEven()
  ])

  // Calcola i KPI e renderizza la tab default
  aggiornaKPI()
  renderTabella()

  // Aggiorna l'anteprima mensile nel modal al cambio dei campi
  ['costo-importo', 'costo-periodicita'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', aggiornaPreviewMensile)
  })
}

// ============================================================
// CARICAMENTO DATI
// ============================================================

// Carica tutti i costi da Firestore
async function caricaCosti() {
  try {
    const snap = await collections.costi().orderBy('createdAt', 'desc').get()
    tuttICosti = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Errore caricamento costi:', err)
    toast('Errore nel caricamento dei costi', 'error')
    tuttICosti = []
  }
}

// Legge i movimenti degli ultimi 6 mesi e calcola il fatturato medio mensile
async function calcolaBreakEven() {
  const beLoading = document.getElementById('be-loading')
  const beCanvas  = document.getElementById('be-chart')

  try {
    // Data di inizio: 6 mesi fa
    const seimesiFA = new Date()
    seimesiFA.setMonth(seimesiFA.getMonth() - 6)

    // Query Firestore: incassi degli ultimi 6 mesi
    const snap = await collections.movimenti()
      .where('tipo', '==', 'incasso')
      .where('data', '>=', toTimestamp(seimesiFA.toISOString().split('T')[0]))
      .get()

    const incassi = snap.docs.map(d => d.data())

    // Raggruppa per mese per calcolare la media mensile reale
    const perMese = {}
    incassi.forEach(m => {
      const data = m.data?.toDate ? m.data.toDate() : new Date(m.data)
      const chiave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
      perMese[chiave] = (perMese[chiave] || 0) + (m.importo || 0)
    })

    const mesiConDati = Object.values(perMese)
    // Media mensile: usa i mesi con dati o 0 se nessun dato
    const fatturatoMedioMensile = mesiConDati.length > 0
      ? mesiConDati.reduce((a, b) => a + b, 0) / mesiConDati.length
      : 0

    // Calcola i totali mensili dai costi caricati (solo attivi)
    const attivi = tuttICosti.filter(c => c.attivo !== false)
    const fissiMensili     = attivi
      .filter(c => c.tipo === 'fisso')
      .reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)
    const variabiliMensili = attivi
      .filter(c => c.tipo === 'variabile')
      .reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)

    // ── Calcolo break even classico ──────────────────────────
    // Ricavi al mese N  = fatturatoMedioMensile × N
    // Costi totali al mese N = fissiMensili + variabiliMensili × N
    // Break even: fatturatoMedioMensile × N = fissiMensili + variabiliMensili × N
    //           → N = fissiMensili / (fatturatoMedioMensile - variabiliMensili)
    const margineContribuzione = fatturatoMedioMensile - variabiliMensili

    let beValore = null     // fatturato necessario per coprire i fissi
    let beMesi   = null     // mesi necessari per raggiungere il BE
    let margine  = null     // margine di sicurezza %

    if (margineContribuzione > 0) {
      // Punto di pareggio in mesi
      beMesi = fissiMensili / margineContribuzione

      // Fatturato mensile necessario (punto di pareggio con variabili proporzionali al fatturato)
      // Alternativa semplice: be = costi_fissi / (1 - variabili/fatturato)
      const varRate = fatturatoMedioMensile > 0
        ? variabiliMensili / fatturatoMedioMensile
        : 0
      beValore = varRate < 1
        ? fissiMensili / (1 - varRate)
        : null

      // Margine di sicurezza
      if (beValore && fatturatoMedioMensile > 0) {
        margine = ((fatturatoMedioMensile - beValore) / fatturatoMedioMensile) * 100
      }
    }

    // ── Aggiorna KPI break even ──────────────────────────────
    document.getElementById('be-valore').textContent =
      beValore !== null ? formatEuro(beValore) : '—'
    document.getElementById('be-fatturato').textContent =
      formatEuro(fatturatoMedioMensile)
    document.getElementById('be-fatturato-sub').textContent =
      `${mesiConDati.length} mesi con dati`
    document.getElementById('be-margine').textContent =
      margine !== null ? formatPercent(margine) : '—'
    document.getElementById('be-margine-sub').textContent =
      margine !== null && margine >= 0 ? 'sopra il punto di pareggio' : 'sotto il punto di pareggio'
    document.getElementById('be-mesi').textContent =
      beMesi !== null ? (beMesi <= 0 ? 'Già raggiunto' : beMesi.toFixed(1)) : '—'
    document.getElementById('be-mesi-sub').textContent =
      beMesi !== null && beMesi <= 0 ? '✓ Break even superato' : 'al ritmo attuale'

    // Nota informativa
    const nota = document.getElementById('be-note')
    const notaTesto = document.getElementById('be-note-text')
    if (nota && notaTesto) {
      nota.style.display = 'block'
      if (fatturatoMedioMensile === 0) {
        notaTesto.textContent = 'Nessun incasso registrato negli ultimi 6 mesi. Inserisci movimenti di tipo "incasso" per calcolare il break even.'
      } else if (margineContribuzione <= 0) {
        notaTesto.textContent = 'Attenzione: i costi variabili mensili superano il fatturato medio. Il break even non può essere raggiunto con le condizioni attuali.'
      } else if (margine !== null && margine >= 0) {
        notaTesto.textContent = `Il fatturato medio mensile (${formatEuro(fatturatoMedioMensile)}) supera già il punto di pareggio (${formatEuro(beValore)}). Margine di sicurezza: ${formatPercent(margine)}.`
      } else {
        notaTesto.textContent = `Con il fatturato attuale occorrono circa ${beMesi?.toFixed(1)} mesi per coprire tutti i costi fissi.`
      }
    }

    // ── Disegna il grafico ───────────────────────────────────
    disegnaGrafico(fissiMensili, variabiliMensili, fatturatoMedioMensile, beMesi)

    if (beLoading) beLoading.style.display = 'none'
    if (beCanvas)  beCanvas.style.display = 'block'

  } catch (err) {
    console.error('Errore calcolo break even:', err)
    if (beLoading) {
      beLoading.innerHTML = `<span style="color:var(--red)">Errore nel calcolo. Controlla Firestore.</span>`
    }
  }
}

// ============================================================
// GRAFICO BREAK EVEN (Chart.js)
// ============================================================
function disegnaGrafico(fissiMensili, variabiliMensili, fatturatoMedio, beMesi) {
  const canvas = document.getElementById('be-chart')
  if (!canvas || typeof Chart === 'undefined') return

  // Numero di mesi da mostrare nel grafico
  const mesiTotali = Math.max(12, Math.ceil((beMesi || 6) * 2))

  // Genera i punti per ogni mese (da 0 a mesiTotali)
  const labels = Array.from({ length: mesiTotali + 1 }, (_, i) => `Mese ${i}`)

  // Linea ricavi: cresce di fatturatoMedio ogni mese
  const dataRicavi = labels.map((_, i) => fatturatoMedio * i)

  // Linea costi totali: parte dai fissi e cresce dei variabili ogni mese
  const dataCosti = labels.map((_, i) => fissiMensili + variabiliMensili * i)

  // Punto di intersezione (break even) — aggiunto come dataset separato
  const dataBreakEven = labels.map((_, i) => {
    if (beMesi !== null && Math.abs(i - Math.round(beMesi)) < 0.5) {
      return fatturatoMedio * i
    }
    return null
  })

  // Distruggi il grafico precedente se esiste
  if (beChart) {
    beChart.destroy()
    beChart = null
  }

  const ctx = canvas.getContext('2d')
  beChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ricavi cumulativi',
          data: dataRicavi,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          borderWidth: 2.5,
          pointRadius: 0,
          fill: true,
          tension: 0
        },
        {
          label: 'Costi totali',
          data: dataCosti,
          borderColor: '#f87171',
          backgroundColor: 'rgba(248,113,113,0.06)',
          borderWidth: 2.5,
          pointRadius: 0,
          fill: false,
          tension: 0
        },
        {
          label: 'Break Even',
          data: dataBreakEven,
          borderColor: '#e6165c',
          backgroundColor: '#e6165c',
          pointRadius: 8,
          pointHoverRadius: 10,
          borderWidth: 0,
          fill: false,
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { family: 'Montserrat', size: 11, weight: '600' },
            color: '#4a6380',
            padding: 16,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: '#1b3050',
          titleFont: { family: 'Montserrat', size: 11, weight: '700' },
          bodyFont:  { family: 'Montserrat', size: 11 },
          callbacks: {
            label: ctx => {
              if (ctx.raw === null) return null
              return ` ${ctx.dataset.label}: ${formatEuro(ctx.raw)}`
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: {
            font: { family: 'Montserrat', size: 10 },
            color: '#8fa3b8',
            maxTicksLimit: 8
          }
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: {
            font: { family: 'Montserrat', size: 10 },
            color: '#8fa3b8',
            callback: v => formatEuro(v)
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
  const attivi = tuttICosti.filter(c => c.attivo !== false)

  const fissiMensili     = attivi
    .filter(c => c.tipo === 'fisso')
    .reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)

  const variabiliMensili = attivi
    .filter(c => c.tipo === 'variabile')
    .reduce((s, c) => s + toMensile(c.importo || 0, c.periodicita), 0)

  const annuali = (fissiMensili + variabiliMensili) * 12

  document.getElementById('kpi-fissi').textContent       = formatEuro(fissiMensili)
  document.getElementById('kpi-fissi-sub').textContent   =
    `${attivi.filter(c => c.tipo === 'fisso').length} voci attive`
  document.getElementById('kpi-variabili').textContent   = formatEuro(variabiliMensili)
  document.getElementById('kpi-variabili-sub').textContent =
    `${attivi.filter(c => c.tipo === 'variabile').length} voci attive`
  document.getElementById('kpi-annuale').textContent     = formatEuro(annuali)
  document.getElementById('kpi-count').textContent       = attivi.length
  document.getElementById('kpi-count-sub').textContent   =
    `di ${tuttICosti.length} totali`
}

// ============================================================
// TABELLA COSTI
// ============================================================
function renderTabella() {
  const wrap = document.getElementById('table-costi-wrap')
  if (!wrap) return

  // Filtra per tab attiva (fissi o variabili)
  const dati = tuttICosti.filter(c => c.tipo === tabAttiva)

  // Aggiorna visuale tab buttons
  document.getElementById('tab-fissi')?.classList.toggle('tab-active', tabAttiva === 'fissi')
  document.getElementById('tab-variabili')?.classList.toggle('tab-active', tabAttiva === 'variabili')

  if (dati.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
        </svg>
        <p>Nessun costo ${tabAttiva} registrato.</p>
        <p style="margin-top:6px;font-size:11px;">Clicca "Aggiungi costo" per iniziare.</p>
      </div>`
    return
  }

  let righe = dati.map(c => {
    const mensile    = toMensile(c.importo || 0, c.periodicita)
    const catClass   = classCategoria(c.categoria)
    const inattivo   = c.attivo === false ? 'costo-inattivo' : ''
    const badgeStato = c.attivo !== false
      ? '<span class="badge badge-green">Attivo</span>'
      : '<span class="badge badge-gray">Inattivo</span>'

    return `
      <tr class="${inattivo}">
        <td style="font-weight:600;color:var(--text0);">${c.descrizione || '—'}</td>
        <td>
          <span class="badge ${catClass}">${c.categoria || '—'}</span>
        </td>
        <td style="text-transform:capitalize;">${c.periodicita || '—'}</td>
        <td class="text-right fw-700" style="color:var(--text0);font-family:monospace;">
          ${formatEuro(mensile)}
        </td>
        <td>${badgeStato}</td>
        <td class="text-right">
          <button class="btn-icon" title="Modifica"
            onclick="window.__costiModule.openEdit('${c.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon" title="Elimina" style="color:var(--red);border-color:rgba(248,113,113,.25);"
            onclick="window.__costiModule.deleteCosto('${c.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </td>
      </tr>`
  }).join('')

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Descrizione</th>
          <th>Categoria</th>
          <th>Periodicità</th>
          <th class="text-right">Importo/mese</th>
          <th>Stato</th>
          <th class="text-right">Azioni</th>
        </tr>
      </thead>
      <tbody>${righe}</tbody>
    </table>`
}

// ============================================================
// SWITCH TAB
// ============================================================
function switchTab(nuovaTab) {
  tabAttiva = nuovaTab
  renderTabella()
}

// ============================================================
// MODAL — APRI NUOVO
// ============================================================
function openNew() {
  // Pulisce il form
  document.getElementById('costo-id').value           = ''
  document.getElementById('costo-descrizione').value  = ''
  document.getElementById('costo-importo').value      = ''
  document.getElementById('costo-periodicita').value  = 'mensile'
  document.getElementById('costo-tipo').value         = tabAttiva === 'variabili' ? 'variabile' : 'fisso'
  document.getElementById('costo-categoria').value    = ''
  document.getElementById('costo-attivo').checked     = true
  document.getElementById('costo-preview').style.display = 'none'

  document.getElementById('modal-costo-title').textContent = 'Nuovo costo'
  document.getElementById('modal-costo').classList.add('open')
}

// ============================================================
// MODAL — APRI MODIFICA
// ============================================================
function openEdit(id) {
  const costo = tuttICosti.find(c => c.id === id)
  if (!costo) return

  document.getElementById('costo-id').value           = costo.id
  document.getElementById('costo-descrizione').value  = costo.descrizione || ''
  document.getElementById('costo-importo').value      = costo.importo ?? ''
  document.getElementById('costo-periodicita').value  = costo.periodicita || 'mensile'
  document.getElementById('costo-tipo').value         = costo.tipo || 'fisso'
  document.getElementById('costo-categoria').value    = costo.categoria || ''
  document.getElementById('costo-attivo').checked     = costo.attivo !== false

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
// ANTEPRIMA IMPORTO MENSILE NEL MODAL
// ============================================================
function aggiornaPreviewMensile() {
  const importo    = parseFloat(document.getElementById('costo-importo').value) || 0
  const periodicita = document.getElementById('costo-periodicita').value
  const mensile    = toMensile(importo, periodicita)
  const preview    = document.getElementById('costo-preview')
  const previewVal = document.getElementById('costo-preview-val')

  if (importo > 0) {
    preview.style.display    = 'block'
    previewVal.textContent   = `${formatEuro(mensile)} / mese`
  } else {
    preview.style.display    = 'none'
  }
}

// ============================================================
// SALVA COSTO (add o update Firestore)
// ============================================================
async function saveCosto() {
  const id          = document.getElementById('costo-id').value
  const descrizione = document.getElementById('costo-descrizione').value.trim()
  const importo     = parseFloat(document.getElementById('costo-importo').value)
  const periodicita = document.getElementById('costo-periodicita').value
  const tipo        = document.getElementById('costo-tipo').value
  const categoria   = document.getElementById('costo-categoria').value.trim()
  const attivo      = document.getElementById('costo-attivo').checked

  // Validazione minima
  if (!descrizione) { toast('Inserisci una descrizione', 'error'); return }
  if (!importo || importo <= 0) { toast('Importo non valido', 'error'); return }
  if (!categoria) { toast('Inserisci una categoria', 'error'); return }

  const dati = {
    descrizione,
    importo,
    periodicita,
    tipo,
    categoria,
    attivo
  }

  try {
    if (id) {
      // Modifica documento esistente
      await collections.costi().doc(id).update(dati)
      toast('Costo aggiornato', 'success')
    } else {
      // Nuovo documento — aggiunge createdAt
      dati.createdAt = firebase.firestore.FieldValue.serverTimestamp()
      await collections.costi().add(dati)
      toast('Costo aggiunto', 'success')
    }

    // Ricarica dati e aggiorna tutto
    closeModal()
    await caricaCosti()
    aggiornaKPI()
    renderTabella()
    // Ricalcola break even con i nuovi dati
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
  const costo = tuttICosti.find(c => c.id === id)
  const nome  = costo?.descrizione || 'questo costo'

  if (!confirmDelete(`Vuoi eliminare "${nome}"?`)) return

  try {
    await collections.costi().doc(id).delete()
    toast('Costo eliminato', 'success')

    // Aggiorna dati e UI
    await caricaCosti()
    aggiornaKPI()
    renderTabella()
    await calcolaBreakEven()

  } catch (err) {
    console.error('Errore eliminazione costo:', err)
    toast('Errore nell\'eliminazione', 'error')
  }
}

// ============================================================
// CARICA CHART.JS DA CDN (se non già caricato)
// ============================================================
function caricaChartJS() {
  return new Promise((resolve) => {
    // Se Chart.js è già disponibile non lo carichiamo di nuovo
    if (typeof Chart !== 'undefined') { resolve(); return }

    const script = document.createElement('script')
    script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
    script.onload  = resolve
    script.onerror = () => {
      console.error('Impossibile caricare Chart.js')
      resolve() // prosegue comunque
    }
    document.head.appendChild(script)
  })
}
