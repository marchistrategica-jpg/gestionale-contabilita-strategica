/**
 * ============================================================
 * MODULO: Dashboard — Logica JS
 * File:   js/modules/dashboard.js
 *
 * Esportato: export async function init()
 * Chiamato da router.js ogni volta che si naviga su #dashboard
 *
 * DIPENDENZE:
 *   js/firebase-config.js → db, collections
 *   js/utils.js           → formatEuro, formatDate, formatDateShort
 *   Chart.js              → caricato da dashboard.html via CDN
 * ============================================================
 */

import { db, collections }                    from '../../js/firebase-config.js'
import { formatEuro, formatDate, formatDateShort } from '../../js/utils.js'

// Riferimento globale al grafico — serve per distruggerlo
// se l'utente naviga via e torna (evita grafici sovrapposti)
let graficoMensile = null


// ============================================================
// INIT — punto di ingresso chiamato dal router
// ============================================================
export async function init () {

  // Aggiorna il sotto-titolo del KPI incassi col nome del mese corrente
  const elSub = document.getElementById('kpi-incassi-sub')
  if (elSub) elSub.textContent = _nomeMeseCorrente()

  try {
    // ── Lettura parallela da Firestore ──────────────────────
    // Promise.all fa partire tutte e tre le richieste insieme,
    // poi aspetta che siano tutte completate. Più veloce che
    // farle una alla volta in sequenza.
    const [snapMov, snapContratti, snapConti] = await Promise.all([
      collections.movimenti().orderBy('data', 'desc').get(),
      collections.contratti().get(),
      collections.conti().get(),
    ])

    // Converte gli snapshot Firestore in array JS semplici
    const movimenti  = snapMov.docs.map(d => ({ id: d.id, ...d.data() }))
    const contratti  = snapContratti.docs.map(d => ({ id: d.id, ...d.data() }))
    const conti      = snapConti.docs.map(d => ({ id: d.id, ...d.data() }))

    // ── Popola le sezioni ───────────────────────────────────
    _popolaKpi(movimenti, contratti, conti)
    _popolaGrafico(movimenti)
    _popolaMovimenti(movimenti)
    _popolaScadenze(contratti)

  } catch (err) {
    console.error('Dashboard: errore Firebase →', err)
    // Mostra un messaggio d'errore nella griglia KPI
    const grid = document.getElementById('kpi-grid')
    if (grid) grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <p>Errore nel caricamento dei dati. Controlla la connessione Firebase.</p>
      </div>`
  }
}


// ============================================================
// SEZIONE 1 — KPI Cards
// ============================================================
function _popolaKpi (movimenti, contratti, conti) {

  const oggi        = new Date()
  const annoCorrente = oggi.getFullYear()
  const meseCorrente = oggi.getMonth()   // 0 = gennaio

  // KPI 1: Fatturato YTD — somma incassi dall'1 gennaio ad oggi
  const fatturatoYtd = movimenti
    .filter(m => m.tipo === 'incasso' && _annoOf(m.data) === annoCorrente)
    .reduce((acc, m) => acc + (m.importo || 0), 0)
  _setKpi('kpi-fatturato', formatEuro(fatturatoYtd))

  // KPI 2: Incassi mese corrente
  const incassiMese = movimenti
    .filter(m => m.tipo === 'incasso'
              && _annoOf(m.data) === annoCorrente
              && _meseOf(m.data) === meseCorrente)
    .reduce((acc, m) => acc + (m.importo || 0), 0)
  _setKpi('kpi-incassi', formatEuro(incassiMese))

  // KPI 3: Pagamenti mese corrente
  const pagamentiMese = movimenti
    .filter(m => m.tipo === 'pagamento'
              && _annoOf(m.data) === annoCorrente
              && _meseOf(m.data) === meseCorrente)
    .reduce((acc, m) => acc + (m.importo || 0), 0)
  _setKpi('kpi-pagamenti', formatEuro(pagamentiMese))

  // KPI 4: Contratti attivi
  const nAttivi = contratti.filter(c => c.stato === 'attivo').length
  _setKpi('kpi-contratti', String(nAttivi))

  // KPI 5: Saldo totale conti
  // Parte dai saldi iniziali, poi somma incassi e sottrae pagamenti
  const saldoIniziale = conti.reduce((acc, c) => acc + (c.saldo_iniziale || 0), 0)
  const delta = movimenti.reduce((acc, m) => {
    if (m.tipo === 'incasso')   return acc + (m.importo || 0)
    if (m.tipo === 'pagamento') return acc - (m.importo || 0)
    return acc
  }, 0)
  _setKpi('kpi-saldo', formatEuro(saldoIniziale + delta))
}


// ============================================================
// SEZIONE 2 — Grafico andamento mensile (Chart.js)
// ============================================================
function _popolaGrafico (movimenti) {

  const elLoading = document.getElementById('chart-loading')
  const elWrap    = document.getElementById('chart-wrap')
  const elEmpty   = document.getElementById('chart-empty')

  // Costruisce le etichette e i dati per gli ultimi 6 mesi
  const oggi    = new Date()
  const labels  = []
  const incassi = []
  const uscite  = []

  for (let i = 5; i >= 0; i--) {
    // Data del primo giorno del mese di riferimento
    const ref  = new Date(oggi.getFullYear(), oggi.getMonth() - i, 1)
    const anno = ref.getFullYear()
    const mese = ref.getMonth()

    labels.push(ref.toLocaleString('it-IT', { month: 'short', year: '2-digit' }))

    incassi.push(
      movimenti
        .filter(m => m.tipo === 'incasso' && _annoOf(m.data) === anno && _meseOf(m.data) === mese)
        .reduce((acc, m) => acc + (m.importo || 0), 0)
    )

    uscite.push(
      movimenti
        .filter(m => m.tipo === 'pagamento' && _annoOf(m.data) === anno && _meseOf(m.data) === mese)
        .reduce((acc, m) => acc + (m.importo || 0), 0)
    )
  }

  // Nasconde il loading
  if (elLoading) elLoading.style.display = 'none'

  // Se non ci sono dati mostra lo stato vuoto
  const hasDati = incassi.some(v => v > 0) || uscite.some(v => v > 0)
  if (!hasDati) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }

  // Mostra il canvas
  if (elWrap) elWrap.style.display = 'block'

  // Aspetta che Chart.js sia disponibile (CDN asincrono)
  _attendiChart(3000).then(() => {

    const canvas = document.getElementById('chart-mensile')
    if (!canvas) return

    // Distrugge il grafico precedente se esiste
    if (graficoMensile) {
      graficoMensile.destroy()
      graficoMensile = null
    }

    graficoMensile = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Incassi',
            data: incassi,
            backgroundColor: 'rgba(16,185,129,0.75)',
            borderColor: 'rgba(16,185,129,1)',
            borderWidth: 1.5,
            borderRadius: 4,
          },
          {
            label: 'Uscite',
            data: uscite,
            backgroundColor: 'rgba(248,113,113,0.75)',
            borderColor: 'rgba(248,113,113,1)',
            borderWidth: 1.5,
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: 'Montserrat', size: 11 }, padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${formatEuro(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Montserrat', size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#edf1f7' },
            ticks: {
              font: { family: 'Montserrat', size: 11 },
              callback: v => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`
            }
          }
        }
      }
    })

  }).catch(() => {
    // Chart.js non si è caricato entro il timeout
    console.warn('Dashboard: Chart.js non disponibile')
    if (elWrap)  elWrap.style.display  = 'none'
    if (elEmpty) {
      elEmpty.style.display = 'flex'
      elEmpty.querySelector('p').textContent =
        'Grafico non disponibile. Controlla la connessione internet.'
    }
  })
}


// ============================================================
// SEZIONE 3 — Tabella ultimi 10 movimenti
// ============================================================
function _popolaMovimenti (movimenti) {

  const elLoading = document.getElementById('mov-loading')
  const elWrap    = document.getElementById('mov-wrap')
  const elEmpty   = document.getElementById('mov-empty')
  const tbody     = document.getElementById('tb-movimenti')

  if (elLoading) elLoading.style.display = 'none'

  if (!movimenti.length) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }

  // Prende i primi 10 (già ordinati per data desc da Firestore)
  const righe = movimenti.slice(0, 10).map(m => {
    const data  = _toDate(m.data)
    const badge = m.tipo === 'incasso'
      ? '<span class="badge badge-green">Incasso</span>'
      : '<span class="badge badge-red">Pagamento</span>'
    const impClass = m.tipo === 'incasso' ? 'imp-incasso' : 'imp-pagamento'
    const segno    = m.tipo === 'incasso' ? '+' : '-'

    return `<tr>
      <td>${data ? formatDateShort(data) : '—'}</td>
      <td>${_esc(m.descrizione || m.categoria || '—')}</td>
      <td>${badge}</td>
      <td class="text-right"><span class="${impClass}">${segno}${formatEuro(m.importo || 0)}</span></td>
    </tr>`
  }).join('')

  if (tbody) tbody.innerHTML = righe
  if (elWrap) elWrap.style.display = 'block'
}


// ============================================================
// SEZIONE 4 — Tabella contratti in scadenza (60 giorni)
// ============================================================
function _popolaScadenze (contratti) {

  const elLoading = document.getElementById('sca-loading')
  const elWrap    = document.getElementById('sca-wrap')
  const elEmpty   = document.getElementById('sca-empty')
  const tbody     = document.getElementById('tb-contratti')

  if (elLoading) elLoading.style.display = 'none'

  const oggi       = new Date(); oggi.setHours(0,0,0,0)
  const tra60      = new Date(oggi); tra60.setDate(tra60.getDate() + 60)

  // Filtra e ordina per data_fine crescente (scadono prima → appaiono prima)
  const inScadenza = contratti
    .filter(c => {
      const df = _toDate(c.data_fine)
      return df && df >= oggi && df <= tra60 && c.stato !== 'concluso'
    })
    .sort((a, b) => _toDate(a.data_fine) - _toDate(b.data_fine))

  if (!inScadenza.length) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }

  const righe = inScadenza.map(c => {
    const df      = _toDate(c.data_fine)
    const giorni  = df ? Math.ceil((df - oggi) / 86400000) : null
    const gLabel  = giorni === 0 ? 'oggi!'
                  : giorni === 1 ? 'domani!'
                  : giorni != null ? `tra ${giorni} gg`
                  : ''

    // Badge stato
    const stati = {
      attivo:   'badge-green',
      scaduto:  'badge-red',
      sospeso:  'badge-amber',
      concluso: 'badge-gray',
    }
    const badgeClass = stati[c.stato] || 'badge-gray'
    const badgeLabel = c.stato
      ? c.stato.charAt(0).toUpperCase() + c.stato.slice(1)
      : '—'

    return `<tr>
      <td>${_esc(c.cliente || '—')}</td>
      <td>
        ${df ? formatDate(df) : '—'}
        ${gLabel ? `<span class="giorni-badge">${gLabel}</span>` : ''}
      </td>
      <td class="text-right">${formatEuro(c.valore || 0)}</td>
      <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
    </tr>`
  }).join('')

  if (tbody) tbody.innerHTML = righe
  if (elWrap) elWrap.style.display = 'block'
}


// ============================================================
// UTILITY PRIVATE
// ============================================================

/** Converte un valore data Firestore (Timestamp | Date | string) in Date JS */
function _toDate (val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()  // Firestore Timestamp
  const d = new Date(val)
  return isNaN(d) ? null : d
}

/** Anno di una data Firestore */
function _annoOf (val) {
  const d = _toDate(val)
  return d ? d.getFullYear() : -1
}

/** Mese (0-11) di una data Firestore */
function _meseOf (val) {
  const d = _toDate(val)
  return d ? d.getMonth() : -1
}

/** Imposta il testo di un elemento KPI */
function _setKpi (id, valore) {
  const el = document.getElementById(id)
  if (el) el.textContent = valore
}

/** Nome del mese corrente in italiano (es. "Aprile 2025") */
function _nomeMeseCorrente () {
  return new Date().toLocaleString('it-IT', { month: 'long', year: 'numeric' })
}

/** Escape HTML per prevenire XSS */
function _esc (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Aspetta che window.Chart sia disponibile (CDN asincrono).
 * Controlla ogni 100ms fino a timeoutMs.
 */
function _attendiChart (timeoutMs) {
  return new Promise((resolve, reject) => {
    if (window.Chart) { resolve(); return }
    const start = Date.now()
    const t = setInterval(() => {
      if (window.Chart) { clearInterval(t); resolve() }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject() }
    }, 100)
  })
}
