// ============================================================
// CLIENTI.JS — Scheda cliente
//
// SOLA LETTURA. Questo modulo non scrive mai su Firestore:
// mette insieme contratti, rate e movimenti che esistono già.
//
// Nota sul modello dati: NON esiste una collezione /clienti.
// Il cliente è il campo testuale `cliente` dentro /contratti.
// L'elenco qui sotto si ricava dai contratti esistenti, e due
// scritture diverse dello stesso nome restano due clienti distinti.
// La ricerca è volutamente "per contenuto" così le si trova comunque
// entrambe scrivendo un pezzo del nome.
// ============================================================

import { collections } from '../../js/firebase-config.js'
import { formatEuro, toast } from '../../js/utils.js'

// ── Stato locale ──────────────────────────────────────────────
let _contratti = []
let _rate      = []
let _movimenti = []
let _conti     = []

let _selezionato = null
let _cerca       = ''


// ============================================================
// INIT
// ============================================================
export async function init() {
  // Reset: init() viene richiamata a ogni ingresso nella pagina
  _selezionato = null
  _cerca       = ''

  _collegaEventi()
  await _caricaDati()
  _renderLista()
  _renderScheda()
}


// ============================================================
// CARICAMENTO
// ============================================================
async function _caricaDati() {
  const elLoad   = document.getElementById('cli-loading')
  const elLayout = document.getElementById('cli-layout')

  if (elLoad)   elLoad.style.display   = 'flex'
  if (elLayout) elLayout.style.display = 'none'

  try {
    const [snapC, snapR, snapM, snapCo] = await Promise.all([
      collections.contratti().get(),
      collections.rate().get(),
      collections.movimenti().get(),
      collections.conti().get(),
    ])

    _contratti = snapC.docs.map(d => ({ id: d.id, ...d.data() }))
    _rate      = snapR.docs.map(d => ({ id: d.id, ...d.data() }))
    _movimenti = snapM.docs.map(d => ({ id: d.id, ...d.data() }))
    _conti     = snapCo.docs.map(d => ({ id: d.id, ...d.data() }))

    if (elLayout) elLayout.style.display = 'grid'

  } catch (err) {
    console.error('Clienti: errore caricamento →', err)
    toast('Errore nel caricamento dei clienti', 'error')
    const lista = document.getElementById('cli-lista')
    if (lista) lista.innerHTML = `<div class="empty-state" style="min-height:160px;padding:20px;">
      <p style="font-size:12px;">Impossibile leggere i dati.</p>
      <p style="font-size:11px;margin-top:6px;color:var(--text2);">${_esc(err.message)}</p>
    </div>`
    if (elLayout) elLayout.style.display = 'grid'
  } finally {
    if (elLoad) elLoad.style.display = 'none'
  }
}


// ============================================================
// AGGREGAZIONE — tutto quello che sappiamo di un cliente
// ============================================================

function _nomiClienti() {
  const nomi = new Set()
  _contratti.forEach(c => {
    const n = (c.cliente || '').trim()
    nomi.add(n || SENZA_NOME)
  })
  return [...nomi]
}

const SENZA_NOME = '— contratto senza cliente —'

function _datiCliente(nome) {
  const contratti = _contratti.filter(c => ((c.cliente || '').trim() || SENZA_NOME) === nome)
  const ids       = contratti.map(c => c.id)

  const rate = _rate.filter(r => ids.includes(r.contratto_ref))

  // ⚠️ Il filtro su tipo='incasso' NON è pleonastico.
  // provvigioni.js crea movimenti con tipo='pagamento' e contratto_ref
  // valorizzato: la provvigione pagata all'agente è agganciata al contratto
  // del cliente. Senza questo filtro finirebbe fra i suoi incassi.
  const movimenti = _movimenti.filter(m => m.tipo === 'incasso' && ids.includes(m.contratto_ref))

  const valore      = contratti.reduce((s, c) => s + (Number(c.importo_totale) || 0), 0)
  const incassato   = movimenti.reduce((s, m) => s + (Number(m.importo) || 0), 0)
  const rateAttesa  = rate.filter(r => r.stato === 'attesa')
  const daIncassare = rateAttesa.reduce((s, r) => s + (Number(r.importo_totale) || 0), 0)

  // Controllo di coerenza: i soldi arrivati devono coincidere con le rate
  // segnate come pagate. Se divergono, da qualche parte c'è un buco.
  const ratePagate = rate.filter(r => r.stato === 'pagata')
                         .reduce((s, r) => s + (Number(r.importo_totale) || 0), 0)
  const scarto = Math.round((incassato - ratePagate) * 100) / 100

  const attesaOrdinate = rateAttesa
    .filter(r => _toDate(r.data_prevista))
    .sort((a, b) => _toDate(a.data_prevista) - _toDate(b.data_prevista))

  const prossima = attesaOrdinate[0] || null
  const scadute  = attesaOrdinate.filter(r => _giorni(r.data_prevista) < 0)

  return { nome, contratti, rate, movimenti, valore, incassato,
           daIncassare, ratePagate, scarto, prossima, scadute }
}

function _elencoClienti() {
  return _nomiClienti()
    .map(_datiCliente)
    .sort((a, b) => b.daIncassare - a.daIncassare || a.nome.localeCompare(b.nome))
}


// ============================================================
// ELENCO A SINISTRA
// ============================================================
function _renderLista() {
  const lista = document.getElementById('cli-lista')
  const conta = document.getElementById('cli-conta')
  if (!lista) return

  const q      = _cerca.toLowerCase().trim()
  const tutti  = _elencoClienti()
  const trovati = q ? tutti.filter(c => c.nome.toLowerCase().includes(q)) : tutti

  if (conta) {
    if (!tutti.length)  conta.innerHTML = ''
    else if (q)         conta.innerHTML = trovati.length
      ? `<strong>${trovati.length}</strong> client${trovati.length === 1 ? 'e' : 'i'} per "${_esc(_cerca)}"`
      : `Nessun cliente per "${_esc(_cerca)}"`
    else                conta.innerHTML = `<strong>${tutti.length}</strong> client${tutti.length === 1 ? 'e' : 'i'}`
  }

  if (!tutti.length) {
    lista.innerHTML = `<div class="empty-state" style="min-height:160px;padding:20px;">
      <p style="font-size:12px;">Nessun cliente.</p>
      <p style="font-size:11px;margin-top:6px;color:var(--text2);">
        I clienti nascono dai contratti: creane uno in Contratti e comparirà qui.
      </p>
    </div>`
    return
  }

  if (!trovati.length) {
    lista.innerHTML = `<div class="empty-state" style="min-height:160px;padding:20px;">
      <p style="font-size:12px;">Nessun cliente con questo nome.</p>
      <p style="font-size:11px;margin-top:6px;color:var(--text2);">Prova con una parte del nome.</p>
    </div>`
    return
  }

  lista.innerHTML = trovati.map(c => {
    const attivo = c.nome === _selezionato ? 'active' : ''

    let tag
    if (c.scadute.length)       tag = `<span class="cli-tag rosso">${c.scadute.length} scadut${c.scadute.length === 1 ? 'a' : 'e'}</span>`
    else if (c.daIncassare > 0) tag = `<span class="cli-tag ambra">da incassare</span>`
    else                        tag = `<span class="cli-tag verde">saldato</span>`

    return `<div class="cli-item ${attivo}" data-nome="${_esc(c.nome)}" tabindex="0" role="button">
      <div class="cli-nome">${_esc(c.nome)}</div>
      <div class="cli-sub">${c.contratti.length} contratt${c.contratti.length === 1 ? 'o' : 'i'} · ${formatEuro(c.valore)}</div>
      ${tag}
    </div>`
  }).join('')

  lista.querySelectorAll('.cli-item').forEach(el => {
    const apri = () => { _selezionato = el.dataset.nome; _renderLista(); _renderScheda() }
    el.addEventListener('click', apri)
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri() }
    })
  })
}


// ============================================================
// SCHEDA A DESTRA
// ============================================================
function _renderScheda() {
  const box = document.getElementById('cli-scheda')
  if (!box) return

  if (!_selezionato) {
    box.innerHTML = `<div class="empty-state" style="min-height:340px;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <p>Scegli un cliente per vedere la sua situazione.</p>
    </div>`
    return
  }

  const c = _datiCliente(_selezionato)

  // ── KPI prossima scadenza ──
  let prossimaVal = '—', prossimaSub = 'Tutto saldato', prossimaCls = 'green'
  if (c.prossima) {
    const g = _giorni(c.prossima.data_prevista)
    prossimaVal = formatEuro(c.prossima.importo_totale)
    prossimaCls = g < 0 ? 'red' : (g <= 30 ? 'amber' : 'secondary')
    prossimaSub = g < 0  ? `${_data(c.prossima.data_prevista)} · scaduta da ${Math.abs(g)}gg`
                : g === 0 ? `${_data(c.prossima.data_prevista)} · scade oggi`
                : `${_data(c.prossima.data_prevista)} · tra ${g}gg`
  } else if (!c.rate.length) {
    prossimaSub = 'Nessuna rata programmata'
    prossimaCls = 'secondary'
  }

  // ── Avviso di incoerenza ──
  const avviso = Math.abs(c.scarto) > 0.01 ? `
    <div class="cli-avviso">
      <strong>I conti non tornano.</strong>
      Gli incassi registrati valgono ${formatEuro(c.incassato)},
      ma le rate segnate come pagate valgono ${formatEuro(c.ratePagate)}.
      Differenza: <strong>${formatEuro(Math.abs(c.scarto))}</strong>.
      ${c.scarto > 0
        ? 'Ci sono incassi senza una rata corrispondente.'
        : 'Ci sono rate segnate pagate senza un incasso registrato.'}
    </div>` : ''

  const pct = c.valore > 0 ? Math.round(c.incassato / c.valore * 100) : 0

  box.innerHTML = `
    <div class="cli-testata">
      <div>
        <div class="cli-titolo">${_esc(c.nome)}</div>
        <div class="cli-sottotitolo">
          ${c.contratti.length} contratt${c.contratti.length === 1 ? 'o' : 'i'} ·
          ${c.rate.length} rat${c.rate.length === 1 ? 'a' : 'e'} ·
          ${c.movimenti.length} incass${c.movimenti.length === 1 ? 'o' : 'i'}
        </div>
      </div>
    </div>

    ${avviso}

    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card secondary">
        <div class="kpi-label">Valore contratti</div>
        <div class="kpi-value">${formatEuro(c.valore)}</div>
        <div class="kpi-sub">IVA inclusa</div>
      </div>
      <div class="kpi-card green">
        <div class="kpi-label">Incassato</div>
        <div class="kpi-value" style="color:var(--green);">${formatEuro(c.incassato)}</div>
        <div class="kpi-sub">${pct}% del totale</div>
      </div>
      <div class="kpi-card ${c.daIncassare > 0 ? 'amber' : 'green'}">
        <div class="kpi-label">Da incassare</div>
        <div class="kpi-value" style="color:${c.daIncassare > 0 ? 'var(--amber)' : 'var(--green)'};">${formatEuro(c.daIncassare)}</div>
        <div class="kpi-sub">${c.rate.filter(r => r.stato === 'attesa').length} rate in attesa</div>
      </div>
      <div class="kpi-card ${prossimaCls}">
        <div class="kpi-label">Prossima scadenza</div>
        <div class="kpi-value" style="font-size:20px;">${prossimaVal}</div>
        <div class="kpi-sub">${prossimaSub}</div>
      </div>
    </div>

    ${_sezContratti(c)}
    ${_sezRate(c)}
    ${_sezIncassi(c)}
  `
}


// ── Sezione: contratti ────────────────────────────────────────
function _sezContratti(c) {
  const badge = {
    corrente: ['badge-green', 'Corrente'],
    concluso: ['badge-blue',  'Concluso'],
    sospeso:  ['badge-gray',  'Sospeso'],
  }

  const righe = [...c.contratti]
    .sort((a, b) => (_toDate(b.data_inizio) || 0) - (_toDate(a.data_inizio) || 0))
    .map(ct => {
      const b = badge[ct.stato] || ['badge-gray', ct.stato || '—']
      return `<tr>
        <td style="font-size:12px;">${_data(ct.data_inizio)}</td>
        <td class="text-right" style="font-size:12px;">${formatEuro(ct.importo_imponibile)}</td>
        <td class="text-right fw-700">${formatEuro(ct.importo_totale)}</td>
        <td style="font-size:11px;color:var(--text1);">${_esc(ct.conto_accredito_nome || '—')}</td>
        <td><span class="badge ${b[0]}">${_esc(b[1])}</span></td>
      </tr>`
    }).join('')

  return `
  <div class="table-wrap" style="margin-bottom:16px;">
    <div class="table-head"><div class="cli-sez">Contratti</div></div>
    <table>
      <thead><tr>
        <th>Firmato il</th><th class="text-right">Imponibile</th>
        <th class="text-right">Totale</th><th>Conto</th><th>Stato</th>
      </tr></thead>
      <tbody>${righe}</tbody>
    </table>
  </div>`
}


// ── Sezione: piano pagamenti ──────────────────────────────────
function _sezRate(c) {
  if (!c.rate.length) return `
    <div class="table-wrap" style="margin-bottom:16px;">
      <div class="table-head"><div class="cli-sez">Piano pagamenti</div></div>
      <div class="empty-state" style="min-height:120px;">
        <p style="font-size:12px;">Nessuna rata programmata.</p>
        <p style="font-size:11px;margin-top:6px;color:var(--text2);">Le rate si aggiungono modificando il contratto.</p>
      </div>
    </div>`

  const righe = [...c.rate]
    .sort((a, b) => (_toDate(a.data_prevista) || 0) - (_toDate(b.data_prevista) || 0))
    .map(r => {
      const g = _giorni(r.data_prevista)
      let stato, stile = ''

      if (r.stato === 'pagata') {
        stato = '<span class="badge badge-green">Pagata</span>'
      } else if (g !== null && g < 0) {
        stato = '<span class="badge badge-red">Scaduta</span>'
        stile = 'style="background:rgba(248,113,113,0.05);"'
      } else if (g !== null && g <= 30) {
        stato = '<span class="badge badge-amber">In scadenza</span>'
      } else {
        stato = '<span class="badge badge-gray">In attesa</span>'
      }

      let quando = ''
      if (r.stato !== 'pagata' && g !== null) {
        quando = g < 0   ? `<span class="cli-gg rosso">${Math.abs(g)}gg fa</span>`
               : g === 0 ? `<span class="cli-gg rosso">oggi</span>`
               : `<span class="cli-gg">tra ${g}gg</span>`
      }

      return `<tr ${stile}>
        <td style="font-weight:600;color:var(--text0);">${_esc(r.descrizione || 'Rata')}</td>
        <td style="font-size:12px;">${_data(r.data_prevista)}${quando}</td>
        <td class="text-right fw-700">${formatEuro(r.importo_totale)}</td>
        <td style="font-size:12px;color:var(--text2);">${_data(r.data_pagamento)}</td>
        <td>${stato}</td>
      </tr>`
    }).join('')

  return `
  <div class="table-wrap" style="margin-bottom:16px;">
    <div class="table-head"><div class="cli-sez">Piano pagamenti</div></div>
    <table>
      <thead><tr>
        <th>Rata</th><th>Prevista</th><th class="text-right">Importo</th>
        <th>Pagata il</th><th>Stato</th>
      </tr></thead>
      <tbody>${righe}</tbody>
    </table>
  </div>`
}


// ── Sezione: incassi ricevuti ─────────────────────────────────
function _sezIncassi(c) {
  if (!c.movimenti.length) return `
    <div class="table-wrap">
      <div class="table-head"><div class="cli-sez">Incassi ricevuti</div></div>
      <div class="empty-state" style="min-height:120px;">
        <p style="font-size:12px;">Nessun incasso ancora registrato.</p>
      </div>
    </div>`

  const righe = [...c.movimenti]
    .sort((a, b) => (_toDate(b.data) || 0) - (_toDate(a.data) || 0))
    .map(m => `<tr>
      <td class="font-mono" style="font-size:12px;">${_data(m.data)}</td>
      <td style="font-weight:600;color:var(--text0);">${_esc(m.descrizione || '—')}</td>
      <td style="font-size:11px;color:var(--text1);">${_esc(_nomeConto(m))}</td>
      <td class="text-right text-green fw-700">+ ${formatEuro(m.importo)}</td>
    </tr>`).join('')

  return `
  <div class="table-wrap">
    <div class="table-head"><div class="cli-sez">Incassi ricevuti</div></div>
    <table>
      <thead><tr>
        <th>Data</th><th>Descrizione</th><th>Conto</th><th class="text-right">Importo</th>
      </tr></thead>
      <tbody>
        ${righe}
        <tr style="background:rgba(15,80,123,0.04);">
          <td colspan="3" class="fw-700" style="font-size:12px;color:var(--text1);">TOTALE INCASSATO</td>
          <td class="text-right text-green fw-800" style="font-size:15px;">${formatEuro(c.incassato)}</td>
        </tr>
      </tbody>
    </table>
  </div>`
}


// ============================================================
// EVENTI
// ============================================================
function _collegaEventi() {
  document.getElementById('cli-input')?.addEventListener('input', e => {
    _cerca = e.target.value
    const q = _cerca.toLowerCase().trim()
    const trovati = _elencoClienti().filter(c => c.nome.toLowerCase().includes(q))

    // Un solo risultato: apri la scheda senza far cliccare
    if (q && trovati.length === 1) {
      _selezionato = trovati[0].nome
    } else if (q && !trovati.some(c => c.nome === _selezionato)) {
      _selezionato = null
    }

    _renderLista()
    _renderScheda()
  })

  document.getElementById('cli-aggiorna')?.addEventListener('click', async () => {
    await _caricaDati()
    _renderLista()
    _renderScheda()
  })
}


// ============================================================
// UTILITY
// ============================================================

// Firestore restituisce Timestamp, ma i documenti vecchi o importati
// possono avere stringhe. Regge entrambi, e null se non è una data.
function _toDate(val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()
  const d = new Date(val)
  return isNaN(d) ? null : d
}

function _data(val) {
  const d = _toDate(val)
  if (!d) return '—'
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(d)
}

// Giorni da oggi alla data. null se la data non c'è.
function _giorni(val) {
  const d = _toDate(val)
  if (!d) return null
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0)
  const target = new Date(d); target.setHours(0, 0, 0, 0)
  return Math.round((target - oggi) / 86400000)
}

function _nomeConto(m) {
  if (m.conto_nome) return m.conto_nome
  const c = _conti.find(x => x.id === m.conto)
  return c ? c.nome : (m.conto || '—')
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
