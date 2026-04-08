/**
 * ============================================================
 * MODULO: Contratti — Logica JS (v2)
 * File:   js/modules/contratti.js
 *
 * NOVITÀ rispetto alla v1:
 *   - Rimosso campo "numero contratto"
 *   - Rimosso campo "data fine"
 *   - Aggiunto: imponibile + IVA (aliquota selezionabile) + totale auto
 *   - Aggiunto: modalità di pagamento (note)
 *   - Aggiunto: piano rate (collezione /rate in Firestore)
 *   - Filtri: Tutti / In scadenza / Scaduti / Sospesi / Conclusi
 *             "In scadenza" e "Scaduti" calcolati dalle rate
 *
 * Struttura Firestore:
 *   /contratti/{id}
 *     cliente, data_inizio, stato (corrente|sospeso|concluso)
 *     importo_imponibile, iva_rate, importo_iva, importo_totale
 *     modalita_pagamento, note, createdAt
 *
 *   /rate/{id}
 *     contratto_ref, cliente (denorm.)
 *     descrizione, importo_imponibile, iva_rate, importo_iva, importo_totale
 *     data_prevista, data_pagamento, stato (attesa|pagata|scaduta)
 *     createdAt
 * ============================================================
 */

import { collections, toTimestamp, FieldValue } from '../../js/firebase-config.js'
import { formatEuro, formatDate, toInputDate, toast, confirmDelete } from '../../js/utils.js'


// ── Stato locale ──────────────────────────────────────────────
let _contratti    = []   // tutti i contratti Firestore
let _rateMap      = {}   // { contratto_id: [rate...] }
let _filtroStato  = 'tutti'
let _testoRicerca = ''

// Rate temporanee nel form (prima del salvataggio)
let _conti          = []   // conti correnti Firestore
let _rateForm       = []   // array di oggetti { tempId, id?, descrizione, imponibile, iva_rate, data_prevista }
let _rateEliminate  = []   // id di rate esistenti da cancellare al salvataggio
let _contrattoInEdit = null // id contratto in modifica (null = nuovo)


// ── ALIQUOTE IVA ITALIA ───────────────────────────────────────
const ALIQUOTE_IVA = [
  { v: 0,  l: '0% – Esente' },
  { v: 4,  l: '4%' },
  { v: 5,  l: '5%' },
  { v: 10, l: '10%' },
  { v: 22, l: '22% – Ordinaria' },
]


// ============================================================
// INIT
// ============================================================
export async function init() {
  await _caricaDati()
  _collegaEventi()
  _renderTabella()
}


// ============================================================
// CARICAMENTO DATI
// ============================================================
async function _caricaDati() {
  const elLoad  = document.getElementById('contratti-loading')
  const elTable = document.getElementById('contratti-table-wrap')
  const elEmpty = document.getElementById('contratti-empty')

  if (elLoad)  elLoad.style.display  = 'flex'
  if (elTable) elTable.style.display = 'none'
  if (elEmpty) elEmpty.style.display = 'none'

  try {
    // Carica contratti e rate in parallelo
    const [snapC, snapR, snapConti] = await Promise.all([
      collections.contratti().get(),
      collections.rate().get(),
      collections.conti().get()
    ])

    _conti = snapConti.docs.map(d => ({ id: d.id, ...d.data() }))
    _conti.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))

    // Popola select conto nel form
    const selConto = document.getElementById('f-conto-accredito')
    if (selConto) {
      selConto.innerHTML = '<option value="">— Seleziona il conto —</option>'
      _conti.forEach(ct => {
        const opt = document.createElement('option')
        opt.value = ct.id
        opt.textContent = `${ct.nome}${ct.banca ? ' — ' + ct.banca : ''}`
        selConto.appendChild(opt)
      })
    }

    _contratti = snapC.docs.map(d => ({ id: d.id, ...d.data() }))
    // Ordina per data_inizio desc (in JS per evitare indici Firestore)
    _contratti.sort((a, b) => {
      const da = a.data_inizio?.toDate ? a.data_inizio.toDate() : new Date(a.data_inizio || 0)
      const db = b.data_inizio?.toDate ? b.data_inizio.toDate() : new Date(b.data_inizio || 0)
      return db - da
    })

    // Raggruppa rate per contratto
    _rateMap = {}
    const rateAll = snapR.docs.map(d => ({ id: d.id, ...d.data() }))
    // Ordina rate per data_prevista asc in JS
    rateAll.sort((a, b) => {
      const da = a.data_prevista?.toDate ? a.data_prevista.toDate() : new Date(a.data_prevista || 0)
      const db = b.data_prevista?.toDate ? b.data_prevista.toDate() : new Date(b.data_prevista || 0)
      return da - db
    })
    rateAll.forEach(r => {
      if (!_rateMap[r.contratto_ref]) _rateMap[r.contratto_ref] = []
      _rateMap[r.contratto_ref].push(r)
    })

  } catch (err) {
    console.error('Contratti: errore caricamento →', err)
    toast('Errore nel caricamento dei contratti', 'error')
  } finally {
    if (elLoad) elLoad.style.display = 'none'
  }
}


// ============================================================
// STATO COMPUTATO — dipende dalle rate del contratto
// ============================================================
function _computaStato(contratto) {
  // Se manualmente sospeso o concluso, ha la precedenza
  if (contratto.stato === 'sospeso')  return 'sospeso'
  if (contratto.stato === 'concluso') return 'concluso'

  const rate = _rateMap[contratto.id] || []
  const oggi  = new Date(); oggi.setHours(0,0,0,0)
  const tra30 = new Date(oggi); tra30.setDate(tra30.getDate() + 30)

  const rateAttesa = rate.filter(r => r.stato === 'attesa')

  // Ha rate scadute (data prevista nel passato)
  const haScadute = rateAttesa.some(r => {
    const d = _toDate(r.data_prevista)
    return d && d < oggi
  })
  if (haScadute) return 'scaduto'

  // Ha rate in scadenza entro 30 giorni
  const haInScadenza = rateAttesa.some(r => {
    const d = _toDate(r.data_prevista)
    return d && d >= oggi && d <= tra30
  })
  if (haInScadenza) return 'in_scadenza'

  return 'corrente'
}


// ============================================================
// RENDER TABELLA
// ============================================================
function _renderTabella() {
  const elTable = document.getElementById('contratti-table-wrap')
  const elEmpty = document.getElementById('contratti-empty')
  const tbody   = document.getElementById('tb-contratti')
  const elCount = document.getElementById('contratti-count')

  if (elCount) elCount.textContent = _contratti.length

  const oggi  = new Date(); oggi.setHours(0,0,0,0)
  const tra30 = new Date(oggi); tra30.setDate(tra30.getDate() + 30)

  // Applica filtri
  const filtrati = _contratti.filter(c => {
    const statoComp = _computaStato(c)

    // Filtro testo
    if (_testoRicerca) {
      const q = _testoRicerca.toLowerCase()
      if (!(c.cliente || '').toLowerCase().includes(q)) return false
    }

    // Filtro stato
    if (_filtroStato === 'tutti') return true
    return statoComp === _filtroStato
  })

  if (!filtrati.length) {
    if (elTable) elTable.style.display = 'none'
    if (elEmpty) {
      elEmpty.style.display = 'flex'
      const msg = document.getElementById('contratti-empty-msg')
      if (msg) msg.textContent = _testoRicerca
        ? `Nessun contratto trovato per "${_testoRicerca}"`
        : 'Nessun contratto in questa categoria.'
    }
    return
  }

  if (elEmpty) elEmpty.style.display = 'none'
  if (elTable) elTable.style.display = 'block'

  const righe = filtrati.map(c => {
    const statoComp = _computaStato(c)
    const rate      = _rateMap[c.id] || []

    // Riga CSS class
    let rowClass = ''
    if (statoComp === 'scaduto')     rowClass = 'row-scaduto'
    if (statoComp === 'in_scadenza') rowClass = 'row-in-scadenza'

    // Conteggio rate pagate
    const rateTot         = rate.length
    const ratePagate      = rate.filter(r => r.stato === 'pagata').length
    const rateAttesaCount = rate.filter(r => r.stato === 'attesa').length
    const rateAttesaFirst = rate.filter(r => r.stato === 'attesa')
      .sort((a,b) => _toDate(a.data_prevista) - _toDate(b.data_prevista))[0]?.id || ''

    // Prossima rata in attesa
    const prossima = rate
      .filter(r => r.stato === 'attesa')
      .sort((a, b) => _toDate(a.data_prevista) - _toDate(b.data_prevista))[0]

    // Etichetta prossima rata
    let prossimaHtml = '—'
    if (prossima) {
      const dp = _toDate(prossima.data_prevista)
      const giorni = dp ? Math.ceil((dp - oggi) / 86400000) : null
      let giorniHtml = ''
      if (giorni !== null) {
        if (giorni < 0) giorniHtml = `<span class="giorni-scaduto">${Math.abs(giorni)}gg fa</span>`
        else if (giorni === 0) giorniHtml = `<span class="giorni-scaduto">oggi!</span>`
        else if (giorni <= 30) giorniHtml = `<span class="giorni-rimasti">tra ${giorni}gg</span>`
      }
      prossimaHtml = `
        <div style="font-size:11px;font-weight:600;color:var(--text0);">${formatEuro(prossima.importo_totale)}</div>
        <div style="font-size:10px;color:var(--text2);">${dp ? formatDate(dp) : '—'}${giorniHtml}</div>
      `
    }

    // Badge rate
    const badgeRate = rateTot > 0
      ? `<span style="font-size:11px;font-weight:700;color:var(--text1);cursor:pointer;"
           onclick="window.__contrattiDettaglioRate('${c.id}')"
           title="Vedi dettaglio rate">
           ${ratePagate}/${rateTot}
         </span>`
      : '<span style="font-size:11px;color:var(--text2);">—</span>'

    return `<tr class="${rowClass}" data-id="${c.id}">
      <td><strong style="color:var(--text0);">${_esc(c.cliente || '—')}</strong></td>
      <td style="font-size:12px;">${c.data_inizio ? formatDate(_toDate(c.data_inizio)) : '—'}</td>
      <td class="text-right" style="font-size:12px;">${formatEuro(c.importo_imponibile)}</td>
      <td class="text-right" style="font-weight:700;color:var(--text0);">${formatEuro(c.importo_totale)}</td>
      <td class="text-center">${badgeRate}</td>
      <td style="font-size:11px;color:var(--text1);">${_esc(c.conto_accredito_nome || '—')}</td>
      <td>${prossimaHtml}</td>
      <td>${_badgeStato(statoComp)}</td>
      <td>
        <div class="azioni-cell" style="justify-content:flex-end;gap:6px;flex-wrap:wrap;">
          ${rateAttesaCount > 0 ? `
          <button class="btn btn-sm" style="background:var(--green);color:#fff;border:none;"
            onclick="window.__contrattiApriPagamento('${rateAttesaFirst}','${c.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Registra pagamento
          </button>` : ''}
          <button class="btn btn-secondary btn-sm btn-modifica" data-id="${c.id}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Modifica
          </button>
          <button class="btn btn-danger btn-sm btn-elimina" data-id="${c.id}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`
  }).join('')

  if (tbody) {
    tbody.innerHTML = righe

    // Listener bottoni modifica / elimina
    tbody.querySelectorAll('.btn-modifica').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = _contratti.find(x => x.id === btn.dataset.id)
        if (c) _apriModalModifica(c)
      })
    })
    tbody.querySelectorAll('.btn-elimina').forEach(btn => {
      btn.addEventListener('click', () => _eliminaContratto(btn.dataset.id))
    })
  }
}


// ============================================================
// EVENTI UI
// ============================================================
function _collegaEventi() {
  // Ricerca
  document.getElementById('input-ricerca')
    ?.addEventListener('input', e => {
      _testoRicerca = e.target.value.toLowerCase().trim()
      _renderTabella()
    })

  // Chip filtro stato
  document.getElementById('filtri-stato')
    ?.querySelectorAll('.chip-stato')
    .forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip-stato').forEach(c => c.classList.remove('active'))
        chip.classList.add('active')
        _filtroStato = chip.dataset.stato
        _renderTabella()
      })
    })

  // Nuovo contratto
  document.getElementById('btn-nuovo')
    ?.addEventListener('click', _apriModalNuovo)

  // Annulla modal
  document.getElementById('btn-annulla')
    ?.addEventListener('click', _chiudiModal)

  document.getElementById('modal-contratto-close')
    ?.addEventListener('click', _chiudiModal)

  document.getElementById('modal-contratto')
    ?.addEventListener('click', e => {
      if (e.target.id === 'modal-contratto') _chiudiModal()
    })

  // Salva
  document.getElementById('btn-salva')
    ?.addEventListener('click', _salvaContratto)

  // Calcolo automatico IVA contratto
  document.getElementById('f-imponibile')
    ?.addEventListener('input', _aggiornaTotaleContratto)
  document.getElementById('f-iva-rate')
    ?.addEventListener('change', _aggiornaTotaleContratto)

  // Aggiungi rata
  document.getElementById('btn-aggiungi-rata')
    ?.addEventListener('click', () => _aggiungiRigaRata())

  // Modal dettaglio rate
  document.getElementById('modal-rate-close')
    ?.addEventListener('click', () => _chiudiModalRate())
  document.getElementById('modal-rate-chiudi')
    ?.addEventListener('click', () => _chiudiModalRate())
  document.getElementById('modal-rate-dettaglio')
    ?.addEventListener('click', e => {
      if (e.target.id === 'modal-rate-dettaglio') _chiudiModalRate()
    })

  // Modal pagamento: close buttons
  document.getElementById('modal-pag-close')
    ?.addEventListener('click', () => document.getElementById('modal-pagamento').classList.remove('open'))
  document.getElementById('modal-pag-annulla')
    ?.addEventListener('click', () => document.getElementById('modal-pagamento').classList.remove('open'))
  document.getElementById('modal-pag-conferma')
    ?.addEventListener('click', _confermaPagamento)
  document.getElementById('modal-pagamento')
    ?.addEventListener('click', e => { if (e.target.id === 'modal-pagamento') e.target.classList.remove('open') })

  // Espone funzioni al DOM
  window.__contrattiDettaglioRate = _apriDettaglioRate
  window.__contrattiApriPagamento = _apriModalPagamento
}


// ============================================================
// TOTALE CONTRATTO — calcolo automatico
// ============================================================
function _aggiornaTotaleContratto() {
  const imponibile = parseFloat(document.getElementById('f-imponibile')?.value) || 0
  const ivaRate    = parseFloat(document.getElementById('f-iva-rate')?.value)   || 0
  const iva        = imponibile * ivaRate / 100
  const totale     = imponibile + iva

  const elIva  = document.getElementById('f-iva-importo')
  const elTot  = document.getElementById('f-totale')
  if (elIva) elIva.value = iva > 0 ? _fmt2(iva) : '0,00'
  if (elTot) elTot.value = totale > 0 ? _fmt2(totale) : '0,00'

  _aggiornaTotaliRiepilogo()
}


// ============================================================
// RATE — AGGIUNGI RIGA NEL FORM
// ============================================================
function _aggiungiRigaRata(dati = {}) {
  const container   = document.getElementById('rate-container')
  const emptyHint   = document.getElementById('rate-empty-hint')
  const rataHeader  = document.getElementById('rata-header')

  // Nascondi hint, mostra header
  if (emptyHint)  emptyHint.style.display  = 'none'
  if (rataHeader) rataHeader.style.display = 'grid'

  // ID temporaneo per questa riga nel DOM
  const tempId = `r_${Date.now()}_${Math.random().toString(36).substr(2,5)}`

  // Opzioni aliquote IVA
  const opzioniIva = ALIQUOTE_IVA.map(a =>
    `<option value="${a.v}" ${a.v === (dati.iva_rate ?? 22) ? 'selected' : ''}>${a.l}</option>`
  ).join('')

  const riga = document.createElement('div')
  riga.className  = 'rata-row'
  riga.dataset.tempId = tempId
  if (dati.id) riga.dataset.rataId = dati.id   // se è rata esistente

  riga.innerHTML = `
    <input type="text"   class="r-desc"   placeholder="es. Acconto"  value="${_esc(dati.descrizione || '')}"/>
    <input type="number" class="r-imp"    placeholder="0.00"          value="${dati.importo_imponibile || ''}" min="0" step="0.01"/>
    <select class="r-iva">${opzioniIva}</select>
    <input type="text"   class="r-ivaimp" readonly value="${dati.importo_iva ? _fmt2(dati.importo_iva) : ''}"/>
    <input type="text"   class="r-tot"   readonly value="${dati.importo_totale ? _fmt2(dati.importo_totale) : ''}"/>
    <input type="date"   class="r-data"  placeholder="Data scadenza" value="${dati.data_prevista ? toInputDate(_toDate(dati.data_prevista)) : ''}"/>
    <button type="button" class="btn-rata-remove" title="Rimuovi rata">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `

  // Listener calcolo automatico IVA per questa riga
  const inpImp = riga.querySelector('.r-imp')
  const selIva = riga.querySelector('.r-iva')
  const inpIvaImp = riga.querySelector('.r-ivaimp')
  const inpTot = riga.querySelector('.r-tot')

  const calcola = () => {
    const imp  = parseFloat(inpImp.value) || 0
    const rate = parseFloat(selIva.value) || 0
    const iva  = imp * rate / 100
    const tot  = imp + iva
    inpIvaImp.value = _fmt2(iva)
    inpTot.value    = _fmt2(tot)
    _aggiornaTotaliRiepilogo()
  }

  inpImp.addEventListener('input',  calcola)
  selIva.addEventListener('change', calcola)

  // Rimuovi riga
  riga.querySelector('.btn-rata-remove').addEventListener('click', () => {
    // Se rata esistente: segna per eliminazione
    if (riga.dataset.rataId) _rateEliminate.push(riga.dataset.rataId)
    riga.remove()
    _aggiornaVisiblitaHeader()
    _aggiornaTotaliRiepilogo()
  })

  container.appendChild(riga)
  _aggiornaTotaliRiepilogo()
}


// ============================================================
// RATA — mostra/nascondi header colonne
// ============================================================
function _aggiornaVisiblitaHeader() {
  const container  = document.getElementById('rate-container')
  const emptyHint  = document.getElementById('rate-empty-hint')
  const rataHeader = document.getElementById('rata-header')
  const hasRighe   = container?.querySelectorAll('.rata-row').length > 0

  if (emptyHint)  emptyHint.style.display  = hasRighe ? 'none' : 'block'
  if (rataHeader) rataHeader.style.display = hasRighe ? 'grid' : 'none'
}


// ============================================================
// RIEPILOGO RATE vs TOTALE CONTRATTO
// ============================================================
function _aggiornaTotaliRiepilogo() {
  const container = document.getElementById('rate-container')
  const elRiep    = document.getElementById('rate-riepilogo')
  const elCalc    = document.getElementById('rate-totale-calcolato')
  const elCont    = document.getElementById('rate-totale-contratto')
  const elDiffRow = document.getElementById('rate-diff-row')
  const elDiffMsg = document.getElementById('rate-diff-msg')

  const righe = container?.querySelectorAll('.rata-row') || []

  if (!righe.length) {
    if (elRiep) elRiep.style.display = 'none'
    return
  }

  if (elRiep) elRiep.style.display = 'block'

  // Somma totale rate
  let totRate = 0
  righe.forEach(riga => {
    totRate += parseFloat(riga.querySelector('.r-tot')?.value) || 0
  })

  // Totale contratto dal form
  const imponibile = parseFloat(document.getElementById('f-imponibile')?.value) || 0
  const ivaRate    = parseFloat(document.getElementById('f-iva-rate')?.value)   || 0
  const totContratto = imponibile + (imponibile * ivaRate / 100)

  if (elCalc) elCalc.textContent = formatEuro(totRate)
  if (elCont) elCont.textContent = formatEuro(totContratto)

  // Mostra differenza se presente
  const diff = Math.abs(totRate - totContratto)
  if (diff > 0.01 && totContratto > 0) {
    if (elDiffRow) elDiffRow.style.display = 'block'
    if (elDiffMsg) {
      const segno = totRate > totContratto ? 'eccedenza' : 'differenza'
      elDiffMsg.style.color = 'var(--amber)'
      elDiffMsg.textContent = `⚠ ${segno} di ${formatEuro(diff)} rispetto al totale contratto`
    }
  } else {
    if (elDiffRow) elDiffRow.style.display = 'none'
  }
}


// ============================================================
// MODAL — APRI NUOVO
// ============================================================
function _apriModalNuovo() {
  _contrattoInEdit = null
  _rateForm        = []
  _rateEliminate   = []

  document.getElementById('f-id').value          = ''
  document.getElementById('f-cliente').value     = ''
  document.getElementById('f-data-inizio').value = new Date().toISOString().split('T')[0]
  document.getElementById('f-stato').value       = 'corrente'
  document.getElementById('f-imponibile').value  = ''
  document.getElementById('f-iva-rate').value    = '22'
  document.getElementById('f-iva-importo').value = ''
  document.getElementById('f-totale').value      = ''
  document.getElementById('f-modalita').value    = ''
  document.getElementById('f-note').value        = ''
  document.getElementById('f-conto-accredito').value = ''
  document.getElementById('modal-contratto-title').textContent = 'Nuovo contratto'

  // Pulisce rate container
  _svuotaRateContainer()

  document.getElementById('modal-contratto').classList.add('open')
  setTimeout(() => document.getElementById('f-cliente')?.focus(), 150)
}


// ============================================================
// MODAL — APRI MODIFICA
// ============================================================
function _apriModalModifica(c) {
  _contrattoInEdit = c.id
  _rateEliminate   = []

  document.getElementById('f-id').value          = c.id
  document.getElementById('f-cliente').value     = c.cliente     || ''
  document.getElementById('f-data-inizio').value = toInputDate(_toDate(c.data_inizio))
  document.getElementById('f-stato').value       = c.stato       || 'corrente'
  document.getElementById('f-imponibile').value  = c.importo_imponibile ?? ''
  document.getElementById('f-iva-rate').value    = c.iva_rate    ?? 22
  document.getElementById('f-iva-importo').value = c.importo_iva ? _fmt2(c.importo_iva) : ''
  document.getElementById('f-totale').value      = c.importo_totale ? _fmt2(c.importo_totale) : ''
  document.getElementById('f-modalita').value    = c.modalita_pagamento || ''
  document.getElementById('f-note').value        = c.note        || ''
  document.getElementById('f-conto-accredito').value = c.conto_accredito || ''
  document.getElementById('modal-contratto-title').textContent = `Modifica — ${c.cliente}`

  // Popola rate
  _svuotaRateContainer()
  const rate = _rateMap[c.id] || []
  rate.forEach(r => _aggiungiRigaRata(r))
  _aggiornaTotaliRiepilogo()

  document.getElementById('modal-contratto').classList.add('open')
}


// ============================================================
// MODAL — CHIUDI
// ============================================================
function _chiudiModal() {
  document.getElementById('modal-contratto').classList.remove('open')
}

function _svuotaRateContainer() {
  const container = document.getElementById('rate-container')
  if (!container) return
  container.querySelectorAll('.rata-row').forEach(r => r.remove())
  const emptyHint  = document.getElementById('rate-empty-hint')
  const rataHeader = document.getElementById('rata-header')
  if (emptyHint)  emptyHint.style.display  = 'block'
  if (rataHeader) rataHeader.style.display = 'none'
  const elRiep = document.getElementById('rate-riepilogo')
  if (elRiep) elRiep.style.display = 'none'
}


// ============================================================
// SALVA CONTRATTO + RATE
// ============================================================
async function _salvaContratto() {
  const id         = document.getElementById('f-id').value
  const cliente    = document.getElementById('f-cliente').value.trim()
  const dataInizio = document.getElementById('f-data-inizio').value
  const stato      = document.getElementById('f-stato').value
  const imponibile = parseFloat(document.getElementById('f-imponibile').value)
  const ivaRate    = parseFloat(document.getElementById('f-iva-rate').value) || 0
  const modalita   = document.getElementById('f-modalita').value.trim()
  const note       = document.getElementById('f-note').value.trim()

  // Validazione
  if (!cliente)    { toast('Inserisci il nome del cliente', 'error'); return }
  if (!dataInizio) { toast('Inserisci la data di firma', 'error'); return }
  if (!imponibile || imponibile <= 0) { toast('Inserisci un importo imponibile valido', 'error'); return }

  const ivaImporto  = imponibile * ivaRate / 100
  const totale      = imponibile + ivaImporto

  const contoAccredito = document.getElementById('f-conto-accredito')?.value || null
  const contoObj = _conti.find(ct => ct.id === contoAccredito)

  const datiContratto = {
    cliente,
    data_inizio:          toTimestamp(dataInizio),
    stato,
    importo_imponibile:   imponibile,
    iva_rate:             ivaRate,
    importo_iva:          ivaImporto,
    importo_totale:       totale,
    modalita_pagamento:   modalita || null,
    note:                 note || null,
    conto_accredito:      contoAccredito || null,
    conto_accredito_nome: contoObj?.nome || null,
  }

  // Legge le righe rata dal DOM
  const righeRata = document.getElementById('rate-container')?.querySelectorAll('.rata-row') || []
  const rateValide = []

  for (const riga of righeRata) {
    const desc   = riga.querySelector('.r-desc')?.value.trim()
    const imp    = parseFloat(riga.querySelector('.r-imp')?.value)
    const ivaPct = parseFloat(riga.querySelector('.r-iva')?.value) || 0
    const data   = riga.querySelector('.r-data')?.value
    const rataId = riga.dataset.rataId || null

    if (!data) { toast('Inserisci la data di scadenza per tutte le rate', 'error'); return }
    if (!imp || imp <= 0) { toast('Inserisci un importo valido per tutte le rate', 'error'); return }

    const rataIva = imp * ivaPct / 100
    const rataTot = imp + rataIva

    rateValide.push({
      rataId,
      dati: {
        descrizione:        desc || 'Rata',
        importo_imponibile: imp,
        iva_rate:           ivaPct,
        importo_iva:        rataIva,
        importo_totale:     rataTot,
        data_prevista:      toTimestamp(data),
        data_pagamento:     null,
        stato:              'attesa',
      }
    })
  }

  // Disabilita bottone
  const btnSalva = document.getElementById('btn-salva')
  if (btnSalva) { btnSalva.disabled = true; btnSalva.textContent = 'Salvataggio...' }

  try {
    let contrattoId = id

    if (id) {
      // Aggiorna contratto esistente
      await collections.contratti().doc(id).update(datiContratto)
    } else {
      // Crea nuovo contratto
      datiContratto.createdAt = FieldValue.serverTimestamp()
      const ref = await collections.contratti().add(datiContratto)
      contrattoId = ref.id
    }

    // Elimina rate segnate per cancellazione
    for (const rataId of _rateEliminate) {
      await collections.rate().doc(rataId).delete()
    }

    // Salva / aggiorna rate
    for (const { rataId, dati } of rateValide) {
      dati.contratto_ref = contrattoId
      dati.cliente       = cliente

      if (rataId) {
        // Aggiorna rata esistente (mantieni stato pagata se già pagata)
        const rataSnap = await collections.rate().doc(rataId).get()
        const statoAttuale = rataSnap.data()?.stato
        if (statoAttuale === 'pagata') {
          // Non sovrascrivere data_pagamento o stato se già pagata
          const { stato, data_pagamento, ...datiSenzaStato } = dati
          await collections.rate().doc(rataId).update(datiSenzaStato)
        } else {
          await collections.rate().doc(rataId).update(dati)
        }
      } else {
        dati.createdAt = FieldValue.serverTimestamp()
        await collections.rate().add(dati)
      }
    }

    toast(id ? 'Contratto aggiornato ✓' : 'Contratto creato ✓', 'success')
    _chiudiModal()
    await _caricaDati()
    _renderTabella()

  } catch (err) {
    console.error('Contratti: errore salvataggio →', err)
    toast('Errore nel salvataggio. Riprova.', 'error')
  } finally {
    if (btnSalva) {
      btnSalva.disabled = false
      btnSalva.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Salva contratto`
    }
  }
}


// ============================================================
// ELIMINA CONTRATTO + RATE ASSOCIATE
// ============================================================
async function _eliminaContratto(id) {
  const c = _contratti.find(x => x.id === id)
  if (!confirmDelete(`Eliminare il contratto di ${c?.cliente || 'questo cliente'}? Verranno eliminate anche le rate associate.`)) return

  try {
    // Elimina prima tutte le rate
    const rateAssociate = _rateMap[id] || []
    for (const r of rateAssociate) {
      await collections.rate().doc(r.id).delete()
    }

    // Poi elimina il contratto
    await collections.contratti().doc(id).delete()
    toast('Contratto eliminato', 'success')

    await _caricaDati()
    _renderTabella()

  } catch (err) {
    console.error('Contratti: errore eliminazione →', err)
    toast("Errore nell'eliminazione", 'error')
  }
}


// ============================================================
// MODAL — DETTAGLIO RATE (vista read-only)
// ============================================================
function _apriDettaglioRate(contrattoId) {
  const c    = _contratti.find(x => x.id === contrattoId)
  const rate = (_rateMap[contrattoId] || []).sort((a, b) =>
    _toDate(a.data_prevista) - _toDate(b.data_prevista)
  )

  const title = document.getElementById('modal-rate-title')
  if (title) title.textContent = `Rate — ${c?.cliente || ''}`

  const body = document.getElementById('rate-dettaglio-body')
  if (!body) return

  if (!rate.length) {
    body.innerHTML = '<div class="empty-state"><p>Nessuna rata programmata per questo contratto.</p></div>'
  } else {
    // Header
    const header = `<div style="display:grid;grid-template-columns:1.5fr 100px 100px 110px 80px;gap:8px;padding:0 12px 8px;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);">
      <span>Descrizione</span><span>Data prevista</span><span>Totale</span><span>Data pagamento</span><span>Stato</span>
    </div>`

    const righe = rate.map(r => {
      const statoClass = r.stato === 'pagata' ? 'pagata' : (r.stato === 'scaduta' ? 'scaduta' : '')
      const statoHtml = r.stato === 'pagata'
        ? '<span class="badge badge-green">Pagata</span>'
        : r.stato === 'scaduta'
        ? '<span class="badge badge-red">Scaduta</span>'
        : '<span class="badge badge-amber">In attesa</span>'

        // Bottone "Segna come pagata" con data picker inline
      const oggi = new Date().toISOString().split('T')[0]
      const btnPaga = r.stato === 'attesa' ? `
        <div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:6px;border:1px solid var(--border);">
          <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin-bottom:6px;">Registra pagamento</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="date" id="data-paga-${r.id}" value="${oggi}"
              style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:5px;
                     font-family:Montserrat,sans-serif;font-size:12px;color:var(--text0);">
            <button onclick="window.__contrattiPagaRata('${r.id}','${contrattoId}')"
              style="padding:6px 12px;background:var(--green);color:#fff;border:none;border-radius:5px;
                     font-family:Montserrat,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">
              ✓ Pagata
            </button>
          </div>
        </div>` : ''

      return `<div class="rate-dettaglio-row ${statoClass}" id="rata-row-${r.id}">
        <div>
          <div style="font-weight:600;color:var(--text0);">${_esc(r.descrizione || 'Rata')}</div>
          <div style="font-size:10px;color:var(--text2);margin-top:2px;">Imponibile: ${formatEuro(r.importo_imponibile)} + IVA ${r.iva_rate}%</div>
          ${btnPaga}
        </div>
        <div style="font-size:12px;">${r.data_prevista ? formatDate(_toDate(r.data_prevista)) : '—'}</div>
        <div style="font-weight:700;color:var(--text0);">${formatEuro(r.importo_totale)}</div>
        <div style="font-size:11px;color:var(--text2);">${r.data_pagamento ? formatDate(_toDate(r.data_pagamento)) : '—'}</div>
        <div>${statoHtml}</div>
      </div>`
    }).join('')

    // Totale
    const totPagate   = rate.filter(r => r.stato === 'pagata').reduce((s, r) => s + (r.importo_totale || 0), 0)
    const totAttesa   = rate.filter(r => r.stato === 'attesa').reduce((s, r) => s + (r.importo_totale || 0), 0)
    const totRiepilogo = `<div style="margin-top:12px;padding:10px 12px;background:var(--bg1);border-radius:var(--radius-sm);border:1px solid var(--border);font-size:12px;">
      <div class="flex-center gap-8" style="justify-content:space-between;">
        <span style="color:var(--green);font-weight:600;">✓ Pagato</span>
        <span style="font-weight:700;">${formatEuro(totPagate)}</span>
      </div>
      <div class="flex-center gap-8" style="justify-content:space-between;margin-top:4px;">
        <span style="color:var(--amber);font-weight:600;">◷ In attesa</span>
        <span style="font-weight:700;">${formatEuro(totAttesa)}</span>
      </div>
    </div>`

    body.innerHTML = header + righe + totRiepilogo
  }

  document.getElementById('modal-rate-dettaglio').classList.add('open')
}

function _chiudiModalRate() {
  document.getElementById('modal-rate-dettaglio')?.classList.remove('open')
}


// ============================================================
// MODAL PAGAMENTO — apri con dati rata pre-compilati
// ============================================================
function _apriModalPagamento(rataId, contrattoId) {
  const r = (_rateMap[contrattoId] || []).find(x => x.id === rataId)
  const contratto = _contratti.find(x => x.id === contrattoId)
  if (!r || !contratto) return

  // Compila il modal con i dati della rata
  document.getElementById('modal-pag-rata-id').value      = rataId
  document.getElementById('modal-pag-contratto-id').value = contrattoId
  document.getElementById('modal-pag-data').value          = new Date().toISOString().split('T')[0]
  document.getElementById('modal-pag-title').textContent   = `Pagamento — ${_esc(contratto.cliente)}`
  document.getElementById('modal-pag-desc').textContent    = r.descrizione || 'Rata'
  document.getElementById('modal-pag-importo').textContent = formatEuro(r.importo_totale)
  document.getElementById('modal-pag-scadenza').textContent =
    r.data_prevista ? `Scadenza: ${formatDate(_toDate(r.data_prevista))}` : ''

  const contoNome = contratto.conto_accredito_nome || '—'
  document.getElementById('modal-pag-conto-info').textContent = contoNome

  document.getElementById('modal-pagamento').classList.add('open')
}

// ============================================================
// CONFERMA PAGAMENTO — salva movimento e aggiorna rata
// ============================================================
async function _confermaPagamento() {
  const rataId      = document.getElementById('modal-pag-rata-id').value
  const contrattoId = document.getElementById('modal-pag-contratto-id').value
  const dataPag     = document.getElementById('modal-pag-data').value

  if (!dataPag) { toast('Inserisci la data di pagamento', 'error'); return }

  const r = (_rateMap[contrattoId] || []).find(x => x.id === rataId)
  const contratto = _contratti.find(x => x.id === contrattoId)
  if (!r || !contratto) return

  const btn = document.getElementById('modal-pag-conferma')
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...' }

  try {
    const ts = toTimestamp(dataPag)

    // 1. Controlla se esiste già un movimento per questa rata
    const movEsistente = await collections.movimenti()
      .where('rata_ref', '==', rataId).limit(1).get()

    if (movEsistente.empty) {
      // 2. Crea il movimento in /movimenti
      await collections.movimenti().add({
        tipo:          'incasso',
        importo:       r.importo_totale || 0,
        data:          ts,
        descrizione:   `${_esc(r.descrizione || 'Rata')} — ${_esc(contratto.cliente || '')}`,
        categoria:     'Contratto',
        conto:         contratto.conto_accredito || null,
        conto_nome:    contratto.conto_accredito_nome || null,
        iva_rate:      r.iva_rate || 0,
        iva_importo:   r.importo_iva || 0,
        contratto_ref: contrattoId,
        rata_ref:      rataId,
        createdAt:     FieldValue.serverTimestamp()
      })
    }

    // 3. Segna la rata come pagata
    await collections.rate().doc(rataId).update({
      stato:          'pagata',
      data_pagamento: ts
    })

    // 4. Aggiorna cache locale
    if (r) { r.stato = 'pagata'; r.data_pagamento = ts }

    // 5. Chiudi modal
    document.getElementById('modal-pagamento').classList.remove('open')

    toast(`✓ Pagamento di ${formatEuro(r.importo_totale)} registrato — tutto aggiornato!`, 'success')

    // 6. Ricarica e aggiorna vista
    await _caricaDati()
    _renderTabella()

  } catch (err) {
    console.error('Errore conferma pagamento:', err)
    toast('Errore nel salvataggio. Riprova.', 'error')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Conferma pagamento'
    }
  }
}

// ============================================================
// SEGNA RATA COME PAGATA (dal pannello dettaglio rate)
// ============================================================
async function _pagaRata(rataId, contrattoId) {
  const r = (_rateMap[contrattoId] || []).find(x => x.id === rataId)
  const contratto = _contratti.find(x => x.id === contrattoId)
  if (!r || !contratto) return

  // Leggi la data selezionata dall'input inline
  const inputData = document.getElementById(`data-paga-${rataId}`)
  const dataPagamento = inputData?.value || new Date().toISOString().split('T')[0]

  // Disabilita il bottone durante il salvataggio
  const btn = document.querySelector(`[onclick*="${rataId}"]`)
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...' }

  try {
    const ts = toTimestamp(dataPagamento)

    // 1. Crea il movimento in /movimenti
    const movimento = {
      tipo:          'incasso',
      importo:       r.importo_totale || 0,
      data:          ts,
      descrizione:   `${_esc(r.descrizione || 'Rata')} — ${_esc(contratto.cliente || '')}`,
      categoria:     'Contratto',
      conto:         contratto.conto_accredito || null,
      conto_nome:    contratto.conto_accredito_nome || null,
      iva_rate:      r.iva_rate || 0,
      iva_importo:   r.importo_iva || 0,
      contratto_ref: contrattoId,
      rata_ref:      rataId,
      createdAt:     FieldValue.serverTimestamp()
    }
    await collections.movimenti().add(movimento)

    // 2. Segna la rata come pagata
    await collections.rate().doc(rataId).update({
      stato:          'pagata',
      data_pagamento: ts
    })

    // 3. Aggiorna cache locale
    if (r) { r.stato = 'pagata'; r.data_pagamento = ts }

    toast(`Pagamento di ${formatEuro(r.importo_totale)} registrato ✓`, 'success')

    // 4. Ricarica dati e aggiorna la vista
    await _caricaDati()
    _renderTabella()

    // 5. Riapri il modal aggiornato
    _apriDettaglioRate(contrattoId)

  } catch (err) {
    console.error('Errore pagamento rata:', err)
    toast('Errore nel salvataggio. Riprova.', 'error')
    if (btn) { btn.disabled = false; btn.textContent = '✓ Pagata' }
  }
}

// Espone al DOM
window.__contrattiPagaRata = _pagaRata


// ============================================================
// UTILITY
// ============================================================

function _toDate(val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()
  const d = new Date(val)
  return isNaN(d) ? null : d
}

function _badgeStato(stato) {
  const mappa = {
    corrente:    ['badge-green',  'Corrente'],
    in_scadenza: ['badge-amber',  'In scadenza'],
    scaduto:     ['badge-red',    'Scaduto'],
    sospeso:     ['badge-gray',   'Sospeso'],
    concluso:    ['badge-blue',   'Concluso'],
  }
  const [cls, label] = mappa[stato] || ['badge-gray', stato || '—']
  return `<span class="badge ${cls}">${label}</span>`
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Formatta numero con 2 decimali (per i campi readonly)
function _fmt2(n) {
  if (isNaN(n) || n === null) return '0,00'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
