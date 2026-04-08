// ============================================================
// MODULO: Incassi & Pagamenti
// js/modules/incassi.js
//
// Questo file viene caricato dinamicamente da router.js
// quando l'utente naviga a #incassi.
// Esporta una funzione init() che router.js chiama.
// ============================================================

import { db, collections, toTimestamp } from '../../js/firebase-config.js'
import {
  formatEuro, formatDate, toInputDate,
  toast, openModal, closeModal, initModalClose,
  confirmDelete, debounce
} from '../../js/utils.js'

// ── Stato locale del modulo ───────────────────────────────
// Qui teniamo in memoria i dati già caricati da Firestore,
// così i filtri lato client non fanno nuove richieste al DB.

let tuttiMovimenti = []     // tutti i movimenti del mese selezionato
let movimentiFiltrati = []  // dopo ricerca testo + chip tipo

let filtroTipo  = 'tutti'   // 'tutti' | 'incasso' | 'pagamento'
let cercaTesto  = ''        // testo libero nella barra di ricerca
let meseAttivo  = 0         // 1-12 (impostato all'init)
let annoAttivo  = 0         // es. 2025


// ── Entry point ───────────────────────────────────────────

export async function init() {

  // 1. Imposta mese e anno corrente come valori di default
  const oggi = new Date()
  meseAttivo = oggi.getMonth() + 1   // getMonth() restituisce 0-11
  annoAttivo = oggi.getFullYear()

  // 2. Popola la select degli anni (5 anni indietro + anno corrente)
  _popolaAnni()

  // 3. Imposta i valori dei selettori mese/anno sul corrente
  document.getElementById('filtro-mese').value = meseAttivo
  document.getElementById('filtro-anno').value = annoAttivo

  // 4. Carica i movimenti del mese corrente da Firestore
  await _caricaMovimenti()

  // 5. Aggancia tutti gli event listener
  _initListeners()

  // 6. Carica lista contratti per la select nel modal
  await _caricaContratti()
}


// ── Caricamento dati da Firestore ─────────────────────────

async function _caricaMovimenti() {
  try {
    // Calcola il range di date: primo e ultimo giorno del mese selezionato
    const inizio = new Date(annoAttivo, meseAttivo - 1, 1)      // es. 1 aprile 2025
    const fine   = new Date(annoAttivo, meseAttivo, 0, 23, 59, 59) // es. 30 aprile 2025

    // Query Firestore: movimenti nel range di date, ordinati per data decrescente
    const snapshot = await collections.movimenti()
      .where('data', '>=', toTimestamp(inizio.toISOString()))
      .where('data', '<=', toTimestamp(fine.toISOString()))
      .orderBy('data', 'desc')
      .get()

    // Converte i documenti Firestore in oggetti JS semplici
    tuttiMovimenti = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))

    // Applica i filtri attivi e ridisegna tutto
    _applicaFiltri()

  } catch (err) {
    console.error('Errore caricamento movimenti:', err)
    toast('Errore nel caricamento dei movimenti', 'error')
    document.getElementById('tabella-wrap').innerHTML = `
      <div class="empty-state">
        <p>Impossibile caricare i dati.</p>
      </div>
    `
  }
}

// Carica i contratti da Firestore per popolare la select nel modal
async function _caricaContratti() {
  try {
    const snapshot = await collections.contratti()
      .orderBy('cliente')
      .get()

    const select = document.getElementById('mov-contratto-ref')
    if (!select) return

    // Aggiungi un'opzione per ogni contratto
    snapshot.docs.forEach(doc => {
      const d = doc.data()
      const opt = document.createElement('option')
      opt.value = doc.id
      opt.textContent = `${d.numero ? d.numero + ' — ' : ''}${d.cliente}`
      select.appendChild(opt)
    })

  } catch (err) {
    // I contratti sono facoltativi — non bloccare se fallisce
    console.warn('Impossibile caricare contratti:', err)
  }
}


// ── Filtri lato client ────────────────────────────────────

function _applicaFiltri() {
  // Partiamo da tutti i movimenti del mese
  movimentiFiltrati = tuttiMovimenti.filter(mov => {

    // Filtro tipo (Tutti / Incassi / Pagamenti)
    if (filtroTipo !== 'tutti' && mov.tipo !== filtroTipo) return false

    // Filtro testo: cerca in descrizione, categoria, conto
    if (cercaTesto) {
      const q = cercaTesto.toLowerCase()
      const haystack = [
        mov.descrizione || '',
        mov.categoria   || '',
        mov.conto       || '',
        mov.note        || ''
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }

    return true
  })

  // Ridisegna tabella e KPI con i dati filtrati
  _renderTabella()
  _aggiornaKPI()
}


// ── Rendering tabella ─────────────────────────────────────

function _renderTabella() {
  const wrap = document.getElementById('tabella-wrap')
  if (!wrap) return

  // Stato vuoto
  if (movimentiFiltrati.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2"/>
          <line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
        <p>Nessun movimento trovato per questo periodo.</p>
      </div>
    `
    return
  }

  // Calcola totali per la riga in fondo
  let totIncassi   = 0
  let totPagamenti = 0

  movimentiFiltrati.forEach(m => {
    if (m.tipo === 'incasso')   totIncassi   += (m.importo || 0)
    if (m.tipo === 'pagamento') totPagamenti += (m.importo || 0)
  })

  // Costruisci le righe HTML
  const righe = movimentiFiltrati.map(m => {
    // Verde per incassi, rosso per pagamenti
    const coloreImporto = m.tipo === 'incasso' ? 'text-green fw-700' : 'text-red fw-700'
    const segno         = m.tipo === 'incasso' ? '+' : '-'

    // Badge categoria
    const badgeCategoria = `<span class="badge badge-blue">${m.categoria || '—'}</span>`

    // IVA — mostra solo se presente e > 0
    const ivaLabel = m.iva_rate ? `${m.iva_rate}%` : '—'

    return `
      <tr data-id="${m.id}">
        <td class="font-mono">${formatDate(m.data)}</td>
        <td style="max-width:260px;">
          <div style="font-weight:600;color:var(--text0);">${m.descrizione || '—'}</div>
          ${m.note ? `<div style="font-size:11px;color:var(--text2);margin-top:2px;">${m.note}</div>` : ''}
        </td>
        <td>${badgeCategoria}</td>
        <td style="font-size:12px;">${m.conto || '—'}</td>
        <td class="text-center" style="font-size:12px;">${ivaLabel}</td>
        <td class="text-right ${coloreImporto}">${segno} ${formatEuro(m.importo)}</td>
        <td class="text-right" style="white-space:nowrap;">
          <button class="btn btn-icon btn-sm btn-modifica" data-id="${m.id}" title="Modifica">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-sm btn-elimina" data-id="${m.id}" title="Elimina" style="margin-left:4px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </td>
      </tr>
    `
  }).join('')

  // Riga totali in fondo
  const rigaTotali = `
    <tr style="background:rgba(15,80,123,0.04);font-weight:700;">
      <td colspan="5" style="padding:12px 16px;font-size:12px;color:var(--text1);">
        TOTALI — ${movimentiFiltrati.length} moviment${movimentiFiltrati.length === 1 ? 'o' : 'i'}
      </td>
      <td class="text-right" style="padding:12px 16px;">
        <div class="text-green fw-700">+ ${formatEuro(totIncassi)}</div>
        <div class="text-red fw-700" style="margin-top:2px;">- ${formatEuro(totPagamenti)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px;border-top:1px solid var(--border);padding-top:4px;">
          Saldo: <span class="${totIncassi - totPagamenti >= 0 ? 'text-green' : 'text-red'} fw-700">${formatEuro(totIncassi - totPagamenti)}</span>
        </div>
      </td>
      <td></td>
    </tr>
  `

  // Costruisce l'HTML completo della tabella
  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Descrizione</th>
          <th>Categoria</th>
          <th>Conto</th>
          <th class="text-center">IVA</th>
          <th class="text-right">Importo</th>
          <th class="text-right">Azioni</th>
        </tr>
      </thead>
      <tbody>
        ${righe}
        ${rigaTotali}
      </tbody>
    </table>
  `

  // Aggancia eventi modifica ed elimina alle righe appena create
  _agganciaAzioniTabella()
}


// ── Calcolo e aggiornamento KPI ───────────────────────────

async function _aggiornaKPI() {
  // KPI 1, 2, 3 — calcolati sui movimenti del mese già filtrati per mese
  // (usiamo tuttiMovimenti per avere il totale mensile indipendente da ricerca/chip)
  let incassiMese   = 0
  let pagamentiMese = 0
  let nMovIncassi   = 0
  let nMovPagamenti = 0

  tuttiMovimenti.forEach(m => {
    if (m.tipo === 'incasso') {
      incassiMese += (m.importo || 0)
      nMovIncassi++
    } else {
      pagamentiMese += (m.importo || 0)
      nMovPagamenti++
    }
  })

  // KPI 4 — incassi dell'anno corrente (YTD = Year To Date)
  // NOTA: NON usiamo .where('tipo') + .where('data') insieme perché Firestore
  // richiederebbe un indice composto. Carichiamo per sola data e filtriamo in JS.
  let incassiYTD = 0
  try {
    const inizioAnno = new Date(annoAttivo, 0, 1)
    const fineAnno   = new Date(annoAttivo, 11, 31, 23, 59, 59)

    const snapYTD = await collections.movimenti()
      .where('data', '>=', toTimestamp(inizioAnno.toISOString()))
      .where('data', '<=', toTimestamp(fineAnno.toISOString()))
      .get()

    // Filtriamo lato client: contiamo solo gli incassi
    snapYTD.docs.forEach(doc => {
      const d = doc.data()
      if (d.tipo === 'incasso') incassiYTD += (d.importo || 0)
    })
  } catch (e) {
    console.warn('Impossibile calcolare YTD:', e)
  }

  // Aggiorna il DOM con i valori calcolati
  const el = id => document.getElementById(id)

  el('kpi-incassi-mese').textContent     = formatEuro(incassiMese)
  el('kpi-incassi-mese-sub').textContent = `${nMovIncassi} movimento${nMovIncassi !== 1 ? 'i' : ''}`

  el('kpi-pagamenti-mese').textContent     = formatEuro(pagamentiMese)
  el('kpi-pagamenti-mese-sub').textContent = `${nMovPagamenti} movimento${nMovPagamenti !== 1 ? 'i' : ''}`

  const saldo = incassiMese - pagamentiMese
  const kpiSaldo = el('kpi-saldo-netto')
  kpiSaldo.textContent = formatEuro(saldo)
  kpiSaldo.style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)'

  el('kpi-incassi-ytd').textContent     = formatEuro(incassiYTD)
  el('kpi-incassi-ytd-sub').textContent = `anno ${annoAttivo}`
}


// ── Event listener ────────────────────────────────────────

function _initListeners() {

  // Barra di ricerca (con debounce per non filtrare ad ogni tasto)
  const inputCerca = document.getElementById('cerca-input')
  if (inputCerca) {
    inputCerca.addEventListener('input', debounce(e => {
      cercaTesto = e.target.value.trim()
      _applicaFiltri()
    }, 250))
  }

  // Chip tipo (Tutti / Incassi / Pagamenti)
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      filtroTipo = btn.dataset.tipo
      _applicaFiltri()
    })
  })

  // Cambio mese
  document.getElementById('filtro-mese').addEventListener('change', async e => {
    meseAttivo = parseInt(e.target.value)
    await _caricaMovimenti()
  })

  // Cambio anno
  document.getElementById('filtro-anno').addEventListener('change', async e => {
    annoAttivo = parseInt(e.target.value)
    await _caricaMovimenti()
  })

  // Bottone "Nuovo movimento"
  document.getElementById('btn-nuovo').addEventListener('click', () => {
    _apriModalNuovo()
  })

  // Bottone "Esporta CSV"
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    _esportaCSV()
  })

  // Toggle tipo nel modal (Incasso / Pagamento)
  document.querySelectorAll('.tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById('mov-tipo').value = btn.dataset.val
    })
  })

  // Calcolo automatico IVA quando cambia importo o aliquota
  const calcIVA = () => {
    const importo  = parseFloat(document.getElementById('mov-importo').value) || 0
    const aliquota = parseFloat(document.getElementById('mov-iva-rate').value) || 0
    const ivaImporto = importo * (aliquota / 100)
    document.getElementById('mov-iva-display').textContent = formatEuro(ivaImporto)
  }

  document.getElementById('mov-importo').addEventListener('input', calcIVA)
  document.getElementById('mov-iva-rate').addEventListener('change', calcIVA)

  // Bottone "Salva" nel modal
  document.getElementById('btn-salva').addEventListener('click', _salvaMovimento)

  // Bottone "Annulla" e X nel modal
  document.getElementById('btn-annulla').addEventListener('click', () => closeModal('modal-movimento'))
  document.getElementById('modal-close-btn').addEventListener('click', () => closeModal('modal-movimento'))

  // Chiude il modal cliccando fuori
  document.getElementById('modal-movimento').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-movimento')) closeModal('modal-movimento')
  })
}

// Aggancia eventi modifica ed elimina ai bottoni della tabella
// (chiamata ogni volta che la tabella viene ridisegnata)
function _agganciaAzioniTabella() {

  // Bottoni modifica
  document.querySelectorAll('.btn-modifica').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const movimento = tuttiMovimenti.find(m => m.id === id)
      if (movimento) _apriModalModifica(movimento)
    })
  })

  // Bottoni elimina
  document.querySelectorAll('.btn-elimina').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id
      if (confirmDelete('Sei sicuro di voler eliminare questo movimento?')) {
        await _eliminaMovimento(id)
      }
    })
  })
}


// ── Operazioni CRUD su Firestore ──────────────────────────

async function _salvaMovimento() {
  // Raccoglie i dati dal form
  const id          = document.getElementById('mov-id').value
  const tipo        = document.getElementById('mov-tipo').value
  const data        = document.getElementById('mov-data').value
  const descrizione = document.getElementById('mov-descrizione').value.trim()
  const categoria   = document.getElementById('mov-categoria').value
  const importo     = parseFloat(document.getElementById('mov-importo').value) || 0
  const ivaRate     = parseFloat(document.getElementById('mov-iva-rate').value) || 0
  const conto       = document.getElementById('mov-conto').value.trim()
  const contrattoRef= document.getElementById('mov-contratto-ref').value
  const note        = document.getElementById('mov-note').value.trim()

  // Validazione campi obbligatori
  if (!data)        { toast('Inserisci la data', 'error'); return }
  if (!descrizione) { toast('Inserisci la descrizione', 'error'); return }
  if (!categoria)   { toast('Seleziona la categoria', 'error'); return }
  if (!importo || importo <= 0) { toast("Inserisci un importo valido", 'error'); return }

  // Calcola importo IVA
  const ivaImporto = importo * (ivaRate / 100)

  // Prepara il documento da salvare
  const dati = {
    tipo,
    importo,
    data:          toTimestamp(data),
    descrizione,
    categoria,
    conto:         conto || null,
    iva_rate:      ivaRate,
    iva_importo:   ivaImporto,
    contratto_ref: contrattoRef || null,
    note:          note || null
  }

  try {
    if (id) {
      // Modifica documento esistente
      await collections.movimenti().doc(id).update(dati)
      toast('Movimento aggiornato con successo')
    } else {
      // Crea nuovo documento
      dati.createdAt = firebase.firestore.FieldValue.serverTimestamp()
      await collections.movimenti().add(dati)
      toast('Movimento aggiunto con successo')
    }

    // Chiude modal e ricarica i dati
    closeModal('modal-movimento')
    await _caricaMovimenti()

  } catch (err) {
    console.error('Errore salvataggio:', err)
    toast('Errore durante il salvataggio', 'error')
  }
}

async function _eliminaMovimento(id) {
  try {
    await collections.movimenti().doc(id).delete()
    toast('Movimento eliminato')
    await _caricaMovimenti()
  } catch (err) {
    console.error('Errore eliminazione:', err)
    toast('Errore durante l\'eliminazione', 'error')
  }
}


// ── Apertura modal ────────────────────────────────────────

function _apriModalNuovo() {
  // Imposta titolo modal
  document.getElementById('modal-titolo').textContent = 'Nuovo movimento'

  // Reset form
  document.getElementById('mov-id').value         = ''
  document.getElementById('mov-data').value        = new Date().toISOString().split('T')[0]
  document.getElementById('mov-descrizione').value = ''
  document.getElementById('mov-categoria').value   = ''
  document.getElementById('mov-importo').value     = ''
  document.getElementById('mov-iva-rate').value    = '22'
  document.getElementById('mov-iva-display').textContent = formatEuro(0)
  document.getElementById('mov-conto').value       = ''
  document.getElementById('mov-contratto-ref').value = ''
  document.getElementById('mov-note').value        = ''

  // Tipo di default: incasso
  _impostaTipoModal('incasso')

  openModal('modal-movimento')
}

function _apriModalModifica(mov) {
  // Imposta titolo modal
  document.getElementById('modal-titolo').textContent = 'Modifica movimento'

  // Popola il form con i dati del movimento
  document.getElementById('mov-id').value          = mov.id
  document.getElementById('mov-data').value         = toInputDate(mov.data)
  document.getElementById('mov-descrizione').value  = mov.descrizione || ''
  document.getElementById('mov-categoria').value    = mov.categoria   || ''
  document.getElementById('mov-importo').value      = mov.importo     || ''
  document.getElementById('mov-iva-rate').value     = mov.iva_rate    || 0
  document.getElementById('mov-iva-display').textContent = formatEuro(mov.iva_importo || 0)
  document.getElementById('mov-conto').value        = mov.conto       || ''
  document.getElementById('mov-contratto-ref').value= mov.contratto_ref || ''
  document.getElementById('mov-note').value         = mov.note        || ''

  // Imposta tipo (incasso o pagamento)
  _impostaTipoModal(mov.tipo)

  openModal('modal-movimento')
}

// Seleziona visivamente il bottone tipo nel modal
function _impostaTipoModal(tipo) {
  document.getElementById('mov-tipo').value = tipo
  document.querySelectorAll('.tipo-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === tipo)
  })
}


// ── Esportazione CSV ──────────────────────────────────────

function _esportaCSV() {
  if (movimentiFiltrati.length === 0) {
    toast('Nessun dato da esportare', 'info')
    return
  }

  // Intestazione CSV
  const intestazione = ['Data', 'Tipo', 'Descrizione', 'Categoria', 'Conto', 'IVA %', 'Importo netto', 'IVA importo', 'Note']

  // Righe dati
  const righe = movimentiFiltrati.map(m => [
    formatDate(m.data),
    m.tipo || '',
    `"${(m.descrizione || '').replace(/"/g, '""')}"`,
    m.categoria  || '',
    m.conto      || '',
    m.iva_rate   || 0,
    (m.importo   || 0).toFixed(2).replace('.', ','),
    (m.iva_importo || 0).toFixed(2).replace('.', ','),
    `"${(m.note || '').replace(/"/g, '""')}"`
  ])

  // Unisce tutto in una stringa CSV
  const csv = [intestazione, ...righe]
    .map(r => r.join(';'))
    .join('\n')

  // Aggiunge BOM UTF-8 per compatibilità Excel
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })

  // Crea link di download e simula il click
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)

  const nomeMesi = ['','gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
  link.download = `movimenti_${nomeMesi[meseAttivo]}_${annoAttivo}.csv`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  toast(`CSV esportato: ${movimentiFiltrati.length} movimenti`)
}


// ── Utility ───────────────────────────────────────────────

// Popola la select degli anni (5 anni passati + anno corrente)
function _popolaAnni() {
  const select = document.getElementById('filtro-anno')
  if (!select) return

  const annoCorrente = new Date().getFullYear()
  select.innerHTML = ''

  for (let a = annoCorrente; a >= annoCorrente - 4; a--) {
    const opt = document.createElement('option')
    opt.value = a
    opt.textContent = a
    select.appendChild(opt)
  }
}
