// ============================================================
// IVA.JS — Modulo IVA & Conti Correnti
// File: js/modules/iva.js
// Dipendenze: firebase-config.js, utils.js
// ============================================================

import { db, collections, toTimestamp } from '../firebase-config.js'
import { formatEuro, formatDate, toInputDate, toast, openModal, closeModal, initModalClose, confirmDelete,
         righeMovimento, scadenzaRitenute, periodoRitenute, giorniDaOggi, toDate } from '../utils.js'

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

  // Renderizza le tre sezioni
  renderConti()
  renderIVA()
  renderRitenute()

  // Collega tutti gli event listener
  collegaEventi()
}


/**
 * Ricarica tutto da Firestore e ridisegna. Usata dopo ogni scrittura
 * (versamento ritenute, annullamento) per non lavorare su dati stantii.
 */
async function caricaDati() {
  await Promise.all([caricaConti(), caricaMovimenti()])
  renderConti()
  renderIVA()
  renderRitenute()
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

  // Aliquote ricavate dai movimenti del periodo, non da una lista fissa:
  // prima erano hardcoded a [4, 10, 22] e il 5% non compariva mai.
  const aliquote = [...new Set([
    ...Object.keys(ivaDebito.perAliquota),
    ...Object.keys(ivaCredito.perAliquota)
  ].map(Number))].sort((a, b) => a - b)

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

/**
 * Calcola l'IVA raggruppata per aliquota, per tipo di movimento.
 *
 * Lavora sulle VOCI, non sul documento: un movimento può contenere più
 * aliquote (scontrino 22% + 4%), e in quel caso il campo `m.iva_rate` a
 * livello documento vale null. righeMovimento() normalizza sia i documenti
 * nuovi (campo `righe`) sia quelli vecchi (una voce sintetizzata).
 */
function calcolaIVATipo(movimenti, tipo) {
  const filtrati = movimenti.filter(m => m.tipo === tipo)

  const perAliquota = {}
  let totale = 0

  filtrati.forEach(m => {
    righeMovimento(m).forEach(r => {
      const al = Number(r.iva_rate) || 0
      if (al <= 0) return   // 0% / esente: nessuna IVA da liquidare

      const iva = Number(r.iva_importo) || 0
      const imp = Number(r.imponibile)  || 0

      if (!perAliquota[al]) perAliquota[al] = { imponibile: 0, iva: 0 }
      perAliquota[al].imponibile += imp
      perAliquota[al].iva        += iva
      totale += iva
    })
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
  // ── Modal versamento ritenute ──
  document.getElementById('modal-f24-close')?.addEventListener('click', () => closeModal('modal-f24'))
  document.getElementById('modal-f24-annulla')?.addEventListener('click', () => closeModal('modal-f24'))
  document.getElementById('modal-f24-salva')?.addEventListener('click', salvaVersamentoF24)


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


// ════════════════════════════════════════════════════════════
// RITENUTE D'ACCONTO
//
// Una ritenuta nasce quando registri il pagamento di una fattura che la
// prevede: `importo` del movimento è già il netto, e `ritenuta_importo`
// è la parte trattenuta che resta a debito verso lo Stato.
//
// Il versamento è cumulativo: tutte le ritenute dei pagamenti di un mese
// si versano con un unico F24 entro il 16 del mese successivo.
// ════════════════════════════════════════════════════════════

const MESI_IT = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                 'luglio','agosto','settembre','ottobre','novembre','dicembre']

function _nomePeriodo(chiave) {
  const [a, m] = chiave.split('-')
  return `${MESI_IT[Number(m) - 1]} ${a}`
}

/** Raggruppa le ritenute NON versate per mese di pagamento. */
function raggruppaRitenute(movimenti) {
  const gruppi = {}
  movimenti
    .filter(m => Number(m.ritenuta_importo) > 0 && m.ritenuta_versata !== true)
    .forEach(m => {
      const k = periodoRitenute(m.data)
      if (!k) return
      if (!gruppi[k]) gruppi[k] = { periodo: k, righe: [], totale: 0, scadenza: scadenzaRitenute(m.data) }
      gruppi[k].righe.push(m)
      gruppi[k].totale = Math.round((gruppi[k].totale + Number(m.ritenuta_importo)) * 100) / 100
    })
  return Object.values(gruppi).sort((a, b) => a.periodo.localeCompare(b.periodo))
}

/** Gli F24 già registrati, dal più recente. */
function versamentiRegistrati(movimenti) {
  return movimenti
    .filter(m => m.f24_periodo && Array.isArray(m.f24_ritenute_ref))
    .sort((a, b) => (toDate(b.data) || 0) - (toDate(a.data) || 0))
}

function renderRitenute() {
  const gruppi   = raggruppaRitenute(tuttiMovimenti)
  const versati  = versamentiRegistrati(tuttiMovimenti)

  // ── KPI: due sole. Otto card su questa pagina sarebbero troppe ──
  const oggi     = new Date()
  const scadute  = gruppi.filter(g => giorniDaOggi(g.scadenza) < 0)
  const totScad  = Math.round(scadute.reduce((s, g) => s + g.totale, 0) * 100) / 100
  const totTutte = Math.round(gruppi.reduce((s, g) => s + g.totale, 0) * 100) / 100
  const prossima = gruppi.filter(g => giorniDaOggi(g.scadenza) >= 0)[0] || null

  const kpi = document.getElementById('rit-kpi')
  if (kpi) {
    kpi.innerHTML = `
      <div class="kpi-card ${totScad > 0 ? 'red' : (totTutte > 0 ? 'amber' : 'green')}">
        <div class="kpi-label">Da versare</div>
        <div class="kpi-value" style="color:${totScad > 0 ? 'var(--red)' : (totTutte > 0 ? 'var(--amber)' : 'var(--green)')};">${formatEuro(totTutte)}</div>
        <div class="kpi-sub">${
          totScad > 0 ? `${formatEuro(totScad)} già scaduti`
          : totTutte > 0 ? `${gruppi.length} scadenz${gruppi.length === 1 ? 'a' : 'e'} aperte`
          : 'niente in sospeso'
        }</div>
      </div>
      <div class="kpi-card ${prossima ? 'secondary' : 'green'}">
        <div class="kpi-label">Prossima scadenza</div>
        <div class="kpi-value" style="font-size:20px;">${prossima ? formatEuro(prossima.totale) : '—'}</div>
        <div class="kpi-sub">${
          prossima ? `${formatDate(prossima.scadenza)} · tra ${giorniDaOggi(prossima.scadenza)}gg`
                   : 'nessuna scadenza futura'
        }</div>
      </div>`
  }

  // ── Periodi da versare ──
  const box = document.getElementById('rit-periodi')
  if (!box) return

  if (!gruppi.length) {
    box.innerHTML = `<div class="table-wrap"><div class="empty-state" style="min-height:140px;">
      <p style="font-size:12.5px;">Nessuna ritenuta da versare.</p>
      <p style="font-size:11px;margin-top:6px;color:var(--text2);">
        Le ritenute compaiono qui quando registri il pagamento di una fattura che le prevede,
        da Incassi &amp; Pagamenti.
      </p>
    </div></div>`
  } else {
    box.innerHTML = gruppi.map(g => {
      const gg      = giorniDaOggi(g.scadenza)
      const scaduto = gg < 0
      // Si versa dal 1° del mese successivo: prima il mese non è chiuso
      const oraChiuso = _periodoChiuso(g.periodo)

      const badge = scaduto ? `<span class="badge badge-red">Scaduto da ${Math.abs(gg)}gg</span>`
                  : gg <= 5 ? `<span class="badge badge-amber">tra ${gg}gg</span>`
                  : `<span class="badge badge-gray">tra ${gg}gg</span>`

      return `<div class="table-wrap" style="margin-bottom:14px;">
        <div class="table-head f24-head ${scaduto ? 'scaduto' : ''}">
          <div>
            <div class="f24-mese">Ritenute di ${_nomePeriodo(g.periodo)}</div>
            <div class="f24-scad">Da versare entro il <strong>${formatDate(g.scadenza)}</strong></div>
          </div>
          <div style="text-align:right;">
            <div class="f24-tot">${formatEuro(g.totale)}</div>
            ${badge}
          </div>
        </div>
        <table>
          <thead><tr>
            <th>Pagato il</th><th>A chi</th><th class="text-center">Aliquota</th>
            <th class="text-right">Base</th><th class="text-right">Ritenuta</th>
          </tr></thead>
          <tbody>
            ${g.righe.sort((a, b) => (toDate(a.data) || 0) - (toDate(b.data) || 0)).map(m => `
              <tr>
                <td style="font-size:12px;">${formatDate(m.data)}</td>
                <td style="font-weight:600;color:var(--text0);">${_escapeHtml(m.descrizione || '—')}
                  ${m.numero_fattura ? `<div style="font-size:10px;color:var(--text2);font-weight:500;">${_escapeHtml(m.numero_fattura)}</div>` : ''}
                </td>
                <td class="text-center" style="font-size:12px;">${m.ritenuta_aliquota != null ? String(m.ritenuta_aliquota).replace('.', ',') + '%' : 'manuale'}</td>
                <td class="text-right" style="font-size:12px;color:var(--text1);">${m.ritenuta_base ? formatEuro(m.ritenuta_base) : '—'}</td>
                <td class="text-right fw-700">${formatEuro(m.ritenuta_importo)}</td>
              </tr>`).join('')}
            <tr style="background:rgba(15,80,123,0.04);">
              <td colspan="4" class="fw-700" style="font-size:12px;color:var(--text1);">TOTALE DA VERSARE</td>
              <td class="text-right fw-800" style="font-size:16px;color:${scaduto ? 'var(--red)' : 'var(--text0)'};">${formatEuro(g.totale)}</td>
            </tr>
          </tbody>
        </table>
        <div class="f24-azione">
          ${oraChiuso
            ? `<button class="btn btn-primary btn-sm" data-versa="${g.periodo}">Registra le ritenute versate — ${formatEuro(g.totale)}</button>
               <span class="f24-hint">Crea un movimento solo e marca ${g.righe.length} ritenut${g.righe.length === 1 ? 'a' : 'e'} come versate</span>`
            : `<button class="btn btn-secondary btn-sm" disabled>Il mese non è ancora chiuso</button>
               <span class="f24-hint">Si potrà versare dal 1° ${MESI_IT[(Number(g.periodo.split('-')[1]) % 12)]}</span>`
          }
        </div>
      </div>`
    }).join('')
  }

  // ── Versamenti già registrati ──
  const boxV = document.getElementById('rit-versate')
  if (boxV) {
    boxV.innerHTML = !versati.length ? '' : `
      <div class="table-wrap" style="margin-top:18px;">
        <div class="table-head"><div class="cli-sez" style="font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--secondary);">Ritenute già versate</div></div>
        <table>
          <thead><tr><th>Versato il</th><th>Periodo</th><th>Conto</th><th class="text-right">Importo</th><th></th></tr></thead>
          <tbody>
            ${versati.map(f => `<tr>
              <td style="font-size:12px;">${formatDate(f.data)}</td>
              <td style="font-weight:600;color:var(--text0);">${_nomePeriodo(f.f24_periodo)}</td>
              <td style="font-size:11px;color:var(--text1);">${_escapeHtml(f.conto_nome || '—')}</td>
              <td class="text-right fw-700">${formatEuro(f.importo)}</td>
              <td class="text-right"><button class="btn btn-secondary btn-sm" data-annulla="${f.id}">Annulla</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
  }

  _collegaEventiRitenute()
}

// Un periodo si può versare solo a mese chiuso: dal 1° del mese dopo
function _periodoChiuso(periodo) {
  const [a, m] = periodo.split('-').map(Number)
  const primoGiornoDopo = new Date(a, m, 1)   // m è 1-based → questo è il mese dopo
  return new Date() >= primoGiornoDopo
}

function _escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function _collegaEventiRitenute() {
  document.querySelectorAll('[data-versa]').forEach(b =>
    b.addEventListener('click', () => apriModalF24(b.dataset.versa)))
  document.querySelectorAll('[data-annulla]').forEach(b =>
    b.addEventListener('click', () => annullaVersamento(b.dataset.annulla)))
}


// ── Modal versamento ──────────────────────────────────────────
function apriModalF24(periodo) {
  const g = raggruppaRitenute(tuttiMovimenti).find(x => x.periodo === periodo)
  if (!g) return

  document.getElementById('f24-periodo').value = periodo
  document.getElementById('f24-data').value    = new Date().toISOString().split('T')[0]

  const sel = document.getElementById('f24-conto')
  sel.innerHTML = tuttiConti.map(c => `<option value="${c.id}">${_escapeHtml(c.nome)}</option>`).join('')

  document.getElementById('f24-riepilogo').innerHTML = `
    <div class="f24-riep-riga"><span>Periodo</span><span>${_nomePeriodo(periodo)}</span></div>
    <div class="f24-riep-riga"><span>Scadenza</span><span>${formatDate(g.scadenza)}</span></div>
    <div class="f24-riep-riga"><span>Ritenute incluse</span><span>${g.righe.length}</span></div>
    <div class="f24-riep-riga totale"><span>Totale ritenute</span><span>${formatEuro(g.totale)}</span></div>`

  openModal('modal-f24')
}

async function salvaVersamentoF24() {
  const periodo = document.getElementById('f24-periodo').value
  const data    = document.getElementById('f24-data').value
  const contoId = document.getElementById('f24-conto').value

  if (!data)    { toast('Inserisci la data del versamento', 'error'); return }
  if (!contoId) { toast('Seleziona il conto', 'error'); return }

  const g = raggruppaRitenute(tuttiMovimenti).find(x => x.periodo === periodo)
  if (!g || !g.righe.length) { toast('Nessuna ritenuta da versare', 'error'); return }

  const conto = tuttiConti.find(c => c.id === contoId)
  const ts    = firebase.firestore.Timestamp.fromDate(new Date(data + 'T00:00:00'))

  try {
    // 1. Il movimento del versamento
    const movRef = await collections.movimenti().add({
      tipo:        'pagamento',
      importo:     g.totale,
      imponibile:  g.totale,
      iva_rate:    0,
      iva_importo: 0,
      righe: [{
        descrizione: `Ritenute d'acconto ${_nomePeriodo(periodo)}`,
        imponibile:  g.totale, iva_rate: 0, iva_importo: 0, totale: g.totale
      }],
      data:        ts,
      descrizione: `Ritenute d'acconto — ${_nomePeriodo(periodo)}`,
      categoria:   'Tasse',
      conto:       contoId,
      conto_nome:  conto?.nome || null,
      note:        `${g.righe.length} ritenute versate`,
      f24_periodo:      periodo,
      f24_ritenute_ref: g.righe.map(m => m.id),
      ritenuta_importo: null,
      ritenuta_versata: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })

    // 2. Marca le ritenute come versate — in blocco, o tutte o nessuna
    const batch = db.batch()
    g.righe.forEach(m => batch.update(collections.movimenti().doc(m.id), {
      ritenuta_versata: true,
      ritenuta_f24_ref: movRef.id
    }))
    await batch.commit()

    closeModal('modal-f24')
    toast(`✓ ${formatEuro(g.totale)} registrati — ${g.righe.length} ritenute segnate come versate`, 'success', 5000)
    await caricaDati()

  } catch (err) {
    console.error('Errore versamento ritenute:', err)
    toast('Errore durante la registrazione del versamento', 'error')
  }
}

async function annullaVersamento(f24Id) {
  const f24 = tuttiMovimenti.find(m => m.id === f24Id)
  if (!f24) return

  if (!confirmDelete(
    `Annullare il versamento di ${formatEuro(f24.importo)} del ${formatDate(f24.data)}?\n\n` +
    `Il movimento verrà eliminato e le ${f24.f24_ritenute_ref?.length || 0} ritenute torneranno da versare.`
  )) return

  try {
    const batch = db.batch()
    ;(f24.f24_ritenute_ref || []).forEach(id => batch.update(collections.movimenti().doc(id), {
      ritenuta_versata: false,
      ritenuta_f24_ref: null
    }))
    batch.delete(collections.movimenti().doc(f24Id))
    await batch.commit()

    toast('Versamento annullato — le ritenute sono tornate da versare', 'success', 4000)
    await caricaDati()

  } catch (err) {
    console.error('Errore annullamento versamento:', err)
    toast('Errore durante l\'annullamento', 'error')
  }
}
