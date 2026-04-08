// ============================================================
// IVA.JS — Modulo IVA & Conti Correnti
// File: js/modules/iva.js
// Dipendenze: firebase-config.js, utils.js
// ============================================================

import { db, collections, toTimestamp } from '../firebase-config.js'
import { formatEuro, formatDate, toInputDate, toast, openModal, closeModal, initModalClose, confirmDelete } from '../utils.js'

// ---- Stato locale del modulo ----
let tuttiMovimenti = []   // Cache movimenti Firestore
let tuttiConti    = []    // Cache conti Firestore

// ── Punto di ingresso chiamato da router.js ─────────────────
export async function init() {

  // Popola il selettore anni (anno corrente ± 3)
  popolaAnni()

  // Imposta trimestre corrente come default
  impostaTrimestreCorrente()

  // Carica i dati da Firestore in parallelo
  await Promise.all([
    caricaConti(),
    caricaMovimenti()
  ])

  // Renderizza entrambe le sezioni
  renderConti()
  renderIVA()

  // Collega tutti gli event listener
  collegaEventi()
}

// ════════════════════════════════════════════════════════════
// SEZIONE ANNI / TRIMESTRE
// ════════════════════════════════════════════════════════════

function popolaAnni() {
  const sel = document.getElementById('sel-anno')
  if (!sel) return

  const annoCorrente = new Date().getFullYear()
  // Mostra dal 2022 fino a 2 anni nel futuro
  for (let a = annoCorrente + 1; a >= 2022; a--) {
    const opt = document.createElement('option')
    opt.value = a
    opt.textContent = a
    if (a === annoCorrente) opt.selected = true
    sel.appendChild(opt)
  }
}

function impostaTrimestreCorrente() {
  const mese = new Date().getMonth() // 0-11
  const trimCorrente = Math.floor(mese / 3) + 1 // 1-4
  const sel = document.getElementById('sel-trimestre')
  if (sel) sel.value = trimCorrente
}

// Restituisce { inizio: Date, fine: Date } del trimestre selezionato
function getRangeTrimestreSel() {
  const t = parseInt(document.getElementById('sel-trimestre')?.value || 1)
  const a = parseInt(document.getElementById('sel-anno')?.value || new Date().getFullYear())

  const meseInizio = (t - 1) * 3        // 0, 3, 6, 9
  const inizio = new Date(a, meseInizio, 1)
  const fine   = new Date(a, meseInizio + 3, 0, 23, 59, 59) // ultimo giorno del trimestre

  return { inizio, fine }
}

// ════════════════════════════════════════════════════════════
// CARICAMENTO DATI FIRESTORE
// ════════════════════════════════════════════════════════════

async function caricaConti() {
  try {
    const snap = await collections.conti().orderBy('nome').get()
    tuttiConti = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  } catch (e) {
    console.error('Errore caricamento conti:', e)
    tuttiConti = []
  }
}

async function caricaMovimenti() {
  try {
    const snap = await collections.movimenti().orderBy('data', 'desc').get()
    tuttiMovimenti = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  } catch (e) {
    console.error('Errore caricamento movimenti:', e)
    tuttiMovimenti = []
  }
}

// ════════════════════════════════════════════════════════════
// SEZIONE CONTI CORRENTI
// ════════════════════════════════════════════════════════════

function renderConti() {
  const grid = document.getElementById('conti-grid')
  if (!grid) return

  if (tuttiConti.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/>
          <line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/>
          <line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>
        </svg>
        <p>Nessun conto corrente registrato</p>
        <p style="font-size:11px;margin-top:4px;">Clicca "Aggiungi Conto" per iniziare</p>
      </div>
    `
    return
  }

  grid.innerHTML = tuttiConti.map(conto => {
    const saldo = calcolaSaldo(conto)
    const coloreSaldo = saldo >= 0 ? 'var(--green)' : 'var(--red)'
    const ibanMasc = mascheraIBAN(conto.iban || '')

    return `
      <div class="card" style="overflow:visible;">
        <!-- Intestazione card conto -->
        <div class="card-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <!-- Icona banca -->
            <div style="
              width:36px; height:36px; border-radius:10px;
              background:var(--secondaryD);
              display:flex; align-items:center; justify-content:center;
              color:var(--secondary); flex-shrink:0;
            ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/>
                <line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/>
                <line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>
              </svg>
            </div>
            <div>
              <div style="font-weight:700; font-size:13px; color:var(--text0);">${esc(conto.nome)}</div>
              <div style="font-size:11px; color:var(--text2); font-weight:500;">${esc(conto.banca || '—')}</div>
            </div>
          </div>
          <!-- Azioni conto -->
          <div style="display:flex; gap:6px;">
            <button class="btn-icon btn btn-sm" onclick="window._ivaModificaConto('${conto.id}')" title="Modifica">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon btn btn-sm" onclick="window._ivaEliminaConto('${conto.id}','${esc(conto.nome)}')" title="Elimina">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Corpo card: saldo e IBAN -->
        <div class="card-body">
          <div style="margin-bottom:12px;">
            <div style="font-size:9px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--text2); margin-bottom:4px;">SALDO ATTUALE</div>
            <div style="font-size:26px; font-weight:800; color:${coloreSaldo}; line-height:1.1;">${formatEuro(saldo)}</div>
            <div style="font-size:10px; color:var(--text2); margin-top:3px;">
              Saldo iniziale: ${formatEuro(conto.saldo_iniziale || 0)}
            </div>
          </div>

          ${ibanMasc ? `
          <div style="
            background:var(--bg2); border-radius:var(--rs);
            padding:8px 12px; font-size:12px;
            font-weight:600; color:var(--text1);
            letter-spacing:.05em; margin-bottom:12px;
          ">${ibanMasc}</div>
          ` : ''}

          <!-- Bottone estratto conto -->
          <button class="btn btn-secondary btn-sm" style="width:100%; justify-content:center;"
            onclick="window._ivaEstrattoConto('${conto.id}','${esc(conto.nome)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            Ultimi movimenti
          </button>
        </div>
      </div>
    `
  }).join('')
}

// Calcola saldo reale: saldo_iniziale + somma movimenti del conto
function calcolaSaldo(conto) {
  const base = Number(conto.saldo_iniziale) || 0
  const nomeNorm = (conto.nome || '').toLowerCase().trim()

  const delta = tuttiMovimenti
    .filter(m => {
      if (!m.conto && !m.conto_nome) return false
      if (m.conto === conto.id) return true
      if (m.conto === conto.nome) return true
      if (m.conto_nome === conto.nome) return true
      const mc = (m.conto || m.conto_nome || '').toLowerCase().trim()
      return mc === nomeNorm
    })
    .reduce((acc, m) => {
      const imp = Number(m.importo) || 0
      return acc + (m.tipo === 'incasso' ? imp : -imp)
    }, 0)

  return base + delta
}

// Maschera IBAN: mostra solo primi 4 e ultimi 4 caratteri
function mascheraIBAN(iban) {
  if (!iban || iban.length < 10) return iban
  const pulito = iban.replace(/\s/g, '')
  return pulito.slice(0, 4) + ' •••• •••• •••• ' + pulito.slice(-4)
}

// ════════════════════════════════════════════════════════════
// SEZIONE IVA
// ════════════════════════════════════════════════════════════

function renderIVA() {
  const { inizio, fine } = getRangeTrimestreSel()

  // Filtra movimenti nel range del trimestre selezionato
  const movTrimestre = tuttiMovimenti.filter(m => {
    const data = m.data?.toDate ? m.data.toDate() : new Date(m.data)
    return data >= inizio && data <= fine
  })

  // Calcola IVA per tipo
  const ivaDebito  = calcolaIVATipo(movTrimestre, 'incasso')   // IVA sulle vendite
  const ivaCredito = calcolaIVATipo(movTrimestre, 'pagamento') // IVA sugli acquisti
  const saldoIVA   = ivaDebito.totale - ivaCredito.totale      // positivo = da versare

  // Etichetta periodo
  const nomeTrim = ['I', 'II', 'III', 'IV'][parseInt(document.getElementById('sel-trimestre')?.value || 1) - 1]
  const anno = document.getElementById('sel-anno')?.value || new Date().getFullYear()
  const periodoLabel = `${nomeTrim} Trimestre ${anno}`

  const labelEl = document.getElementById('iva-periodo-label')
  if (labelEl) labelEl.textContent = periodoLabel

  // ── KPI cards ──
  const kpiEl = document.getElementById('iva-kpi')
  if (kpiEl) {
    kpiEl.innerHTML = `
      <!-- IVA a debito (sulle vendite) -->
      <div class="kpi-card primary">
        <div class="kpi-label">IVA a Debito (Vendite)</div>
        <div class="kpi-value">${formatEuro(ivaDebito.totale)}</div>
        <div class="kpi-sub">${movTrimestre.filter(m=>m.tipo==='incasso').length} incassi nel periodo</div>
      </div>

      <!-- IVA a credito (sugli acquisti) -->
      <div class="kpi-card secondary">
        <div class="kpi-label">IVA a Credito (Acquisti)</div>
        <div class="kpi-value">${formatEuro(ivaCredito.totale)}</div>
        <div class="kpi-sub">${movTrimestre.filter(m=>m.tipo==='pagamento').length} pagamenti nel periodo</div>
      </div>

      <!-- Saldo IVA -->
      <div class="kpi-card ${saldoIVA >= 0 ? 'red' : 'green'}">
        <div class="kpi-label">
          ${saldoIVA >= 0 ? '⚠ IVA da Versare' : '✓ IVA a Credito'}
        </div>
        <div class="kpi-value" style="color:${saldoIVA >= 0 ? 'var(--red)' : 'var(--green)'}">
          ${formatEuro(Math.abs(saldoIVA))}
        </div>
        <div class="kpi-sub">${saldoIVA >= 0 ? 'Debito verso erario' : 'Credito verso erario'}</div>
      </div>
    `
  }

  // ── Tabella per aliquota ──
  const tabEl = document.getElementById('iva-tabella-body')
  if (!tabEl) return

  // Aliquote IVA comuni in Italia
  const aliquote = [4, 10, 22]

  // Raggruppa per aliquota
  const righe = aliquote.map(al => {
    const vendite   = ivaDebito.perAliquota[al]  || { imponibile: 0, iva: 0 }
    const acquisti  = ivaCredito.perAliquota[al] || { imponibile: 0, iva: 0 }
    const saldo     = vendite.iva - acquisti.iva
    return { al, vendite, acquisti, saldo }
  }).filter(r => r.vendite.iva !== 0 || r.acquisti.iva !== 0) // mostra solo aliquote usate

  if (righe.length === 0) {
    tabEl.innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <p>Nessun movimento con IVA nel ${periodoLabel}</p>
        <p style="font-size:11px;margin-top:4px;">Controlla che i movimenti abbiano l'aliquota IVA compilata</p>
      </div>
    `
    return
  }

  tabEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Aliquota</th>
          <th class="text-right">Imponibile Vendite</th>
          <th class="text-right">IVA Vendite</th>
          <th class="text-right">Imponibile Acquisti</th>
          <th class="text-right">IVA Acquisti</th>
          <th class="text-right">Saldo Aliquota</th>
        </tr>
      </thead>
      <tbody>
        ${righe.map(r => `
          <tr>
            <td><span class="badge badge-blue">${r.al}%</span></td>
            <td class="text-right">${formatEuro(r.vendite.imponibile)}</td>
            <td class="text-right fw-700 text-red">${formatEuro(r.vendite.iva)}</td>
            <td class="text-right">${formatEuro(r.acquisti.imponibile)}</td>
            <td class="text-right fw-700 text-green">${formatEuro(r.acquisti.iva)}</td>
            <td class="text-right fw-700" style="color:${r.saldo >= 0 ? 'var(--red)' : 'var(--green)'}">
              ${formatEuro(Math.abs(r.saldo))}
              <span style="font-size:10px;font-weight:500;color:var(--text2);margin-left:3px;">
                ${r.saldo >= 0 ? 'debito' : 'credito'}
              </span>
            </td>
          </tr>
        `).join('')}
        <!-- Riga totali -->
        <tr style="background:rgba(15,80,123,0.04); border-top:2px solid var(--border);">
          <td class="fw-700" style="color:var(--text0);">TOTALE</td>
          <td class="text-right fw-700">${formatEuro(righe.reduce((s,r)=>s+r.vendite.imponibile,0))}</td>
          <td class="text-right fw-700 text-red">${formatEuro(ivaDebito.totale)}</td>
          <td class="text-right fw-700">${formatEuro(righe.reduce((s,r)=>s+r.acquisti.imponibile,0))}</td>
          <td class="text-right fw-700 text-green">${formatEuro(ivaCredito.totale)}</td>
          <td class="text-right fw-700" style="color:${saldoIVA>=0?'var(--red)':'var(--green)'}">
            ${formatEuro(Math.abs(saldoIVA))}
          </td>
        </tr>
      </tbody>
    </table>
  `
}

// Calcola IVA raggruppata per tipo movimento e aliquota
function calcolaIVATipo(movimenti, tipo) {
  const filtrati = movimenti.filter(m => m.tipo === tipo && m.iva_rate > 0)

  const perAliquota = {}
  let totale = 0

  filtrati.forEach(m => {
    const al  = Number(m.iva_rate) || 0
    const iva = Number(m.iva_importo) || 0
    // Calcola imponibile da importo e aliquota (fallback)
    const imp = iva > 0 ? (Number(m.importo) - iva) : 0

    if (!perAliquota[al]) perAliquota[al] = { imponibile: 0, iva: 0 }
    perAliquota[al].imponibile += imp
    perAliquota[al].iva        += iva
    totale += iva
  })

  return { totale, perAliquota }
}

// ════════════════════════════════════════════════════════════
// MODAL ESTRATTO CONTO
// ════════════════════════════════════════════════════════════

function apriEstrattoConto(contoId, contoNome) {
  const body  = document.getElementById('modal-estratto-body')
  const title = document.getElementById('modal-estratto-title')

  if (title) title.textContent = `Estratto: ${contoNome}`

  // Filtra e ordina movimenti del conto
  const movConto = tuttiMovimenti
    .filter(m => m.conto === contoId || m.conto === contoNome)
    .slice(0, 20) // ultimi 20

  if (!body) return

  if (movConto.length === 0) {
    body.innerHTML = `<div class="empty-state"><p>Nessun movimento per questo conto</p></div>`
  } else {
    body.innerHTML = `
      <table style="width:100%">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrizione</th>
            <th>Tipo</th>
            <th class="text-right">Importo</th>
          </tr>
        </thead>
        <tbody>
          ${movConto.map(m => {
            const isIncasso = m.tipo === 'incasso'
            return `
              <tr>
                <td style="font-size:12px; white-space:nowrap;">${formatDate(m.data)}</td>
                <td style="font-size:12px;">${esc(m.descrizione || '—')}</td>
                <td>
                  <span class="badge ${isIncasso ? 'badge-green' : 'badge-red'}">
                    ${isIncasso ? 'Entrata' : 'Uscita'}
                  </span>
                </td>
                <td class="text-right fw-700" style="color:${isIncasso ? 'var(--green)' : 'var(--red)'}">
                  ${isIncasso ? '+' : '−'}${formatEuro(m.importo)}
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px; font-size:11px; color:var(--text2); text-align:right;">
        Mostrati gli ultimi ${movConto.length} movimenti
      </div>
    `
  }

  openModal('modal-estratto')
}

// ════════════════════════════════════════════════════════════
// CRUD CONTI
// ════════════════════════════════════════════════════════════

function apriModalConto(contoId = null) {
  // Pulisce il form
  document.getElementById('conto-id').value  = contoId || ''
  document.getElementById('conto-nome').value  = ''
  document.getElementById('conto-banca').value = ''
  document.getElementById('conto-iban').value  = ''
  document.getElementById('conto-saldo').value = ''

  const title = document.getElementById('modal-conto-title')

  if (contoId) {
    // Modalità modifica — precompila i campi
    const conto = tuttiConti.find(c => c.id === contoId)
    if (conto) {
      if (title) title.textContent = 'Modifica Conto'
      document.getElementById('conto-nome').value  = conto.nome  || ''
      document.getElementById('conto-banca').value = conto.banca || ''
      document.getElementById('conto-iban').value  = conto.iban  || ''
      document.getElementById('conto-saldo').value = conto.saldo_iniziale ?? ''
    }
  } else {
    if (title) title.textContent = 'Nuovo Conto Corrente'
  }

  openModal('modal-conto')
}

async function salvaConto() {
  const id    = document.getElementById('conto-id').value
  const nome  = document.getElementById('conto-nome').value.trim()
  const banca = document.getElementById('conto-banca').value.trim()
  const iban  = document.getElementById('conto-iban').value.trim()
  const saldo = parseFloat(document.getElementById('conto-saldo').value) || 0

  // Validazione minima
  if (!nome || !banca) {
    toast('Inserisci almeno Nome e Banca', 'error')
    return
  }

  const dati = {
    nome,
    banca,
    iban,
    saldo_iniziale: saldo,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }

  try {
    if (id) {
      // Aggiorna documento esistente
      await collections.conti().doc(id).update(dati)
      toast('Conto aggiornato', 'success')
    } else {
      // Crea nuovo documento
      dati.createdAt = firebase.firestore.FieldValue.serverTimestamp()
      await collections.conti().add(dati)
      toast('Conto aggiunto', 'success')
    }

    // Ricarica e ridisegna
    await caricaConti()
    renderConti()
    closeModal('modal-conto')

  } catch (e) {
    console.error('Errore salvataggio conto:', e)
    toast('Errore nel salvataggio', 'error')
  }
}

async function eliminaConto(id, nome) {
  if (!confirmDelete(`Eliminare il conto "${nome}"? L'operazione non è reversibile.`)) return

  try {
    await collections.conti().doc(id).delete()
    toast('Conto eliminato', 'success')
    await caricaConti()
    renderConti()
  } catch (e) {
    console.error('Errore eliminazione conto:', e)
    toast('Errore nell\'eliminazione', 'error')
  }
}

// ════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════════════════════════

function collegaEventi() {

  // Bottone "Aggiungi Conto"
  document.getElementById('btn-nuovo-conto')
    ?.addEventListener('click', () => apriModalConto())

  // Salva conto dal modal
  document.getElementById('modal-conto-salva')
    ?.addEventListener('click', salvaConto)

  // Annulla modal conto
  document.getElementById('modal-conto-annulla')
    ?.addEventListener('click', () => closeModal('modal-conto'))

  // Chiudi estratto conto
  document.getElementById('modal-estratto-close')
    ?.addEventListener('click', () => closeModal('modal-estratto'))

  // Chiudi modal conto con X
  document.getElementById('modal-conto-close')
    ?.addEventListener('click', () => closeModal('modal-conto'))

  // Inizializza chiusura cliccando fuori dal modal
  initModalClose()

  // Cambio trimestre o anno → ricalcola IVA
  document.getElementById('sel-trimestre')
    ?.addEventListener('change', renderIVA)

  document.getElementById('sel-anno')
    ?.addEventListener('change', renderIVA)

  // Espone funzioni globali usate dall'HTML inline (onclick="window._iva...")
  window._ivaModificaConto  = apriModalConto
  window._ivaEliminaConto   = eliminaConto
  window._ivaEstrattoConto  = apriEstrattoConto
}

// ════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════

// Escape caratteri HTML per evitare XSS
function esc(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
