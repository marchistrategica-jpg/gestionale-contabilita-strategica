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

// Riferimento globale ai grafici
let graficoMensile = null
let graficoTorta   = null

// Mese e anno selezionati
let _meseAttivo = new Date().getMonth() + 1
let _annoAttivo = new Date().getFullYear()


// ============================================================
// INIT
// ============================================================
export async function init() {

  // Distruggi grafico precedente se esiste
  graficoMensile = null
  graficoTorta = null

  // Popola selettore anni
  const selAnno = document.getElementById('dash-anno')
  if (selAnno) {
    selAnno.innerHTML = ''
    const ac = new Date().getFullYear()
    for (let a = ac; a >= ac - 3; a--) {
      const opt = document.createElement('option')
      opt.value = a; opt.textContent = a
      selAnno.appendChild(opt)
    }
  }

  // Imposta mese e anno corrente
  const selMese = document.getElementById('dash-mese')
  if (selMese) selMese.value = _meseAttivo
  if (selAnno) selAnno.value = _annoAttivo

  // Listener cambio mese/anno
  document.getElementById('dash-mese')?.addEventListener('change', e => {
    _meseAttivo = parseInt(e.target.value)
    _aggiornaSottoTitoli()
    _caricaDati()
  })
  document.getElementById('dash-anno')?.addEventListener('change', e => {
    _annoAttivo = parseInt(e.target.value)
    _aggiornaSottoTitoli()
    _caricaDati()
  })

  // Bottone refresh
  document.getElementById('btn-dash-refresh')?.addEventListener('click', () => _caricaDati())

  _aggiornaSottoTitoli()
  await _caricaDati()
}

function _aggiornaSottoTitoli() {
  const nomeMese = new Date(_annoAttivo, _meseAttivo - 1, 1)
    .toLocaleString('it-IT', { month: 'long', year: 'numeric' })
  const elSub = document.getElementById('kpi-incassi-sub')
  if (elSub) elSub.textContent = nomeMese
  const elRateSub = document.getElementById('kpi-rate-mese-sub')
  if (elRateSub) elRateSub.textContent = nomeMese
}

async function _caricaDati() {
  // Mostra timestamp ultimo aggiornamento
  const elUp = document.getElementById('dash-last-update')
  if (elUp) elUp.textContent = 'Aggiornamento in corso...'

  try {
    // Legge tutte le collezioni forzando dati freschi dal server
    const _get = async (query) => {
      try { return await query.get({ source: 'server' }) }
      catch (e) { return await query.get() }
    }
    const [snapMov, snapContratti, snapConti, snapRate] = await Promise.all([
      _get(collections.movimenti().orderBy('data', 'desc')),
      _get(collections.contratti()),
      _get(collections.conti()),
      _get(collections.rate()),
    ])

    const movimenti  = snapMov.docs.map(d => ({ id: d.id, ...d.data() }))
    const contratti  = snapContratti.docs.map(d => ({ id: d.id, ...d.data() }))
    const conti      = snapConti.docs.map(d => ({ id: d.id, ...d.data() }))
    const rate       = snapRate.docs.map(d => ({ id: d.id, ...d.data() }))

    _popolaKpi(movimenti, contratti, conti, rate)
    _popolaGrafico(movimenti)
    _popolaTorta(movimenti)
    _popolaMovimenti(movimenti)
    _popolaRateScadenza(rate, contratti)

    // Timestamp aggiornamento
    const elUp = document.getElementById('dash-last-update')
    if (elUp) {
      const ora = new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })
      elUp.textContent = `Aggiornato alle ${ora}`
    }

  } catch (err) {
    console.error('Dashboard: errore Firebase →', err)
    const elUp = document.getElementById('dash-last-update')
    if (elUp) elUp.textContent = `Errore: ${err.message}`
    const grid = document.getElementById('kpi-grid')
    if (grid) grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <p>Errore nel caricamento dei dati.</p>
        <p style="font-size:11px;margin-top:6px;color:var(--text2);">${err.message}</p>
      </div>`
  }
}


// ============================================================
// SEZIONE 1 — KPI Cards
// ============================================================
function _popolaKpi(movimenti, contratti, conti, rate) {

  // Usa mese e anno dal selettore dashboard
  const meseCorrente = _meseAttivo - 1  // 0-based
  const annoCorrente = _annoAttivo

  // ── KPI 1: Valore contratti chiusi nel mese selezionato ──
  const contrattiMese = contratti.filter(c => {
    const d = c.data_inizio?.toDate ? c.data_inizio.toDate() : new Date(c.data_inizio)
    return !isNaN(d) && d.getFullYear() === annoCorrente && d.getMonth() === meseCorrente
  })
  const valoreChiusiMese = contrattiMese
    .reduce((acc, c) => acc + (c.importo_totale || c.valore || 0), 0)

  _setKpi('kpi-valore-contratti', formatEuro(valoreChiusiMese))
  _setKpi('kpi-valore-contratti-sub', `${contrattiMese.length} contratt${contrattiMese.length === 1 ? 'o' : 'i'} chiusi`)

  // ── KPI 2: Incassi del mese selezionato ─────────────────
  const incassiMese = movimenti
    .filter(m => m.tipo === 'incasso'
              && _annoOf(m.data) === annoCorrente
              && _meseOf(m.data) === meseCorrente)
    .reduce((acc, m) => acc + (m.importo || 0), 0)

  _setKpi('kpi-incassi', formatEuro(incassiMese))

  // ── KPI 3: Rate in attesa nel mese selezionato ───────────
  const rateMese = rate
    .filter(r => r.stato === 'attesa'
              && _annoOf(r.data_prevista) === annoCorrente
              && _meseOf(r.data_prevista) === meseCorrente)

  const totRateMese = rateMese.reduce((acc, r) => acc + (r.importo_totale || 0), 0)
  _setKpi('kpi-rate-mese', formatEuro(totRateMese))
  _setKpi('kpi-rate-mese-sub', `${rateMese.length} rata${rateMese.length !== 1 ? 'e' : ''} in attesa`)

  // ── KPI 4: Contratti attivi (tutti, non dipende dal mese) ─
  const nAttivi = contratti.filter(c => c.stato !== 'concluso' && c.stato !== 'sospeso').length
  _setKpi('kpi-contratti', String(nAttivi))

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

  // Confronto robusto: ID Firestore, nome del conto, o conto_nome denormalizzato
  const nomeNorm = (conto.nome || '').toLowerCase().trim()

  const delta = movimenti
    .filter(m => {
      if (!m.conto && !m.conto_nome) return false
      if (m.conto === conto.id) return true                          // match per ID
      if (m.conto === conto.nome) return true                        // match per nome esatto
      if (m.conto_nome === conto.nome) return true                   // match per conto_nome
      // match case-insensitive per retrocompatibilità con testo libero
      const mc = (m.conto || m.conto_nome || '').toLowerCase().trim()
      return mc === nomeNorm
    })
    .reduce((acc, m) => {
      const imp = Number(m.importo) || 0
      return acc + (m.tipo === 'incasso' ? imp : -imp)
    }, 0)

  return base + delta
}


// ============================================================
// SEZIONE 2 — Grafico barre SVG: Incassi vs Uscite ultimi 6 mesi
// ============================================================
function _popolaGrafico(movimenti) {
  const elLoading = document.getElementById('chart-loading')
  const elWrap    = document.getElementById('chart-wrap')
  const elEmpty   = document.getElementById('chart-empty')

  if (elLoading) elLoading.style.display = 'none'

  const oggi = new Date()
  const mesi = []

  for (let i = 5; i >= 0; i--) {
    const ref  = new Date(oggi.getFullYear(), oggi.getMonth() - i, 1)
    const anno = ref.getFullYear()
    const mese = ref.getMonth()
    const label = ref.toLocaleString('it-IT', { month: 'short' })

    const inc = movimenti
      .filter(m => m.tipo === 'incasso' && _annoOf(m.data) === anno && _meseOf(m.data) === mese)
      .reduce((a, m) => a + (m.importo || 0), 0)

    const usc = movimenti
      .filter(m => m.tipo === 'pagamento' && _annoOf(m.data) === anno && _meseOf(m.data) === mese)
      .reduce((a, m) => a + (m.importo || 0), 0)

    mesi.push({ label, inc, usc })
  }

  const hasDati = mesi.some(m => m.inc > 0 || m.usc > 0)
  if (!hasDati) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }
  if (elWrap) elWrap.style.display = 'block'

  const maxVal = Math.max(...mesi.map(m => Math.max(m.inc, m.usc)), 1)
  const W = 560, H = 200, PAD = 40, BAR_W = 28, GAP = 10
  const colW = (W - PAD) / 6

  let svgBars = ''
  mesi.forEach((m, i) => {
    const x = PAD + i * colW + colW / 2
    const hInc = (m.inc / maxVal) * (H - 30)
    const hUsc = (m.usc / maxVal) * (H - 30)

    // Barra incassi (verde)
    svgBars += `<rect x="${x - BAR_W - GAP/2}" y="${H - 20 - hInc}" width="${BAR_W}" height="${hInc}" rx="3" fill="rgba(16,185,129,0.85)"/>`
    // Barra uscite (rossa)
    svgBars += `<rect x="${x + GAP/2}" y="${H - 20 - hUsc}" width="${BAR_W}" height="${hUsc}" rx="3" fill="rgba(248,113,113,0.85)"/>`
    // Label mese
    svgBars += `<text x="${x}" y="${H}" text-anchor="middle" font-size="10" font-family="Montserrat,sans-serif" fill="#8fa3b8">${m.label}</text>`
    // Valore incasso sopra barra
    if (m.inc > 0) svgBars += `<text x="${x - BAR_W/2 - GAP/2}" y="${H - 22 - hInc}" text-anchor="middle" font-size="8" font-family="Montserrat,sans-serif" fill="var(--green)" font-weight="700">${m.inc >= 1000 ? (m.inc/1000).toFixed(0)+'k' : m.inc}</text>`
    if (m.usc > 0) svgBars += `<text x="${x + BAR_W/2 + GAP/2}" y="${H - 22 - hUsc}" text-anchor="middle" font-size="8" font-family="Montserrat,sans-serif" fill="var(--red)" font-weight="700">${m.usc >= 1000 ? (m.usc/1000).toFixed(0)+'k' : m.usc}</text>`
  })

  // Linee griglia orizzontali
  let grid = ''
  for (let j = 1; j <= 4; j++) {
    const y = H - 20 - (j / 4) * (H - 30)
    grid += `<line x1="${PAD}" y1="${y}" x2="${W}" y2="${y}" stroke="#edf1f7" stroke-width="1"/>`
    const val = (maxVal * j / 4)
    grid += `<text x="${PAD - 4}" y="${y + 3}" text-anchor="end" font-size="8" font-family="Montserrat,sans-serif" fill="#8fa3b8">€${val >= 1000 ? (val/1000).toFixed(0)+'k' : val.toFixed(0)}</text>`
  }

  // Legenda
  const legenda = `
    <rect x="${W/2 - 70}" y="${H + 10}" width="12" height="8" rx="2" fill="rgba(16,185,129,0.85)"/>
    <text x="${W/2 - 55}" y="${H + 17}" font-size="10" font-family="Montserrat,sans-serif" fill="#4a6380" font-weight="600">Incassi</text>
    <rect x="${W/2 + 10}" y="${H + 10}" width="12" height="8" rx="2" fill="rgba(248,113,113,0.85)"/>
    <text x="${W/2 + 25}" y="${H + 17}" font-size="10" font-family="Montserrat,sans-serif" fill="#4a6380" font-weight="600">Uscite</text>`

  const canvas = document.getElementById('chart-mensile')
  if (canvas) {
    canvas.outerHTML = `<div id="chart-mensile" style="width:100%;overflow-x:auto;">
      <svg viewBox="0 0 ${W} ${H + 30}" style="width:100%;max-width:${W}px;display:block;margin:0 auto;">
        ${grid}${svgBars}${legenda}
      </svg>
    </div>`
  } else {
    const wrap = document.getElementById('chart-wrap')
    if (wrap) wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H + 30}" style="width:100%;max-width:${W}px;display:block;margin:0 auto;">
      ${grid}${svgBars}${legenda}
    </svg>`
  }
}


// ============================================================
// SEZIONE 2b — Grafico torta SVG: Categorie di spesa
// ============================================================
function _popolaTorta(movimenti) {
  const elLoading = document.getElementById('chart-torta-loading')
  const elWrap    = document.getElementById('chart-torta-wrap')
  const elEmpty   = document.getElementById('chart-torta-empty')

  if (elLoading) elLoading.style.display = 'none'

  const oggi     = new Date()
  const sei_mesi = new Date(oggi.getFullYear(), oggi.getMonth() - 5, 1)

  const perCat = {}
  movimenti
    .filter(m => {
      if (m.tipo !== 'pagamento') return false
      const d = m.data?.toDate ? m.data.toDate() : new Date(m.data)
      return d >= sei_mesi
    })
    .forEach(m => {
      const cat = m.categoria || 'Altro'
      perCat[cat] = (perCat[cat] || 0) + (m.importo || 0)
    })

  const voci = Object.entries(perCat).sort((a, b) => b[1] - a[1])
  if (!voci.length) {
    if (elEmpty) elEmpty.style.display = 'flex'
    return
  }
  if (elWrap) elWrap.style.display = 'block'

  const palette = ['#0f507b','#e6165c','#10b981','#fbbf24','#f87171','#8b5cf6','#06b6d4','#f97316']
  const totale = voci.reduce((s, [, v]) => s + v, 0)

  // Disegna ciambella SVG
  const CX = 90, CY = 90, R = 70, r = 40
  let angolo = -Math.PI / 2
  let fette = ''

  voci.forEach(([cat, val], i) => {
    const perc = val / totale
    const ang  = perc * 2 * Math.PI
    const x1 = CX + R * Math.cos(angolo)
    const y1 = CY + R * Math.sin(angolo)
    const x2 = CX + R * Math.cos(angolo + ang)
    const y2 = CY + R * Math.sin(angolo + ang)
    const xi1 = CX + r * Math.cos(angolo)
    const yi1 = CY + r * Math.sin(angolo)
    const xi2 = CX + r * Math.cos(angolo + ang)
    const yi2 = CY + r * Math.sin(angolo + ang)
    const large = ang > Math.PI ? 1 : 0
    const col = palette[i % palette.length]

    fette += `<path d="M${xi1} ${yi1} L${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z"
      fill="${col}" stroke="#fff" stroke-width="2" opacity="0.9"/>`
    angolo += ang
  })

  // Legenda a destra
  let legenda = ''
  voci.slice(0, 6).forEach(([cat, val], i) => {
    const y = 20 + i * 22
    const col = palette[i % palette.length]
    legenda += `<rect x="190" y="${y}" width="10" height="10" rx="2" fill="${col}"/>`
    legenda += `<text x="204" y="${y + 9}" font-size="10" font-family="Montserrat,sans-serif" fill="#4a6380" font-weight="600">${cat}</text>`
    legenda += `<text x="204" y="${y + 19}" font-size="9" font-family="Montserrat,sans-serif" fill="#8fa3b8">${formatEuro(val)}</text>`
  })

  // Testo centrale
  const centro = `<text x="${CX}" y="${CY - 5}" text-anchor="middle" font-size="9" font-family="Montserrat,sans-serif" fill="#8fa3b8">Totale</text>
    <text x="${CX}" y="${CY + 10}" text-anchor="middle" font-size="11" font-family="Montserrat,sans-serif" fill="#1b3050" font-weight="800">${formatEuro(totale)}</text>`

  const wrap = document.getElementById('chart-torta-wrap')
  if (wrap) wrap.innerHTML = `<svg viewBox="0 0 360 190" style="width:100%;display:block;">
    ${fette}${centro}${legenda}
  </svg>`
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
