/**
 * ============================================================
 * MODULO: Dashboard v2
 * File:   js/modules/dashboard.js
 *
 * KPI aggiornati:
 *   1. Valore contratti     → somma importo_totale di tutti i contratti correnti
 *   2. Incassi del mese     → movimenti tipo='incasso' mese corrente (IVA inclusa)
 *   3. Incassi programmati  → rate stato='attesa' con data_prevista nel mese corrente
 *   4. Contratti attivi     → contratti con stato='corrente'
 *   5+. Saldo per conto     → un KPI card per ogni conto (Revolut, CREDEM, ecc.)
 *
 * Sezione "Rate in scadenza" → rate stato='attesa' con data_prevista entro 60gg
 * ============================================================
 */

import { collections }                              from '../../js/firebase-config.js'
import { formatEuro, formatDate, formatDateShort }  from '../../js/utils.js'

// Riferimento globale al grafico
let graficoMensile = null


// ============================================================
// INIT
// ============================================================
export async function init() {

  // Distruggi grafico precedente se esiste (evita duplicati su re-navigazione)
  if (graficoMensile) {
    try { graficoMensile.destroy() } catch(e) {}
    graficoMensile = null
  }

  // Sotto-titolo KPI incassi con nome mese corrente
  const elSub = document.getElementById('kpi-incassi-sub')
  if (elSub) elSub.textContent = _nomeMeseCorrente()

  const elRateSub = document.getElementById('kpi-rate-mese-sub')
  if (elRateSub) elRateSub.textContent = `Rate in attesa — ${_nomeMeseCorrente()}`

  try {
    // Legge tutte le collezioni in parallelo (cache:false forza dati freschi)
    const opts = { source: 'server' }
    const [snapMov, snapContratti, snapConti, snapRate] = await Promise.all([
      collections.movimenti().orderBy('data', 'desc').get(opts),
      collections.contratti().get(opts),
      collections.conti().get(opts),
      collections.rate().get(opts),
    ])

    const movimenti  = snapMov.docs.map(d => ({ id: d.id, ...d.data() }))
    const contratti  = snapContratti.docs.map(d => ({ id: d.id, ...d.data() }))
    const conti      = snapConti.docs.map(d => ({ id: d.id, ...d.data() }))
    const rate       = snapRate.docs.map(d => ({ id: d.id, ...d.data() }))

    _popolaKpi(movimenti, contratti, conti, rate)
    _popolaGrafico(movimenti)
    _popolaMovimenti(movimenti)
    _popolaRateScadenza(rate, contratti)

  } catch (err) {
    console.error('Dashboard: errore Firebase →', err)
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
function _popolaKpi(movimenti, contratti, conti, rate) {

  const oggi         = new Date()
  const annoCorrente = oggi.getFullYear()
  const meseCorrente = oggi.getMonth()

  // ── KPI 1: Valore contratti (tutti tranne conclusi) ──────
  const valoreContratti = contratti
    .filter(c => c.stato !== 'concluso')
    .reduce((acc, c) => acc + (c.importo_totale || 0), 0)

  const nCorrente = contratti.filter(c => c.stato === 'corrente').length

  _setKpi('kpi-valore-contratti', formatEuro(valoreContratti))
  _setKpi('kpi-valore-contratti-sub', `${contratti.filter(c => c.stato !== 'concluso').length} contratti attivi`)

  // ── KPI 2: Incassi del mese (da movimenti) ──────────────
  const incassiMese = movimenti
    .filter(m => m.tipo === 'incasso'
              && _annoOf(m.data) === annoCorrente
              && _meseOf(m.data) === meseCorrente)
    .reduce((acc, m) => acc + (m.importo || 0), 0)

  _setKpi('kpi-incassi', formatEuro(incassiMese))

  // ── KPI 3: Rate programmate questo mese (in attesa) ─────
  const rateMese = rate
    .filter(r => r.stato === 'attesa'
              && _annoOf(r.data_prevista) === annoCorrente
              && _meseOf(r.data_prevista) === meseCorrente)

  const totRateMese = rateMese.reduce((acc, r) => acc + (r.importo_totale || 0), 0)
  _setKpi('kpi-rate-mese', formatEuro(totRateMese))
  _setKpi('kpi-rate-mese-sub', `${rateMese.length} rata${rateMese.length !== 1 ? 'e' : ''} in attesa`)

  // ── KPI 4: Contratti correnti ───────────────────────────
  _setKpi('kpi-contratti', String(nCorrente))

  // ── KPI 5+: Saldo per singolo conto ────────────────────
  _renderKpiConti(conti, movimenti)
}


// ============================================================
// KPI CONTI — un card per ogni conto corrente
// ============================================================
function _renderKpiConti(conti, movimenti) {
  const container = document.getElementById('kpi-conti-container')
  if (!container) return

  if (!conti.length) {
    container.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Saldo conti</div>
        <div class="kpi-value">—</div>
        <div class="kpi-sub">Nessun conto registrato</div>
      </div>`
    return
  }

  container.innerHTML = conti.map(conto => {
    const saldo = _calcolaSaldoConto(conto, movimenti)
    const coloreSaldo = saldo >= 0 ? 'var(--green)' : 'var(--red)'
    // Colore card in base al tipo di conto (verde per positivo, rosso per negativo)
    const cardClass = saldo >= 0 ? 'kpi-card green' : 'kpi-card red'

    return `
      <div class="${cardClass}">
        <div class="kpi-label">${_esc(conto.nome || conto.banca || 'Conto')}</div>
        <div class="kpi-value" style="color:${coloreSaldo};">${formatEuro(saldo)}</div>
        <div class="kpi-sub">${_esc(conto.banca || '')}</div>
      </div>`
  }).join('')
}

// Calcola saldo reale: saldo_iniziale + movimenti del conto
function _calcolaSaldoConto(conto, movimenti) {
  const base = Number(conto.saldo_iniziale) || 0

  const delta = movimenti
    .filter(m => m.conto === conto.id || m.conto === conto.nome)
    .reduce((acc, m) => {
      const imp = Number(m.importo) || 0
      return acc + (m.tipo === 'incasso' ? imp : -imp)
    }, 0)

  return base + delta
}


// ============================================================
// SEZIONE 2 — Grafico andamento mensile (Chart.js)
// ============================================================
function _popolaGrafico(movimenti) {

  const elLoading = document.getElementById('chart-loading')
  const elWrap    = document.getElementById('chart-wrap')
  const elEmpty   = document.getElementById('chart-empty')

  const oggi    = new Date()
  const labels  = []
  const incassi = []
  const uscite  = []

  for (let i = 5; i >= 0; i--) {
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

  if (elLoading) elLoading.style.display = 'none'

  const hasDati = incassi.some(v => v > 0) || uscite.some(v => v > 0)
  if (!hasDati) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }

  if (elWrap) elWrap.style.display = 'block'

  _attendiChart(3000).then(() => {
    const canvas = document.getElementById('chart-mensile')
    if (!canvas) return

    if (graficoMensile) { graficoMensile.destroy(); graficoMensile = null }

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
              callback: v => v >= 1000 ? `€${(v/1000).toFixed(0)}k` : `€${v}`
            }
          }
        }
      }
    })
  }).catch(() => {
    if (elWrap)  elWrap.style.display  = 'none'
    if (elEmpty) elEmpty.style.display = 'flex'
  })
}


// ============================================================
// SEZIONE 3 — Tabella ultimi 10 movimenti
// ============================================================
function _popolaMovimenti(movimenti) {
  const elLoading = document.getElementById('mov-loading')
  const elWrap    = document.getElementById('mov-wrap')
  const elEmpty   = document.getElementById('mov-empty')
  const tbody     = document.getElementById('tb-movimenti')

  if (elLoading) elLoading.style.display = 'none'

  if (!movimenti.length) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }

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
// SEZIONE 4 — Rate in scadenza (prossimi 60 giorni)
// ============================================================
function _popolaRateScadenza(rate, contratti) {
  const elLoading = document.getElementById('sca-loading')
  const elWrap    = document.getElementById('sca-wrap')
  const elEmpty   = document.getElementById('sca-empty')
  const tbody     = document.getElementById('tb-rate-scadenza')

  if (elLoading) elLoading.style.display = 'none'

  const oggi  = new Date(); oggi.setHours(0, 0, 0, 0)
  const tra60 = new Date(oggi); tra60.setDate(tra60.getDate() + 60)

  // Filtra rate in attesa entro 60 giorni (incluse quelle già scadute)
  const rateInScadenza = rate
    .filter(r => {
      const dp = _toDate(r.data_prevista)
      return r.stato === 'attesa' && dp && dp <= tra60
    })
    .sort((a, b) => _toDate(a.data_prevista) - _toDate(b.data_prevista))

  if (!rateInScadenza.length) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }

  const righe = rateInScadenza.map(r => {
    const dp     = _toDate(r.data_prevista)
    const giorni = dp ? Math.ceil((dp - oggi) / 86400000) : null

    let giorniHtml = ''
    if (giorni !== null) {
      if (giorni < 0) {
        giorniHtml = `<span class="giorni-badge rosso">${Math.abs(giorni)}gg fa</span>`
      } else if (giorni === 0) {
        giorniHtml = `<span class="giorni-badge rosso">oggi!</span>`
      } else {
        giorniHtml = `<span class="giorni-badge">tra ${giorni}gg</span>`
      }
    }

    return `<tr>
      <td style="font-weight:600;">${_esc(r.cliente || '—')}</td>
      <td style="font-size:11px;color:var(--text2);">${_esc(r.descrizione || 'Rata')}</td>
      <td>
        ${dp ? formatDate(dp) : '—'}
        ${giorniHtml}
      </td>
      <td class="text-right" style="font-weight:700;color:var(--text0);">${formatEuro(r.importo_totale || 0)}</td>
    </tr>`
  }).join('')

  if (tbody) tbody.innerHTML = righe
  if (elWrap) elWrap.style.display = 'block'
}


// ============================================================
// UTILITY
// ============================================================

function _toDate(val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()
  const d = new Date(val)
  return isNaN(d) ? null : d
}

function _annoOf(val) {
  const d = _toDate(val)
  return d ? d.getFullYear() : -1
}

function _meseOf(val) {
  const d = _toDate(val)
  return d ? d.getMonth() : -1
}

function _setKpi(id, valore) {
  const el = document.getElementById(id)
  if (el) el.textContent = valore
}

function _nomeMeseCorrente() {
  return new Date().toLocaleString('it-IT', { month: 'long', year: 'numeric' })
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function _attendiChart(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (window.Chart) { resolve(); return }
    const start = Date.now()
    const t = setInterval(() => {
      if (window.Chart) { clearInterval(t); resolve() }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject() }
    }, 100)
  })
}
