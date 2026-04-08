// ============================================================
// MODULO: Incassi & Pagamenti v2
//
// NOVITÀ rispetto alla v1:
//   - Carica la collezione /rate per collegare le rate dei contratti
//   - Quando si seleziona un contratto (tipo=incasso), appare la
//     sezione "Collega rata" con le rate in attesa di quel contratto
//   - Selezionando una rata: importo, IVA, descrizione si compilano auto
//   - Al salvataggio: aggiorna la rata a stato='pagata'
//   - All'eliminazione: ripristina la rata a stato='attesa'
//   - Conto: ora è una select dai conti registrati in Firestore
// ============================================================

import { db, collections, toTimestamp, FieldValue } from '../../js/firebase-config.js'
import {
  formatEuro, formatDate, toInputDate,
  toast, openModal, closeModal, initModalClose,
  confirmDelete, debounce
} from '../../js/utils.js'

// ── Stato locale ──────────────────────────────────────────────
let tuttiMovimenti    = []
let movimentiFiltrati = []
let tuttiContratti    = []
let tutteRate         = []   // tutte le rate (per lookup rapido)
let tuttiConti        = []   // conti correnti

let filtroTipo  = 'tutti'
let cercaTesto  = ''
let meseAttivo  = 0
let annoAttivo  = 0


// ============================================================
// INIT
// ============================================================
export async function init() {
  const oggi   = new Date()
  meseAttivo   = oggi.getMonth() + 1
  annoAttivo   = oggi.getFullYear()

  _popolaAnni()
  document.getElementById('filtro-mese').value = meseAttivo
  document.getElementById('filtro-anno').value = annoAttivo

  // Carica tutto in parallelo
  await Promise.all([
    _caricaMovimenti(),
    _caricaContratti(),
    _caricaConti(),
  ])

  _initListeners()
}


// ============================================================
// CARICAMENTO DATI
// ============================================================
async function _caricaMovimenti() {
  try {
    const inizio = new Date(annoAttivo, meseAttivo - 1, 1)
    const fine   = new Date(annoAttivo, meseAttivo, 0, 23, 59, 59)

    const snapshot = await collections.movimenti()
      .where('data', '>=', toTimestamp(inizio.toISOString()))
      .where('data', '<=', toTimestamp(fine.toISOString()))
      .orderBy('data', 'desc')
      .get()

    tuttiMovimenti = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    _applicaFiltri()
  } catch (err) {
    console.error('Errore caricamento movimenti:', err)
    toast('Errore nel caricamento dei movimenti', 'error')
    document.getElementById('tabella-wrap').innerHTML =
      `<div class="empty-state"><p>Impossibile caricare i dati.</p></div>`
  }
}

async function _caricaContratti() {
  try {
    const snap = await collections.contratti().orderBy('cliente').get()
    tuttiContratti = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    // Carica tutte le rate (per collegamento)
    const snapR = await collections.rate().get()
    tutteRate = snapR.docs.map(d => ({ id: d.id, ...d.data() }))

    // Popola select contratti nel modal
    const sel = document.getElementById('mov-contratto-ref')
    if (sel) {
      sel.innerHTML = '<option value="">— Nessun contratto —</option>'
      tuttiContratti.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.id
        opt.textContent = c.cliente || '—'
        sel.appendChild(opt)
      })
    }
  } catch (err) {
    console.warn('Impossibile caricare contratti:', err)
  }
}

async function _caricaConti() {
  try {
    const snap = await collections.conti().orderBy('nome').get()
    tuttiConti = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    const sel = document.getElementById('mov-conto')
    if (sel) {
      sel.innerHTML = '<option value="">— Seleziona conto —</option>'
      tuttiConti.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.id
        opt.textContent = `${c.nome}${c.banca ? ' — ' + c.banca : ''}`
        sel.appendChild(opt)
      })
    }
  } catch (err) {
    console.warn('Impossibile caricare conti:', err)
  }
}


// ============================================================
// FILTRI
// ============================================================
function _applicaFiltri() {
  movimentiFiltrati = tuttiMovimenti.filter(m => {
    if (filtroTipo !== 'tutti' && m.tipo !== filtroTipo) return false
    if (cercaTesto) {
      const q = cercaTesto.toLowerCase()
      const h = [m.descrizione, m.categoria, m.conto, m.note].join(' ').toLowerCase()
      if (!h.includes(q)) return false
    }
    return true
  })
  _renderTabella()
  _aggiornaKPI()
}


// ============================================================
// TABELLA
// ============================================================
function _renderTabella() {
  const wrap = document.getElementById('tabella-wrap')
  if (!wrap) return

  if (!movimentiFiltrati.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <p>Nessun movimento trovato per questo periodo.</p>
      </div>`
    return
  }

  let totIncassi = 0, totPagamenti = 0
  movimentiFiltrati.forEach(m => {
    if (m.tipo === 'incasso')   totIncassi   += (m.importo || 0)
    if (m.tipo === 'pagamento') totPagamenti += (m.importo || 0)
  })

  const righe = movimentiFiltrati.map(m => {
    const colore = m.tipo === 'incasso' ? 'text-green fw-700' : 'text-red fw-700'
    const segno  = m.tipo === 'incasso' ? '+' : '−'
    const badge  = m.tipo === 'incasso'
      ? '<span class="badge badge-green">Incasso</span>'
      : '<span class="badge badge-red">Pagamento</span>'

    // Indica se il movimento è collegato a una rata
    const rataTag = m.rata_ref
      ? `<span style="font-size:9px;font-weight:700;color:var(--secondary);letter-spacing:.06em;">↳ RATA</span>`
      : ''

    return `<tr data-id="${m.id}">
      <td class="font-mono" style="font-size:12px;">${formatDate(m.data)}</td>
      <td style="max-width:240px;">
        <div style="font-weight:600;color:var(--text0);">${_esc(m.descrizione || '—')}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">${rataTag}${m.note ? _esc(m.note) : ''}</div>
      </td>
      <td><span class="badge badge-blue">${_esc(m.categoria || '—')}</span></td>
      <td style="font-size:12px;">${_nomeConto(m.conto)}</td>
      <td class="text-center" style="font-size:12px;">${m.iva_rate ? m.iva_rate + '%' : '—'}</td>
      <td class="text-right ${colore}">${segno} ${formatEuro(m.importo)}</td>
      <td class="text-right" style="white-space:nowrap;">
        <button class="btn btn-icon btn-sm btn-modifica" data-id="${m.id}" title="Modifica">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-icon btn-sm btn-elimina" data-id="${m.id}" title="Elimina" style="margin-left:4px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </td>
    </tr>`
  }).join('')

  const rigaTotali = `
    <tr style="background:rgba(15,80,123,0.04);font-weight:700;">
      <td colspan="5" style="padding:12px 16px;font-size:12px;color:var(--text1);">
        TOTALI — ${movimentiFiltrati.length} moviment${movimentiFiltrati.length === 1 ? 'o' : 'i'}
      </td>
      <td class="text-right" style="padding:12px 16px;">
        <div class="text-green fw-700">+ ${formatEuro(totIncassi)}</div>
        <div class="text-red fw-700" style="margin-top:2px;">− ${formatEuro(totPagamenti)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px;border-top:1px solid var(--border);padding-top:4px;">
          Saldo: <span class="${totIncassi - totPagamenti >= 0 ? 'text-green' : 'text-red'} fw-700">${formatEuro(totIncassi - totPagamenti)}</span>
        </div>
      </td>
      <td></td>
    </tr>`

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data</th><th>Descrizione</th><th>Categoria</th>
          <th>Conto</th><th class="text-center">IVA</th>
          <th class="text-right">Importo</th><th class="text-right">Azioni</th>
        </tr>
      </thead>
      <tbody>${righe}${rigaTotali}</tbody>
    </table>`

  _agganciaAzioniTabella()
}

function _nomeConto(contoRef) {
  if (!contoRef) return '—'
  const c = tuttiConti.find(x => x.id === contoRef || x.nome === contoRef)
  return c ? _esc(c.nome) : _esc(contoRef)
}


// ============================================================
// KPI
// ============================================================
async function _aggiornaKPI() {
  let incassiMese = 0, pagamentiMese = 0, nInc = 0, nPag = 0
  tuttiMovimenti.forEach(m => {
    if (m.tipo === 'incasso')   { incassiMese   += m.importo || 0; nInc++ }
    else                        { pagamentiMese += m.importo || 0; nPag++ }
  })

  let incassiYTD = 0
  try {
    const inizioAnno = new Date(annoAttivo, 0, 1)
    const fineAnno   = new Date(annoAttivo, 11, 31, 23, 59, 59)
    const snap = await collections.movimenti()
      .where('data', '>=', toTimestamp(inizioAnno.toISOString()))
      .where('data', '<=', toTimestamp(fineAnno.toISOString()))
      .get()
    snap.docs.forEach(d => { const x = d.data(); if (x.tipo === 'incasso') incassiYTD += x.importo || 0 })
  } catch (e) { /* silenzioso */ }

  const el = id => document.getElementById(id)
  if (el('kpi-incassi-mese'))      el('kpi-incassi-mese').textContent      = formatEuro(incassiMese)
  if (el('kpi-incassi-mese-sub'))  el('kpi-incassi-mese-sub').textContent  = `${nInc} movimento${nInc !== 1 ? 'i' : ''}`
  if (el('kpi-pagamenti-mese'))    el('kpi-pagamenti-mese').textContent    = formatEuro(pagamentiMese)
  if (el('kpi-pagamenti-mese-sub'))el('kpi-pagamenti-mese-sub').textContent= `${nPag} movimento${nPag !== 1 ? 'i' : ''}`
  const saldo = incassiMese - pagamentiMese
  const kpiS = el('kpi-saldo-netto')
  if (kpiS) { kpiS.textContent = formatEuro(saldo); kpiS.style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)' }
  if (el('kpi-incassi-ytd'))       el('kpi-incassi-ytd').textContent      = formatEuro(incassiYTD)
  if (el('kpi-incassi-ytd-sub'))   el('kpi-incassi-ytd-sub').textContent  = `anno ${annoAttivo}`
}


// ============================================================
// EVENTI
// ============================================================
function _initListeners() {
  // Ricerca
  document.getElementById('cerca-input')
    ?.addEventListener('input', debounce(e => { cercaTesto = e.target.value.trim(); _applicaFiltri() }, 250))

  // Chip tipo
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      filtroTipo = btn.dataset.tipo
      _applicaFiltri()
    })
  })

  // Filtro mese/anno
  document.getElementById('filtro-mese').addEventListener('change', async e => { meseAttivo = parseInt(e.target.value); await _caricaMovimenti() })
  document.getElementById('filtro-anno').addEventListener('change', async e => { annoAttivo = parseInt(e.target.value); await _caricaMovimenti() })

  // Pulsanti
  document.getElementById('btn-nuovo')?.addEventListener('click', _apriModalNuovo)
  document.getElementById('btn-export-csv')?.addEventListener('click', _esportaCSV)

  // Tipo toggle nel modal
  document.querySelectorAll('.tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById('mov-tipo').value = btn.dataset.val
      _aggiornaSectionRata()
    })
  })

  // Contratto selezionato → carica rate
  document.getElementById('mov-contratto-ref')
    ?.addEventListener('change', e => {
      _caricaRateContratto(e.target.value)
      _aggiornaSectionRata()
    })

  // Rata selezionata → auto-fill campi
  document.getElementById('mov-rata-select')
    ?.addEventListener('change', e => _onRataSelezionata(e.target.value))

  // Calcolo IVA
  const calcIVA = () => {
    const imp = parseFloat(document.getElementById('mov-importo').value) || 0
    const al  = parseFloat(document.getElementById('mov-iva-rate').value) || 0
    const iva = imp * al / 100
    document.getElementById('mov-iva-display').textContent = formatEuro(iva)
  }
  document.getElementById('mov-importo').addEventListener('input', calcIVA)
  document.getElementById('mov-iva-rate').addEventListener('change', calcIVA)

  // Salva / Annulla / Close
  document.getElementById('btn-salva').addEventListener('click', _salvaMovimento)
  document.getElementById('btn-annulla').addEventListener('click', () => closeModal('modal-movimento'))
  document.getElementById('modal-close-btn').addEventListener('click', () => closeModal('modal-movimento'))
  document.getElementById('modal-movimento').addEventListener('click', e => {
    if (e.target.id === 'modal-movimento') closeModal('modal-movimento')
  })
}

function _agganciaAzioniTabella() {
  document.querySelectorAll('.btn-modifica').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = tuttiMovimenti.find(x => x.id === btn.dataset.id)
      if (m) _apriModalModifica(m)
    })
  })
  document.querySelectorAll('.btn-elimina').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirmDelete('Eliminare questo movimento?')) await _eliminaMovimento(btn.dataset.id)
    })
  })
}


// ============================================================
// SEZIONE RATA — mostra/nascondi in base a tipo + contratto
// ============================================================
function _aggiornaSectionRata() {
  const tipo       = document.getElementById('mov-tipo').value
  const contrattoId = document.getElementById('mov-contratto-ref').value
  const section    = document.getElementById('mov-rata-section')
  if (section) {
    section.style.display = (tipo === 'incasso' && contrattoId) ? 'block' : 'none'
  }
}

// Popola la select delle rate per il contratto selezionato
function _caricaRateContratto(contrattoId) {
  const sel  = document.getElementById('mov-rata-select')
  const info = document.getElementById('mov-rata-info')
  if (!sel) return

  sel.innerHTML = '<option value="">— Nessuna rata (movimento libero) —</option>'
  if (info) info.style.display = 'none'
  document.getElementById('mov-rata-ref').value = ''

  if (!contrattoId) return

  // Filtra rate in attesa per questo contratto
  const rate = tutteRate.filter(r => r.contratto_ref === contrattoId && r.stato === 'attesa')
  if (!rate.length) {
    const opt = document.createElement('option')
    opt.disabled = true
    opt.textContent = '— Nessuna rata in attesa per questo contratto —'
    sel.appendChild(opt)
    return
  }

  rate.sort((a, b) => _toDate(a.data_prevista) - _toDate(b.data_prevista))
    .forEach(r => {
      const opt = document.createElement('option')
      opt.value = r.id
      const dataStr = r.data_prevista ? formatDate(_toDate(r.data_prevista)) : '—'
      opt.textContent = `${r.descrizione || 'Rata'} — ${formatEuro(r.importo_totale)} — scad. ${dataStr}`
      sel.appendChild(opt)
    })
}

// Quando l'utente seleziona una rata: auto-fill i campi
function _onRataSelezionata(rataId) {
  const info = document.getElementById('mov-rata-info')
  document.getElementById('mov-rata-ref').value = rataId

  if (!rataId) {
    if (info) info.style.display = 'none'
    return
  }

  const r = tutteRate.find(x => x.id === rataId)
  if (!r) return

  // Auto-fill campi del movimento
  document.getElementById('mov-importo').value     = r.importo_totale ?? ''
  document.getElementById('mov-iva-rate').value    = r.iva_rate ?? 22
  document.getElementById('mov-descrizione').value = `${r.descrizione || 'Rata'} — ${r.cliente || ''}`
  document.getElementById('mov-categoria').value   = 'Contratto'

  // Aggiorna display IVA
  const iva = (r.importo_totale || 0) * (r.iva_rate || 0) / 100
  document.getElementById('mov-iva-display').textContent = formatEuro(iva)

  // Mostra info rata
  if (info) {
    info.style.display = 'block'
    document.getElementById('mov-rata-desc').textContent = r.descrizione || 'Rata'
    document.getElementById('mov-rata-tot').textContent  = formatEuro(r.importo_totale)
    document.getElementById('mov-rata-data').textContent = r.data_prevista
      ? `Scadenza prevista: ${formatDate(_toDate(r.data_prevista))}`
      : ''
  }
}


// ============================================================
// CRUD — SALVA
// ============================================================
async function _salvaMovimento() {
  const id          = document.getElementById('mov-id').value
  const tipo        = document.getElementById('mov-tipo').value
  const data        = document.getElementById('mov-data').value
  const descrizione = document.getElementById('mov-descrizione').value.trim()
  const categoria   = document.getElementById('mov-categoria').value
  const importo     = parseFloat(document.getElementById('mov-importo').value) || 0
  const ivaRate     = parseFloat(document.getElementById('mov-iva-rate').value) || 0
  const contoRef    = document.getElementById('mov-conto').value
  const contrattoRef= document.getElementById('mov-contratto-ref').value
  const rataRef     = document.getElementById('mov-rata-ref').value
  const note        = document.getElementById('mov-note').value.trim()

  if (!data)        { toast('Inserisci la data', 'error'); return }
  if (!descrizione) { toast('Inserisci la descrizione', 'error'); return }
  if (!categoria)   { toast('Seleziona la categoria', 'error'); return }
  if (!importo || importo <= 0) { toast('Inserisci un importo valido', 'error'); return }

  const ivaImporto = importo * (ivaRate / 100)
  // Trova nome conto per compatibilità
  const contoObj   = tuttiConti.find(c => c.id === contoRef)
  const contoNome  = contoObj?.nome || contoRef || null

  const dati = {
    tipo, importo,
    data:          toTimestamp(data),
    descrizione, categoria,
    conto:         contoRef || null,
    conto_nome:    contoNome,
    iva_rate:      ivaRate,
    iva_importo:   ivaImporto,
    contratto_ref: contrattoRef || null,
    rata_ref:      rataRef || null,
    note:          note || null
  }

  try {
    if (id) {
      await collections.movimenti().doc(id).update(dati)
      toast('Movimento aggiornato', 'success')
    } else {
      dati.createdAt = FieldValue.serverTimestamp()
      await collections.movimenti().add(dati)
      toast('Movimento salvato', 'success')
    }

    // Se c'è una rata collegata → segna come pagata
    if (rataRef) {
      await collections.rate().doc(rataRef).update({
        stato:          'pagata',
        data_pagamento: toTimestamp(data)
      })
      // Aggiorna cache locale
      const r = tutteRate.find(x => x.id === rataRef)
      if (r) { r.stato = 'pagata'; r.data_pagamento = toTimestamp(data) }
      toast('Rata del contratto segnata come pagata ✓', 'success')
    }

    closeModal('modal-movimento')
    await _caricaMovimenti()

  } catch (err) {
    console.error('Errore salvataggio:', err)
    toast('Errore durante il salvataggio', 'error')
  }
}


// ============================================================
// CRUD — ELIMINA
// ============================================================
async function _eliminaMovimento(id) {
  const m = tuttiMovimenti.find(x => x.id === id)
  try {
    await collections.movimenti().doc(id).delete()

    // Se aveva una rata collegata → ripristina a 'attesa'
    if (m?.rata_ref) {
      await collections.rate().doc(m.rata_ref).update({
        stato:          'attesa',
        data_pagamento: null
      })
      const r = tutteRate.find(x => x.id === m.rata_ref)
      if (r) { r.stato = 'attesa'; r.data_pagamento = null }
      toast('Movimento eliminato — rata ripristinata ad "In attesa"', 'success')
    } else {
      toast('Movimento eliminato', 'success')
    }

    await _caricaMovimenti()
  } catch (err) {
    console.error('Errore eliminazione:', err)
    toast('Errore durante l\'eliminazione', 'error')
  }
}


// ============================================================
// MODAL — APRI NUOVO
// ============================================================
function _apriModalNuovo() {
  document.getElementById('modal-titolo').textContent  = 'Nuovo movimento'
  document.getElementById('mov-id').value              = ''
  document.getElementById('mov-rata-ref').value        = ''
  document.getElementById('mov-data').value            = new Date().toISOString().split('T')[0]
  document.getElementById('mov-descrizione').value     = ''
  document.getElementById('mov-categoria').value       = ''
  document.getElementById('mov-importo').value         = ''
  document.getElementById('mov-iva-rate').value        = '22'
  document.getElementById('mov-iva-display').textContent = formatEuro(0)
  document.getElementById('mov-conto').value           = ''
  document.getElementById('mov-contratto-ref').value   = ''
  document.getElementById('mov-note').value            = ''
  // Reset rata
  const sel = document.getElementById('mov-rata-select')
  if (sel) sel.innerHTML = '<option value="">— Seleziona rata (opzionale) —</option>'
  const info = document.getElementById('mov-rata-info')
  if (info) info.style.display = 'none'
  const section = document.getElementById('mov-rata-section')
  if (section) section.style.display = 'none'

  _impostaTipoModal('incasso')
  openModal('modal-movimento')
}


// ============================================================
// MODAL — APRI MODIFICA
// ============================================================
function _apriModalModifica(m) {
  document.getElementById('modal-titolo').textContent  = 'Modifica movimento'
  document.getElementById('mov-id').value              = m.id
  document.getElementById('mov-rata-ref').value        = m.rata_ref || ''
  document.getElementById('mov-data').value            = toInputDate(m.data)
  document.getElementById('mov-descrizione').value     = m.descrizione  || ''
  document.getElementById('mov-categoria').value       = m.categoria    || ''
  document.getElementById('mov-importo').value         = m.importo      || ''
  document.getElementById('mov-iva-rate').value        = m.iva_rate     || 0
  document.getElementById('mov-iva-display').textContent = formatEuro(m.iva_importo || 0)
  document.getElementById('mov-conto').value           = m.conto        || ''
  document.getElementById('mov-contratto-ref').value   = m.contratto_ref|| ''
  document.getElementById('mov-note').value            = m.note         || ''

  _impostaTipoModal(m.tipo)

  // Carica rate del contratto se presente
  if (m.contratto_ref) {
    _caricaRateContratto(m.contratto_ref)
    const section = document.getElementById('mov-rata-section')
    if (section && m.tipo === 'incasso') section.style.display = 'block'
    // Seleziona la rata già collegata
    if (m.rata_ref) {
      setTimeout(() => {
        const sel = document.getElementById('mov-rata-select')
        if (sel) sel.value = m.rata_ref
        _onRataSelezionata(m.rata_ref)
      }, 50)
    }
  }

  openModal('modal-movimento')
}

function _impostaTipoModal(tipo) {
  document.getElementById('mov-tipo').value = tipo
  document.querySelectorAll('.tipo-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === tipo)
  })
}


// ============================================================
// ESPORTA CSV
// ============================================================
function _esportaCSV() {
  if (!movimentiFiltrati.length) { toast('Nessun dato da esportare', 'info'); return }
  const header = ['Data','Tipo','Descrizione','Categoria','Conto','IVA %','Importo','IVA','Note']
  const righe  = movimentiFiltrati.map(m => [
    formatDate(m.data), m.tipo || '',
    `"${(m.descrizione || '').replace(/"/g,'""')}"`,
    m.categoria || '', _nomeConto(m.conto), m.iva_rate || 0,
    (m.importo || 0).toFixed(2).replace('.', ','),
    (m.iva_importo || 0).toFixed(2).replace('.', ','),
    `"${(m.note || '').replace(/"/g,'""')}"`
  ])
  const csv  = [header, ...righe].map(r => r.join(';')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  const mesi = ['','gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
  link.download = `movimenti_${mesi[meseAttivo]}_${annoAttivo}.csv`
  document.body.appendChild(link); link.click(); document.body.removeChild(link)
  toast(`CSV esportato: ${movimentiFiltrati.length} movimenti`)
}


// ============================================================
// UTILITY
// ============================================================
function _popolaAnni() {
  const sel = document.getElementById('filtro-anno')
  if (!sel) return
  const ac = new Date().getFullYear()
  sel.innerHTML = ''
  for (let a = ac; a >= ac - 4; a--) {
    const opt = document.createElement('option')
    opt.value = a; opt.textContent = a; sel.appendChild(opt)
  }
}

function _toDate(val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()
  const d = new Date(val); return isNaN(d) ? null : d
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
