// ============================================================
// JS/MODULES/COMPENSI.JS — Logica modulo Compensi Soci
//
// Logica di business:
//   - I soci sono 4 fissi: Andrea Piga, Nicola Dalmasso,
//     Simone Marchi, Gianluca Madeddu.
//   - Ogni mese si stabilisce un compenso in euro per ogni socio.
//   - Niente percentuali: l'importo viene inserito direttamente.
//
// Struttura Firestore:
//   soci/{id}      → nome, email
//   compensi/{id}  → socio_ref, socio_nome, importo, periodo,
//                    data_pagamento, stato, note, createdAt
// ============================================================

import { collections, toTimestamp, FieldValue } from '../../js/firebase-config.js'
import {
  formatEuro, formatDate, toInputDate,
  toast, openModal, closeModal, initModalClose, confirmDelete
} from '../../js/utils.js'
import { ICONS } from '../../css/icons.js'

// ── Stato locale ─────────────────────────────────────────────
let soci      = []   // documenti Firestore collezione soci
let compensi  = []   // documenti Firestore collezione compensi
let filtroSocio = '' // '' = tutti
let filtroAnno  = String(new Date().getFullYear())


// ============================================================
// INIT — chiamato dal router dopo l'iniezione dell'HTML
// ============================================================

export async function init() {
  try {
    await caricaDati()
    popolaSelectSoci()
    popolaFiltriAnno()
    renderSociCards()
    renderKPI()
    renderTabella()
    initEventi()
    initModalClose()
  } catch (err) {
    console.error('Errore init compensi:', err)
    toast('Errore nel caricamento del modulo', 'error')
  }
}


// ============================================================
// CARICAMENTO DATI
// ============================================================

async function caricaDati() {
  // Carica soci e compensi in parallelo
  const [snapSoci, snapCompensi] = await Promise.all([
    collections.soci().orderBy('nome').get(),
    collections.compensi().orderBy('createdAt', 'desc').get()
  ])

  soci     = snapSoci.docs.map(d => ({ id: d.id, ...d.data() }))
  compensi = snapCompensi.docs.map(d => ({ id: d.id, ...d.data() }))
}


// ============================================================
// RENDER — CARD PER OGNI SOCIO
// ============================================================

function renderSociCards() {
  const grid = document.getElementById('soci-grid')
  if (!grid) return

  if (soci.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        ${ICONS.users}
        <p>Nessun socio trovato. Controlla la collezione "soci" in Firestore.</p>
      </div>`
    return
  }

  const annoCorrente = new Date().getFullYear()

  grid.innerHTML = soci.map(socio => {
    const compensiSocio = compensi.filter(c => c.socio_ref === socio.id)

    // Somma compensi pagati nell'anno corrente
    const totaleYTD = compensiSocio
      .filter(c => c.stato === 'pagata' && estraiAnno(c) === annoCorrente)
      .reduce((sum, c) => sum + (c.importo || 0), 0)

    // Somma compensi ancora da pagare (tutti gli anni)
    const totaleDaRicevere = compensiSocio
      .filter(c => c.stato === 'da_pagare')
      .reduce((sum, c) => sum + (c.importo || 0), 0)

    // Colore barra in cima alla card
    const colore = totaleDaRicevere > 0 ? 'amber' : 'green'

    return `
      <div class="kpi-card ${colore}">

        <!-- Nome socio -->
        <div class="kpi-label">${ICONS.users} Socio</div>
        <div style="font-size:17px;font-weight:800;color:var(--text0);margin:4px 0 2px">
          ${escHtml(socio.nome)}
        </div>
        ${socio.email
          ? `<div style="font-size:10px;color:var(--text2);margin-bottom:10px">
               ${escHtml(socio.email)}
             </div>`
          : `<div style="margin-bottom:10px"></div>`}

        <!-- Totali -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;
                    padding-top:10px;border-top:1px solid var(--border)">
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.12em;
                        text-transform:uppercase;color:var(--text2)">Ricevuti YTD</div>
            <div style="font-size:14px;font-weight:700;color:var(--green);margin-top:3px">
              ${formatEuro(totaleYTD)}
            </div>
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.12em;
                        text-transform:uppercase;color:var(--text2)">Da ricevere</div>
            <div style="font-size:14px;font-weight:700;margin-top:3px;
                        color:${totaleDaRicevere > 0 ? 'var(--amber)' : 'var(--text2)'}">
              ${totaleDaRicevere > 0 ? formatEuro(totaleDaRicevere) : '—'}
            </div>
          </div>
        </div>

      </div>`
  }).join('')
}


// ============================================================
// RENDER — KPI GENERALI
// ============================================================

function renderKPI() {
  const annoCorrente = new Date().getFullYear()
  const compensiAnno = compensi.filter(c => estraiAnno(c) === annoCorrente)

  // Totale pagato nell'anno corrente (tutti i soci)
  const totaleErogati = compensiAnno
    .filter(c => c.stato === 'pagata')
    .reduce((sum, c) => sum + (c.importo || 0), 0)

  // Totale in sospeso (tutti gli anni, tutti i soci)
  const totaleDaErogare = compensi
    .filter(c => c.stato === 'da_pagare')
    .reduce((sum, c) => sum + (c.importo || 0), 0)

  // Media per periodo: tot pagato / numero di periodi distinti con pagamenti
  const periodiPagati = new Set(
    compensiAnno
      .filter(c => c.stato === 'pagata' && c.periodo)
      .map(c => c.periodo)
  )
  const media = periodiPagati.size > 0 ? totaleErogati / periodiPagati.size : 0

  aggiornaTesto('kpi-erogati',    formatEuro(totaleErogati))
  aggiornaTesto('kpi-da-erogare', formatEuro(totaleDaErogare))
  aggiornaTesto('kpi-media',      formatEuro(media))
}


// ============================================================
// RENDER — TABELLA COMPENSI
// ============================================================

function renderTabella() {
  const wrap = document.getElementById('tabella-compensi-wrap')
  if (!wrap) return

  // Applica filtri
  const dati = compensi.filter(c => {
    const matchSocio = !filtroSocio || c.socio_ref === filtroSocio
    const matchAnno  = !filtroAnno  || String(estraiAnno(c)) === filtroAnno
    return matchSocio && matchAnno
  })

  if (dati.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        ${ICONS.euro}
        <p>Nessun compenso trovato con i filtri selezionati.</p>
      </div>`
    return
  }

  const righe = dati.map(c => {
    const badge = c.stato === 'pagata'
      ? `<span class="badge badge-green">Pagata</span>`
      : `<span class="badge badge-amber">Da pagare</span>`

    const btnPaga = c.stato === 'da_pagare'
      ? `<button class="btn btn-success btn-sm"
           onclick="window.__compPaga('${c.id}')" title="Segna come pagata">
           ${ICONS.check} Paga
         </button>`
      : ''

    return `
      <tr>
        <td><span style="font-weight:600;color:var(--text0)">${escHtml(c.socio_nome || '—')}</span></td>
        <td>${escHtml(c.periodo || '—')}</td>
        <td class="text-right">
          <span style="font-weight:700;color:var(--text0)">${formatEuro(c.importo)}</span>
        </td>
        <td>${c.data_pagamento ? formatDate(c.data_pagamento) : '—'}</td>
        <td>${badge}</td>
        <td>
          <div class="flex-center gap-8">
            ${btnPaga}
            <button class="btn btn-icon btn-sm"
              onclick="window.__compEdit('${c.id}')" title="Modifica">
              ${ICONS.edit}
            </button>
            <button class="btn btn-danger btn-sm"
              onclick="window.__compDelete('${c.id}')" title="Elimina">
              ${ICONS.trash}
            </button>
          </div>
        </td>
      </tr>`
  }).join('')

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Socio</th>
          <th>Periodo</th>
          <th class="text-right">Importo</th>
          <th>Data pagamento</th>
          <th>Stato</th>
          <th>Azioni</th>
        </tr>
      </thead>
      <tbody>${righe}</tbody>
    </table>`
}


// ============================================================
// POPOLA SELECT E FILTRI
// ============================================================

// Select socio nel form modal e nel filtro tabella
function popolaSelectSoci() {
  const opzioni = soci.map(s =>
    `<option value="${s.id}">${escHtml(s.nome)}</option>`
  ).join('')

  // Select nel form modal
  const selForm = document.getElementById('compenso-socio')
  if (selForm) {
    selForm.innerHTML = `<option value="">Seleziona socio...</option>` + opzioni
  }

  // Select filtro tabella
  const selFiltro = document.getElementById('filtro-socio')
  if (selFiltro) {
    selFiltro.innerHTML = `<option value="">Tutti i soci</option>` + opzioni
  }
}

// Selettore anno nella tabella
function popolaFiltriAnno() {
  const el = document.getElementById('filtro-anno')
  if (!el) return

  const annoCorrente = new Date().getFullYear()
  const anniSet = new Set(compensi.map(c => estraiAnno(c)).filter(Boolean))
  anniSet.add(annoCorrente)
  const anni = [...anniSet].sort((a, b) => b - a)

  el.innerHTML =
    `<option value="">Tutti gli anni</option>` +
    anni.map(a =>
      `<option value="${a}" ${String(a) === filtroAnno ? 'selected' : ''}>${a}</option>`
    ).join('')
}


// ============================================================
// EVENTI
// ============================================================

function initEventi() {
  // Filtro anno
  document.getElementById('filtro-anno')
    ?.addEventListener('change', e => { filtroAnno = e.target.value; renderTabella() })

  // Filtro socio
  document.getElementById('filtro-socio')
    ?.addEventListener('change', e => { filtroSocio = e.target.value; renderTabella() })

  // Apri modal nuovo compenso
  document.getElementById('btn-nuovo-compenso')
    ?.addEventListener('click', apriModalNuovo)

  // Salva compenso
  document.getElementById('btn-salva-compenso')
    ?.addEventListener('click', salvaCompenso)

  // Chiudi modal compenso
  document.getElementById('btn-cancel-compenso')
    ?.addEventListener('click', () => closeModal('modal-compenso'))
  document.getElementById('modal-compenso-close')
    ?.addEventListener('click', () => closeModal('modal-compenso'))

  // Espone le funzioni al DOM per i click inline nella tabella
  window.__compEdit   = editCompenso
  window.__compDelete = deleteCompenso
  window.__compPaga   = pagaCompenso
}


// ============================================================
// MODAL — APRI NUOVO
// ============================================================

function apriModalNuovo() {
  document.getElementById('compenso-id').value      = ''
  document.getElementById('compenso-socio').value   = ''
  document.getElementById('compenso-importo').value = ''
  document.getElementById('compenso-periodo').value = ''
  document.getElementById('compenso-data').value    = ''
  document.getElementById('compenso-stato').value   = 'da_pagare'
  document.getElementById('compenso-note').value    = ''
  document.getElementById('modal-compenso-title').textContent = 'Nuovo compenso'
  openModal('modal-compenso')
}


// ============================================================
// MODAL — POPOLA PER MODIFICA
// ============================================================

function editCompenso(id) {
  const c = compensi.find(x => x.id === id)
  if (!c) return toast('Compenso non trovato', 'error')

  document.getElementById('compenso-id').value      = c.id
  document.getElementById('compenso-socio').value   = c.socio_ref || ''
  document.getElementById('compenso-importo').value = c.importo || ''
  document.getElementById('compenso-periodo').value = c.periodo || ''
  document.getElementById('compenso-data').value    = toInputDate(c.data_pagamento)
  document.getElementById('compenso-stato').value   = c.stato || 'da_pagare'
  document.getElementById('compenso-note').value    = c.note || ''
  document.getElementById('modal-compenso-title').textContent = 'Modifica compenso'
  openModal('modal-compenso')
}


// ============================================================
// SALVA COMPENSO (nuovo o modifica)
// ============================================================

async function salvaCompenso() {
  const id      = document.getElementById('compenso-id').value.trim()
  const socioId = document.getElementById('compenso-socio').value
  const importo = parseFloat(document.getElementById('compenso-importo').value)
  const periodo = document.getElementById('compenso-periodo').value.trim()
  const data    = document.getElementById('compenso-data').value
  const stato   = document.getElementById('compenso-stato').value
  const note    = document.getElementById('compenso-note').value.trim()

  // Validazione
  if (!socioId)                                    return toast('Seleziona un socio', 'error')
  if (!importo || isNaN(importo) || importo <= 0)  return toast('Inserisci un importo valido', 'error')
  if (!periodo)                                    return toast('Inserisci il periodo (es. Gennaio 2025)', 'error')

  // Nome del socio da salvare nel documento (campo denormalizzato)
  const socio = soci.find(s => s.id === socioId)
  if (!socio) return toast('Socio non trovato', 'error')

  const dati = {
    socio_ref:      socioId,
    socio_nome:     socio.nome,
    importo,
    periodo,
    data_pagamento: data ? toTimestamp(data) : null,
    stato,
    note
  }

  // Feedback sul bottone durante il salvataggio
  const btn = document.getElementById('btn-salva-compenso')
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...' }

  try {
    // Stato precedente (per capire se è cambiato a 'pagata')
    const vecchio = id ? compensi.find(x => x.id === id) : null
    const eraGiaPagata = vecchio?.stato === 'pagata'

    let savedId = id
    if (id) {
      await collections.compensi().doc(id).update(dati)
      toast('Compenso aggiornato', 'success')
    } else {
      dati.createdAt = FieldValue.serverTimestamp()
      const ref = await collections.compensi().add(dati)
      savedId = ref.id
      toast('Compenso aggiunto', 'success')
    }

    // Crea movimento automatico se stato='pagata' e non era già pagata
    if (stato === 'pagata' && !eraGiaPagata && savedId) {
      const ts = data ? toTimestamp(data) : FieldValue.serverTimestamp()
      await collections.movimenti().add({
        tipo:         'pagamento',
        importo:      importo || 0,
        data:         data ? toTimestamp(data) : toTimestamp(new Date().toISOString().split('T')[0]),
        descrizione:  `Compenso socio — ${socio.nome}`,
        categoria:    'Compenso socio',
        note:         periodo ? `Periodo: ${periodo}` : null,
        conto:        null,
        iva_rate:     0,
        iva_importo:  0,
        compenso_ref: savedId,
        createdAt:    FieldValue.serverTimestamp()
      })
      toast(`✓ Compenso registrato in Incassi & Pagamenti automaticamente`, 'success', 5000)
    }

    closeModal('modal-compenso')
    await caricaDati()
    renderSociCards()
    renderKPI()
    renderTabella()

  } catch (err) {
    console.error('Errore salvataggio:', err)
    toast('Errore nel salvataggio. Riprova.', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salva' }
  }
}


// ============================================================
// ELIMINA COMPENSO
// ============================================================

async function deleteCompenso(id) {
  if (!confirmDelete('Eliminare definitivamente questo compenso?')) return

  try {
    await collections.compensi().doc(id).delete()
    toast('Compenso eliminato', 'success')
    await caricaDati()
    renderSociCards()
    renderKPI()
    renderTabella()
  } catch (err) {
    console.error('Errore eliminazione:', err)
    toast('Errore nell\'eliminazione', 'error')
  }
}


// ============================================================
// SEGNA COMPENSO COME PAGATO
// ============================================================

async function pagaCompenso(id) {
  try {
    const c   = compensi.find(x => x.id === id)
    if (!c) return

    const oggi    = new Date().toISOString().split('T')[0]
    const oggiTs  = toTimestamp(oggi)

    // 1. Aggiorna compenso
    await collections.compensi().doc(id).update({
      stato:          'pagata',
      data_pagamento: oggiTs
    })

    // 2. Crea movimento automatico in /movimenti (pagamento in uscita)
    await collections.movimenti().add({
      tipo:         'pagamento',
      importo:      c.importo || 0,
      data:         oggiTs,
      descrizione:  `Compenso socio — ${c.socio_nome || ''}`,
      categoria:    'Compenso socio',
      note:         c.periodo ? `Periodo: ${c.periodo}` : null,
      conto:        null,
      iva_rate:     0,
      iva_importo:  0,
      compenso_ref: id,
      createdAt:    FieldValue.serverTimestamp()
    })

    toast('Compenso pagato ✓ — movimento registrato in Incassi', 'success')
    await caricaDati()
    renderSociCards()
    renderKPI()
    renderTabella()

  } catch (err) {
    console.error('Errore pagamento:', err)
    toast('Errore nell\'aggiornamento', 'error')
  }
}


// ============================================================
// UTILITY
// ============================================================

// Estrae l'anno da un compenso.
// Guarda prima il campo "periodo" (es. "Gennaio 2025" → 2025),
// poi data_pagamento, poi createdAt.
function estraiAnno(c) {
  if (c.periodo) {
    const m = c.periodo.match(/\b(20\d\d)\b/)
    if (m) return parseInt(m[1])
  }
  for (const campo of [c.data_pagamento, c.createdAt]) {
    if (campo) {
      const d = campo.toDate ? campo.toDate() : new Date(campo)
      if (!isNaN(d)) return d.getFullYear()
    }
  }
  return new Date().getFullYear()
}

// Aggiorna il testo di un elemento del DOM
function aggiornaTesto(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

// Escape HTML per prevenire XSS con dati da Firestore
function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
