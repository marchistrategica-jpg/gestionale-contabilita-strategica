// ============================================================
// JS/MODULES/PROVVIGIONI.JS
// Modulo Provvigioni — Gestionale Strategica MNS
//
// Importa da:
//   ../firebase-config.js  →  db, collections, toTimestamp
//   ../utils.js            →  formatEuro, formatDate, toInputDate,
//                             toast, openModal, closeModal,
//                             initModalClose, confirmDelete, stateBadge
// ============================================================

import { collections, toTimestamp, FieldValue } from '../firebase-config.js'
import {
  formatEuro, formatDate, toInputDate,
  toast, openModal, closeModal, initModalClose,
  confirmDelete, stateBadge
} from '../utils.js'

// ── STATO MODULO ─────────────────────────────────────────────

let tutteProvvigioni = []   // tutti i documenti Firestore
let tuttiContratti   = []   // usati per la select del form
let tuttiConti       = []   // conti correnti
let filtroStato      = 'tutte'
let filtroAnno       = new Date().getFullYear()
let testoCerca       = ''

// ── ENTRY POINT ──────────────────────────────────────────────

export async function init() {
  try {
    // Carica provvigioni, contratti e conti in parallelo
    const [snapProv, snapCont, snapConti] = await Promise.all([
      collections.provvigioni().orderBy('data', 'desc').get(),
      collections.contratti().orderBy('cliente').get(),
      collections.conti().get()
    ])

    // Mappa documenti Firestore in oggetti JS
    tutteProvvigioni = snapProv.docs.map(d => ({ id: d.id, ...d.data() }))
    tuttiContratti   = snapCont.docs.map(d => ({ id: d.id, ...d.data() }))
    tuttiConti       = snapConti.docs.map(d => ({ id: d.id, ...d.data() }))
    tuttiConti.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))

    // Popola select conto nel form
    const selConto = document.getElementById('fp-conto')
    if (selConto) {
      selConto.innerHTML = '<option value="">— Seleziona conto —</option>'
      tuttiConti.forEach(ct => {
        const opt = document.createElement('option')
        opt.value = ct.id
        opt.textContent = `${ct.nome}${ct.banca ? ' — ' + ct.banca : ''}`
        selConto.appendChild(opt)
      })
    }

    // Popola selettore anno in base ai dati presenti
    popolaSelectAnno()

    // Popola la select contratti nel form modale
    popolaSelectContratti()

    // Disegna KPI e tabella
    aggiornaVista()

    // Collega tutti gli eventi UI
    bindEventi()

    // Inizializza chiusura modal (click fuori / pulsante X)
    initModalClose()

  } catch (err) {
    console.error('Provvigioni — errore init:', err)
    toast('Errore nel caricamento delle provvigioni', 'error')
  }
}

// ── SELETTORE ANNO ───────────────────────────────────────────

function popolaSelectAnno() {
  const sel = document.getElementById('prov-anno')
  if (!sel) return

  // Raccoglie gli anni presenti nei dati
  const anniPresenti = new Set(
    tutteProvvigioni.map(p => {
      const d = p.data?.toDate ? p.data.toDate() : new Date(p.data)
      return d.getFullYear()
    })
  )

  const annoCorrente = new Date().getFullYear()
  anniPresenti.add(annoCorrente) // include sempre l'anno corrente

  // Ordine decrescente
  const anni = [...anniPresenti].sort((a, b) => b - a)

  sel.innerHTML = anni
    .map(a => `<option value="${a}" ${a === filtroAnno ? 'selected' : ''}>${a}</option>`)
    .join('')
}

// ── SELECT CONTRATTI NEL FORM ─────────────────────────────────

function popolaSelectContratti() {
  const sel = document.getElementById('fp-contratto')
  if (!sel) return

  // Prima opzione: nessun contratto (opzionale)
  let html = '<option value="">— Nessun contratto —</option>'

  tuttiContratti.forEach(c => {
    const etichetta = `${c.numero ? c.numero + ' — ' : ''}${c.cliente || '—'}`
    // Salva il valore del contratto come data-attribute per il calcolo automatico
    html += `<option value="${c.id}" data-valore="${c.valore || 0}">${etichetta}</option>`
  })

  sel.innerHTML = html
}

// ── KPI ──────────────────────────────────────────────────────

function aggiornaKpi() {
  const annoStr = String(filtroAnno)

  // Filtra per anno selezionato
  const provAnno = tutteProvvigioni.filter(p => {
    const d = p.data?.toDate ? p.data.toDate() : new Date(p.data)
    return String(d.getFullYear()) === annoStr
  })

  const maturate  = provAnno.reduce((s, p) => s + (p.importo || 0), 0)
  const daPagare  = provAnno.filter(p => p.stato === 'da_pagare')
  const pagate    = provAnno.filter(p => p.stato === 'pagata')

  // Aggiorna le card KPI
  setKpi('kpi-maturate',   formatEuro(maturate),          `${provAnno.length} provvigion${provAnno.length === 1 ? 'e' : 'i'}`)
  setKpi('kpi-da-pagare',  formatEuro(daPagare.reduce((s, p) => s + (p.importo || 0), 0)), `${daPagare.length} in attesa`)
  setKpi('kpi-pagate',     formatEuro(pagate.reduce((s, p) => s + (p.importo || 0), 0)),   `${pagate.length} liquidat${pagate.length === 1 ? 'a' : 'e'}`)
}

function setKpi(idBase, valore, sub) {
  const elVal = document.getElementById(idBase)
  const elSub = document.getElementById(idBase + '-n')
  if (elVal) elVal.textContent = valore
  if (elSub) elSub.textContent = sub
}

// ── FILTRO + RENDER TABELLA ───────────────────────────────────

function filtraProvvigioni() {
  const annoStr = String(filtroAnno)
  const cerca   = testoCerca.toLowerCase().trim()

  return tutteProvvigioni.filter(p => {
    // Filtro anno
    const d = p.data?.toDate ? p.data.toDate() : new Date(p.data)
    if (String(d.getFullYear()) !== annoStr) return false

    // Filtro stato (chip)
    if (filtroStato !== 'tutte' && p.stato !== filtroStato) return false

    // Ricerca testo libero su agente e cliente
    if (cerca) {
      const agente  = (p.agente  || '').toLowerCase()
      const cliente = (p.cliente || '').toLowerCase()
      if (!agente.includes(cerca) && !cliente.includes(cerca)) return false
    }

    return true
  })
}

function renderTabella(provvigioni) {
  const tbody = document.getElementById('prov-tbody')
  const empty = document.getElementById('prov-empty')
  if (!tbody || !empty) return

  if (provvigioni.length === 0) {
    tbody.innerHTML = ''
    empty.style.display = 'block'
    // Messaggio contestuale
    const msg = document.getElementById('prov-empty-msg')
    if (msg) {
      msg.textContent = testoCerca || filtroStato !== 'tutte'
        ? 'Nessuna provvigione corrisponde ai filtri applicati.'
        : 'Nessuna provvigione registrata per questo anno.'
    }
    return
  }

  empty.style.display = 'none'

  // Mappa stato → badge
  const mappaBadge = {
    da_pagare: ['badge-amber', 'Da pagare'],
    pagata:    ['badge-green', 'Pagata']
  }

  tbody.innerHTML = provvigioni.map(p => {
    const badge = stateBadge(p.stato, mappaBadge)

    // Trova il nome breve del contratto collegato (se presente)
    const cont = tuttiContratti.find(c => c.id === p.contratto_ref)
    const contLabel = cont
      ? `<span class="text-muted" style="font-size:11px">${cont.numero || cont.cliente || '—'}</span>`
      : '<span class="text-muted">—</span>'

    // Percentuale: mostra solo se valorizzata
    const percLabel = p.percentuale != null && p.percentuale !== ''
      ? `${Number(p.percentuale).toFixed(1)}%`
      : '—'

    // Azione "Segna come pagata" solo per provvigioni da pagare
    const btnPaga = p.stato === 'da_pagare'
      ? `<button class="btn btn-success btn-sm btn-paga"
                 data-id="${p.id}"
                 title="Segna come pagata">
           <!-- Icona spunta (SVG inline) -->
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round">
             <polyline points="20 6 9 17 4 12"/>
           </svg>
           Pagata
         </button>`
      : ''

    return `
      <tr>
        <td class="fw-700">${escHtml(p.agente || '—')}</td>
        <td>${escHtml(p.cliente || '—')}</td>
        <td>${contLabel}</td>
        <td>${formatDate(p.data)}</td>
        <td class="text-right font-mono">${percLabel}</td>
        <td class="text-right fw-700">${formatEuro(p.importo)}</td>
        <td>${badge}</td>
        <td class="text-right">
          <div class="flex-center gap-8" style="justify-content:flex-end">
            ${btnPaga}
            <button class="btn-icon btn-modifica" data-id="${p.id}" title="Modifica">
              <!-- Icona matita (SVG inline) -->
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon btn-elimina" data-id="${p.id}" title="Elimina">
              <!-- Icona cestino (SVG inline) -->
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `
  }).join('')
}

// ── AGGIORNA VISTA COMPLETA ───────────────────────────────────

function aggiornaVista() {
  aggiornaKpi()
  const filtrate = filtraProvvigioni()
  renderTabella(filtrate)
}

// ── EVENTI UI ─────────────────────────────────────────────────

function bindEventi() {

  // Ricerca testo libero (con debounce leggero)
  const inputCerca = document.getElementById('prov-search')
  if (inputCerca) {
    inputCerca.addEventListener('input', () => {
      testoCerca = inputCerca.value
      aggiornaVista()
    })
  }

  // Chip filtro stato
  document.querySelectorAll('#prov-chips button').forEach(btn => {
    btn.addEventListener('click', () => {
      filtroStato = btn.dataset.filter
      // Aggiorna stile chip: attivo=btn-primary, inattivo=btn-secondary
      document.querySelectorAll('#prov-chips button').forEach(b => {
        b.classList.toggle('btn-primary',   b === btn)
        b.classList.toggle('btn-secondary', b !== btn)
      })
      aggiornaVista()
    })
  })

  // Cambio anno
  const selAnno = document.getElementById('prov-anno')
  if (selAnno) {
    selAnno.addEventListener('change', () => {
      filtroAnno = Number(selAnno.value)
      aggiornaVista()
    })
  }

  // Bottone "Nuova provvigione"
  const btnNuova = document.getElementById('btn-nuova-prov')
  if (btnNuova) {
    btnNuova.addEventListener('click', () => apriModalNuova())
  }

  // Bottone "Salva" nel modal
  const btnSalva = document.getElementById('btn-salva-prov')
  if (btnSalva) {
    btnSalva.addEventListener('click', salvaProvvigione)
  }

  // Delegazione eventi sulla tabella (modifica, elimina, segna pagata)
  const tbody = document.getElementById('prov-tbody')
  if (tbody) {
    tbody.addEventListener('click', async (e) => {
      const btnMod = e.target.closest('.btn-modifica')
      const btnDel = e.target.closest('.btn-elimina')
      const btnPag = e.target.closest('.btn-paga')

      if (btnMod) apriModalModifica(btnMod.dataset.id)
      if (btnDel) eliminaProvvigione(btnDel.dataset.id)
      if (btnPag) segnaComePageta(btnPag.dataset.id)
    })
  }

  // Calcolo automatico importo: reagisce a cambio contratto O percentuale
  const selContratto = document.getElementById('fp-contratto')
  const inputPerc    = document.getElementById('fp-percentuale')

  if (selContratto) {
    selContratto.addEventListener('change', () => {
      mostraValoreContratto()
      calcolaImportoAuto()
    })
  }
  if (inputPerc) {
    inputPerc.addEventListener('input', calcolaImportoAuto)
  }

  // Mostra/nascondi campo data_pagamento in base allo stato
  const selStato = document.getElementById('fp-stato')
  if (selStato) {
    selStato.addEventListener('change', () => {
      toggleDataPagamento(selStato.value)
    })
  }
}

// ── MODAL: NUOVA PROVVIGIONE ──────────────────────────────────

function apriModalNuova() {
  // Reset form
  document.getElementById('form-prov').reset()
  document.getElementById('fp-id').value = ''
  document.getElementById('fp-conto').value = ''
  document.getElementById('modal-prov-title').textContent = 'Nuova provvigione'
  document.getElementById('fp-data').value = oggi()
  document.getElementById('fp-contratto-valore').style.display = 'none'
  toggleDataPagamento('da_pagare')
  openModal('modal-prov')
}

// ── MODAL: MODIFICA PROVVIGIONE ───────────────────────────────

function apriModalModifica(id) {
  const p = tutteProvvigioni.find(x => x.id === id)
  if (!p) return

  document.getElementById('modal-prov-title').textContent = 'Modifica provvigione'
  document.getElementById('fp-id').value     = id
  document.getElementById('fp-agente').value = p.agente   || ''
  document.getElementById('fp-cliente').value= p.cliente  || ''
  document.getElementById('fp-percentuale').value = p.percentuale != null ? p.percentuale : ''
  document.getElementById('fp-importo').value= p.importo  || ''
  document.getElementById('fp-note').value   = p.note     || ''
  document.getElementById('fp-data').value   = toInputDate(p.data)
  document.getElementById('fp-stato').value  = p.stato    || 'da_pagare'
  document.getElementById('fp-data-pag').value = toInputDate(p.data_pagamento)
  document.getElementById('fp-conto').value = p.conto_pagamento || ''

  // Seleziona il contratto collegato (se presente)
  const selCont = document.getElementById('fp-contratto')
  if (selCont) selCont.value = p.contratto_ref || ''
  mostraValoreContratto()

  toggleDataPagamento(p.stato)
  openModal('modal-prov')
}

// ── SALVA (ADD / UPDATE) ──────────────────────────────────────

async function salvaProvvigione() {
  const id       = document.getElementById('fp-id').value
  const agente   = document.getElementById('fp-agente').value.trim()
  const importo  = parseFloat(document.getElementById('fp-importo').value)
  const data     = document.getElementById('fp-data').value
  const stato    = document.getElementById('fp-stato').value

  // Validazione campi obbligatori
  if (!agente) { toast('Inserisci il nome dell\'agente', 'error'); return }
  if (isNaN(importo) || importo <= 0) { toast('Inserisci un importo valido', 'error'); return }
  if (!data) { toast('Inserisci la data di maturazione', 'error'); return }

  // Costruisce il documento da salvare
  const contoId  = document.getElementById('fp-conto')?.value || null
  const contoObj = tuttiConti.find(ct => ct.id === contoId)
  const doc = {
    agente,
    cliente:       document.getElementById('fp-cliente').value.trim(),
    contratto_ref: document.getElementById('fp-contratto').value || null,
    data:          toTimestamp(data),
    percentuale:   parseFloat(document.getElementById('fp-percentuale').value) || null,
    importo,
    stato,
    note:          document.getElementById('fp-note').value.trim(),
    conto_pagamento:      contoId || null,
    conto_pagamento_nome: contoObj?.nome || null,
  }

  // Aggiunge data_pagamento se stata = pagata
  const dataPag = document.getElementById('fp-data-pag').value
  doc.data_pagamento = stato === 'pagata' && dataPag
    ? toTimestamp(dataPag)
    : null

  try {
    if (id) {
      // Modifica documento esistente
      await collections.provvigioni().doc(id).update(doc)
      toast('Provvigione aggiornata')
      // Aggiorna in locale per evitare un fetch completo
      const idx = tutteProvvigioni.findIndex(x => x.id === id)
      if (idx > -1) tutteProvvigioni[idx] = { id, ...doc }
    } else {
      // Nuovo documento
      doc.createdAt = firebase.firestore.FieldValue.serverTimestamp()
      const ref = await collections.provvigioni().add(doc)
      toast('Provvigione aggiunta')
      tutteProvvigioni.unshift({ id: ref.id, ...doc })
    }

    closeModal('modal-prov')
    aggiornaVista()

  } catch (err) {
    console.error('Errore salvataggio provvigione:', err)
    toast('Errore durante il salvataggio', 'error')
  }
}

// ── ELIMINA ───────────────────────────────────────────────────

async function eliminaProvvigione(id) {
  if (!confirmDelete('Eliminare questa provvigione?')) return

  try {
    await collections.provvigioni().doc(id).delete()
    tutteProvvigioni = tutteProvvigioni.filter(x => x.id !== id)
    toast('Provvigione eliminata')
    aggiornaVista()
  } catch (err) {
    console.error('Errore eliminazione:', err)
    toast('Errore durante l\'eliminazione', 'error')
  }
}

// ── SEGNA COME PAGATA ─────────────────────────────────────────

async function segnaComePageta(id) {
  try {
    const p    = tutteProvvigioni.find(x => x.id === id)
    if (!p) return

    const oggi      = new Date()
    const oggiTs    = firebase.firestore.Timestamp.fromDate(oggi)
    const oggiStr   = oggi.toISOString().split('T')[0]

    // 1. Aggiorna provvigione
    await collections.provvigioni().doc(id).update({
      stato:          'pagata',
      data_pagamento: oggiTs
    })

    // 2. Crea movimento automatico in /movimenti (pagamento in uscita)
    await collections.movimenti().add({
      tipo:            'pagamento',
      importo:         p.importo || 0,
      data:            oggiTs,
      descrizione:     `Provvigione — ${p.agente || ''}`,
      categoria:       'Provvigione',
      note:            p.cliente ? `Cliente: ${p.cliente}` : null,
      conto:           p.conto_pagamento || null,
      conto_nome:      p.conto_pagamento_nome || null,
      iva_rate:        0,
      iva_importo:     0,
      contratto_ref:   p.contratto_ref || null,
      provvigione_ref: id,
      createdAt:       FieldValue.serverTimestamp()
    })

    // 3. Aggiorna stato locale
    p.stato          = 'pagata'
    p.data_pagamento = oggiTs

    toast('Provvigione pagata ✓ — movimento registrato in Incassi', 'success')
    aggiornaVista()

  } catch (err) {
    console.error('Errore aggiornamento stato:', err)
    toast('Errore durante l\'aggiornamento', 'error')
  }
}

// ── CALCOLO AUTOMATICO IMPORTO ────────────────────────────────

function calcolaImportoAuto() {
  const selCont  = document.getElementById('fp-contratto')
  const inputPerc= document.getElementById('fp-percentuale')
  const inputImp = document.getElementById('fp-importo')
  const hint     = document.getElementById('fp-calc-hint')

  if (!selCont || !inputPerc || !inputImp) return

  const opt       = selCont.options[selCont.selectedIndex]
  const valore    = parseFloat(opt?.dataset?.valore || 0)
  const perc      = parseFloat(inputPerc.value)

  if (valore > 0 && !isNaN(perc) && perc > 0) {
    // Calcola e precompila l'importo
    const calcolato = (valore * perc) / 100
    inputImp.value = calcolato.toFixed(2)
    if (hint) hint.textContent = `(calcolato: ${perc}% di ${formatEuro(valore)})`
  } else {
    if (hint) hint.textContent = '(inserisci manualmente o calcola da % + contratto)'
  }
}

// ── MOSTRA VALORE CONTRATTO SELEZIONATO ───────────────────────

function mostraValoreContratto() {
  const selCont = document.getElementById('fp-contratto')
  const rowInfo = document.getElementById('fp-contratto-valore')
  const labelCV = document.getElementById('fp-cv-label')

  if (!selCont) return

  const opt    = selCont.options[selCont.selectedIndex]
  const valore = parseFloat(opt?.dataset?.valore || 0)

  if (selCont.value && valore > 0) {
    if (rowInfo) rowInfo.style.display = 'block'
    if (labelCV) labelCV.textContent   = formatEuro(valore)
  } else {
    if (rowInfo) rowInfo.style.display = 'none'
  }
}

// ── MOSTRA / NASCONDE CAMPO DATA PAGAMENTO ────────────────────

function toggleDataPagamento(stato) {
  const row = document.getElementById('fp-row-data-pag')
  if (row) row.style.display = stato === 'pagata' ? 'block' : 'none'
}

// ── UTILITY ───────────────────────────────────────────────────

// Restituisce la data di oggi nel formato yyyy-mm-dd (per input[type=date])
function oggi() {
  return new Date().toISOString().split('T')[0]
}

// Escape HTML per sicurezza nei template string
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
