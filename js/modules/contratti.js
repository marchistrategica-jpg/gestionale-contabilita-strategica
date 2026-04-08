/**
 * ============================================================
 * MODULO: Contratti — Logica JS
 * File:   js/modules/contratti.js
 *
 * Esportato: export async function init()
 * Chiamato da router.js ogni volta che si naviga su #contratti
 *
 * DIPENDENZE:
 *   js/firebase-config.js → db, collections, toTimestamp
 *   js/utils.js           → formatEuro, formatDate, toInputDate,
 *                           toast, openModal, closeModal,
 *                           initModalClose, confirmDelete
 *   css/icons.js          → ICONS (SVG inline)
 * ============================================================
 */

import { collections, toTimestamp }                  from '../../js/firebase-config.js'
import { formatEuro, formatDate, toInputDate,
         toast, openModal, closeModal,
         initModalClose, confirmDelete }              from '../../js/utils.js'
import { ICONS }                                     from '../../css/icons.js'


// ============================================================
// STATO LOCALE DEL MODULO
// Teniamo tutto qui dentro — si azzera ad ogni navigazione
// ============================================================

/** Array di tutti i contratti caricati da Firestore */
let _tuttiContratti = []

/** Filtro stato attivo (stringa: 'tutti' | 'attivo' | 'in_scadenza' | ...) */
let _filtroStato = 'tutti'

/** Testo di ricerca corrente */
let _testoRicerca = ''


// ============================================================
// INIT — punto di ingresso chiamato dal router
// ============================================================
export async function init () {

  // 1. Inietta le icone SVG negli slot HTML
  _iniettaIcone()

  // 2. Collega i listener UI (bottoni, ricerca, chip, modal)
  _collegaEventi()

  // 3. Carica i contratti da Firestore
  await _caricaContratti()
}


// ============================================================
// ICONE — inietta i simboli SVG negli span placeholder
// ============================================================
function _iniettaIcone () {
  // Usa la funzione di utility per non duplicare codice
  const set = (id, icona) => {
    const el = document.getElementById(id)
    if (el) el.innerHTML = icona
  }
  set('ico-plus',          ICONS.plus)
  set('ico-download',      ICONS.download)
  set('ico-search',        ICONS.search)
  set('ico-close-modal',   ICONS.close)
  set('ico-check-modal',   ICONS.check)
  set('ico-contract-empty',ICONS.contract)
}


// ============================================================
// EVENTI — collega tutti i listener UI
// ============================================================
function _collegaEventi () {

  // ── Bottone "Nuovo contratto" ────────────────────────────
  document.getElementById('btn-nuovo')
    ?.addEventListener('click', () => _apriModalNuovo())

  // ── Bottone "Annulla" nel modal ──────────────────────────
  document.getElementById('btn-annulla')
    ?.addEventListener('click', () => _chiudiModal())

  // ── X in alto a destra nel modal ────────────────────────
  document.getElementById('modal-contratto-close')
    ?.addEventListener('click', () => _chiudiModal())

  // ── Click fuori dal modal → chiude ──────────────────────
  document.getElementById('modal-contratto')
    ?.addEventListener('click', e => {
      if (e.target.id === 'modal-contratto') _chiudiModal()
    })

  // ── Bottone "Salva" nel modal ────────────────────────────
  document.getElementById('btn-salva')
    ?.addEventListener('click', () => _salvaContratto())

  // ── Ricerca real-time (si aggiorna ad ogni carattere) ────
  document.getElementById('input-ricerca')
    ?.addEventListener('input', e => {
      _testoRicerca = e.target.value.toLowerCase().trim()
      _renderTabella()
    })

  // ── Chip filtro stato ────────────────────────────────────
  document.getElementById('filtri-stato')
    ?.querySelectorAll('.chip-stato')
    .forEach(chip => {
      chip.addEventListener('click', () => {
        // Rimuovi .active da tutti, aggiungilo solo al cliccato
        document.querySelectorAll('.chip-stato')
          .forEach(c => c.classList.remove('active'))
        chip.classList.add('active')
        _filtroStato = chip.dataset.stato
        _renderTabella()
      })
    })
}


// ============================================================
// FIRESTORE — carica lista contratti
// ============================================================
async function _caricaContratti () {

  const elLoading   = document.getElementById('contratti-loading')
  const elTableWrap = document.getElementById('contratti-table-wrap')
  const elEmpty     = document.getElementById('contratti-empty')

  // Mostra spinner, nasconde il resto
  if (elLoading)   elLoading.style.display   = 'flex'
  if (elTableWrap) elTableWrap.style.display = 'none'
  if (elEmpty)     elEmpty.style.display     = 'none'

  try {
    // Ordina per data_fine crescente: i contratti più vicini
    // alla scadenza appaiono in cima alla tabella
    const snap = await collections.contratti()
      .orderBy('data_fine', 'asc')
      .get()

    _tuttiContratti = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    // Nasconde il loading e renderizza
    if (elLoading) elLoading.style.display = 'none'
    _renderTabella()

  } catch (err) {
    console.error('Contratti: errore Firebase →', err)
    if (elLoading) elLoading.style.display = 'none'
    toast('Errore nel caricamento dei contratti. Controlla Firebase.', 'error')

    // Mostra stato vuoto con messaggio d'errore
    if (elEmpty) {
      elEmpty.style.display = 'flex'
      const p = elEmpty.querySelector('p')
      if (p) p.textContent = 'Errore nel caricamento. Riprova.'
    }
  }
}


// ============================================================
// RENDER — filtra e disegna la tabella
// ============================================================
function _renderTabella () {

  const elTableWrap = document.getElementById('contratti-table-wrap')
  const elEmpty     = document.getElementById('contratti-empty')
  const tbody       = document.getElementById('tb-contratti')
  const elCount     = document.getElementById('contratti-count')

  // Aggiorna il contatore totale (sempre il numero reale, non filtrato)
  if (elCount) elCount.textContent = _tuttiContratti.length

  // ── Applica filtri ───────────────────────────────────────
  const oggi = new Date(); oggi.setHours(0,0,0,0)
  const tra30 = new Date(oggi); tra30.setDate(tra30.getDate() + 30)

  const filtrati = _tuttiContratti.filter(c => {

    // Filtro per testo di ricerca (cliente o numero)
    if (_testoRicerca) {
      const cliente = (c.cliente || '').toLowerCase()
      const numero  = (c.numero  || '').toLowerCase()
      if (!cliente.includes(_testoRicerca) && !numero.includes(_testoRicerca)) {
        return false
      }
    }

    // Filtro per stato chip
    if (_filtroStato === 'tutti') return true

    if (_filtroStato === 'in_scadenza') {
      // "In scadenza" = data_fine tra oggi e tra 30 giorni, non concluso
      const df = _toDate(c.data_fine)
      return df && df >= oggi && df <= tra30 && c.stato !== 'concluso'
    }

    return c.stato === _filtroStato
  })

  // ── Nessun risultato ────────────────────────────────────
  if (!filtrati.length) {
    if (elTableWrap) elTableWrap.style.display = 'none'
    if (elEmpty)     elEmpty.style.display     = 'flex'

    // Messaggio personalizzato in base al filtro attivo
    const p = elEmpty?.querySelector('p')
    if (p) {
      p.textContent = _testoRicerca
        ? `Nessun contratto trovato per "${_testoRicerca}".`
        : 'Nessun contratto in questa categoria.'
    }
    return
  }

  // ── Costruisce le righe HTML ─────────────────────────────
  if (elEmpty)     elEmpty.style.display     = 'none'
  if (elTableWrap) elTableWrap.style.display = 'block'

  const righe = filtrati.map(c => {

    const df      = _toDate(c.data_fine)
    const di      = _toDate(c.data_inizio)

    // Controlla se in scadenza entro 30 giorni
    const inScadenza = df && df >= oggi && df <= tra30 && c.stato !== 'concluso'
    const rowClass   = inScadenza ? 'row-in-scadenza' : ''

    // Giorni rimasti (solo se in scadenza)
    let giorniLabel = ''
    if (inScadenza && df) {
      const giorni = Math.ceil((df - oggi) / 86400000)
      giorniLabel = giorni === 0 ? '<span class="giorni-rimasti">⚠ Scade oggi!</span>'
                  : giorni === 1 ? '<span class="giorni-rimasti">⚠ Scade domani!</span>'
                  : `<span class="giorni-rimasti">⚠ Tra ${giorni} giorni</span>`
    }

    return `<tr class="${rowClass}" data-id="${c.id}">
      <td><strong style="color:var(--text0);">${_esc(c.numero || '—')}</strong></td>
      <td>${_esc(c.cliente || '—')}</td>
      <td>${di ? formatDate(di) : '—'}</td>
      <td>
        ${df ? formatDate(df) : '—'}
        ${giorniLabel}
      </td>
      <td class="text-right" style="color:var(--text0);font-weight:700;">
        ${formatEuro(c.valore || 0)}
      </td>
      <td>${_badgeStato(c.stato)}</td>
      <td>
        <div class="azioni-cell">
          <button class="btn btn-secondary btn-sm btn-modifica" data-id="${c.id}" title="Modifica">
            ${ICONS.edit} Modifica
          </button>
          <button class="btn btn-danger btn-sm btn-elimina" data-id="${c.id}" title="Elimina">
            ${ICONS.trash}
          </button>
        </div>
      </td>
    </tr>`
  }).join('')

  if (tbody) {
    tbody.innerHTML = righe

    // ── Attacca i listener ai bottoni delle righe ────────
    // Modifica
    tbody.querySelectorAll('.btn-modifica').forEach(btn => {
      btn.addEventListener('click', () => {
        const contratto = _tuttiContratti.find(c => c.id === btn.dataset.id)
        if (contratto) _apriModalModifica(contratto)
      })
    })

    // Elimina
    tbody.querySelectorAll('.btn-elimina').forEach(btn => {
      btn.addEventListener('click', () => _eliminaContratto(btn.dataset.id))
    })
  }
}


// ============================================================
// MODAL — Apri per NUOVO contratto
// ============================================================
function _apriModalNuovo () {
  // Pulisce il form e imposta il titolo
  _resetForm()
  const elTitolo = document.getElementById('modal-contratto-title')
  if (elTitolo) elTitolo.textContent = 'Nuovo contratto'

  // Imposta lo stato di default su "attivo"
  const elStato = document.getElementById('f-stato')
  if (elStato) elStato.value = 'attivo'

  // Apre il modal con animazione
  const overlay = document.getElementById('modal-contratto')
  if (overlay) overlay.classList.add('open')

  // Focus sul primo campo
  setTimeout(() => document.getElementById('f-numero')?.focus(), 150)
}


// ============================================================
// MODAL — Apri per MODIFICA contratto esistente
// ============================================================
function _apriModalModifica (c) {
  _resetForm()

  // Aggiorna titolo modal
  const elTitolo = document.getElementById('modal-contratto-title')
  if (elTitolo) elTitolo.textContent = `Modifica contratto ${c.numero || ''}`

  // Popola tutti i campi del form con i dati del contratto
  _setVal('f-id',          c.id)
  _setVal('f-numero',      c.numero    || '')
  _setVal('f-cliente',     c.cliente   || '')
  _setVal('f-data-inizio', toInputDate(_toDate(c.data_inizio)))
  _setVal('f-data-fine',   toInputDate(_toDate(c.data_fine)))
  _setVal('f-valore',      c.valore != null ? c.valore : '')
  _setVal('f-stato',       c.stato     || 'attivo')
  _setVal('f-note',        c.note      || '')

  // Apre il modal
  const overlay = document.getElementById('modal-contratto')
  if (overlay) overlay.classList.add('open')
}


// ============================================================
// MODAL — Chiudi e pulisci
// ============================================================
function _chiudiModal () {
  const overlay = document.getElementById('modal-contratto')
  if (overlay) overlay.classList.remove('open')
  _resetForm()
}

function _resetForm () {
  const form = document.getElementById('form-contratto')
  if (form) form.reset()
  // Svuota anche l'id nascosto
  const elId = document.getElementById('f-id')
  if (elId) elId.value = ''
}


// ============================================================
// FIRESTORE — Salva (aggiunge o aggiorna) un contratto
// ============================================================
async function _salvaContratto () {

  // ── Legge i valori dal form ──────────────────────────────
  const id          = _getVal('f-id')         // vuoto = nuovo contratto
  const numero      = _getVal('f-numero').trim()
  const cliente     = _getVal('f-cliente').trim()
  const dataInizio  = _getVal('f-data-inizio')
  const dataFine    = _getVal('f-data-fine')
  const valore      = parseFloat(_getVal('f-valore')) || 0
  const stato       = _getVal('f-stato')
  const note        = _getVal('f-note').trim()

  // ── Validazione base ─────────────────────────────────────
  if (!numero)     { toast('Inserisci il numero contratto.',  'error'); return }
  if (!cliente)    { toast('Inserisci il nome del cliente.',  'error'); return }
  if (!dataInizio) { toast('Inserisci la data di inizio.',    'error'); return }
  if (!dataFine)   { toast('Inserisci la data di fine.',      'error'); return }
  if (dataFine < dataInizio) {
    toast('La data di fine non può essere prima della data di inizio.', 'error')
    return
  }

  // ── Costruisce il documento da salvare ───────────────────
  const dati = {
    numero,
    cliente,
    data_inizio: toTimestamp(dataInizio),
    data_fine:   toTimestamp(dataFine),
    valore,
    stato,
    note,
  }

  // Disabilita il bottone Salva durante il salvataggio
  const btnSalva = document.getElementById('btn-salva')
  if (btnSalva) { btnSalva.disabled = true; btnSalva.textContent = 'Salvataggio...' }

  try {
    if (id) {
      // ── AGGIORNA contratto esistente ─────────────────────
      await collections.contratti().doc(id).update(dati)
      toast(`Contratto ${numero} aggiornato ✓`, 'success')
    } else {
      // ── AGGIUNGE nuovo contratto ─────────────────────────
      dati.createdAt = firebase.firestore.FieldValue.serverTimestamp()
      await collections.contratti().add(dati)
      toast(`Contratto ${numero} creato ✓`, 'success')
    }

    // Chiude modal e ricarica lista
    _chiudiModal()
    await _caricaContratti()

  } catch (err) {
    console.error('Contratti: errore salvataggio →', err)
    toast('Errore nel salvataggio. Riprova.', 'error')
  } finally {
    // Riabilita il bottone Salva in ogni caso
    if (btnSalva) {
      btnSalva.disabled = false
      btnSalva.innerHTML = `${ICONS.check} Salva contratto`
    }
  }
}


// ============================================================
// FIRESTORE — Elimina un contratto
// ============================================================
async function _eliminaContratto (id) {

  // Trova il contratto per mostrare il nome nel dialogo
  const c = _tuttiContratti.find(x => x.id === id)
  const label = c ? `il contratto ${c.numero} — ${c.cliente}` : 'questo contratto'

  // Chiede conferma prima di eliminare (utility da utils.js)
  const confermato = await confirmDelete(
    `Sei sicuro di voler eliminare ${label}? Questa azione è irreversibile.`
  )
  if (!confermato) return

  try {
    await collections.contratti().doc(id).delete()
    toast('Contratto eliminato.', 'success')

    // Rimuove dalla lista locale e ri-renderizza senza fare un'altra chiamata Firebase
    _tuttiContratti = _tuttiContratti.filter(x => x.id !== id)
    _renderTabella()

  } catch (err) {
    console.error('Contratti: errore eliminazione →', err)
    toast('Errore durante l\'eliminazione. Riprova.', 'error')
  }
}


// ============================================================
// UTILITY PRIVATE
// ============================================================

/**
 * Converte un valore data Firestore (Timestamp | Date | string) in Date JS.
 * Gestisce tutti e tre i formati possibili.
 */
function _toDate (val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()  // Firestore Timestamp
  const d = new Date(val)
  return isNaN(d) ? null : d
}

/**
 * Restituisce il badge HTML colorato per ogni stato contratto.
 * Colori coerenti con il design system di base.css.
 */
function _badgeStato (stato) {
  const mappa = {
    attivo:   ['badge-green',  'Attivo'],
    scaduto:  ['badge-red',    'Scaduto'],
    sospeso:  ['badge-amber',  'Sospeso'],
    concluso: ['badge-gray',   'Concluso'],
  }
  const [cls, label] = mappa[stato] || ['badge-gray', stato || '—']
  return `<span class="badge ${cls}">${label}</span>`
}

/** Escape HTML — previene attacchi XSS */
function _esc (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Legge il valore di un campo del form */
function _getVal (id) {
  return document.getElementById(id)?.value || ''
}

/** Imposta il valore di un campo del form */
function _setVal (id, val) {
  const el = document.getElementById(id)
  if (el) el.value = val ?? ''
}
