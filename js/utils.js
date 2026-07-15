// ============================================================
// UTILS.JS — Funzioni di utilità condivise
// Importa da qui in ogni modulo: import { fmt, toast } from '../js/utils.js'
// ============================================================

// ---- Formattazione valuta ----

export function formatEuro(n) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(n)
}

// ---- Formattazione data ----

export function formatDate(d) {
  if (!d) return '—'
  const date = d?.toDate ? d.toDate() : new Date(d)
  if (isNaN(date)) return '—'
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date)
}

export function formatDateShort(d) {
  if (!d) return '—'
  const date = d?.toDate ? d.toDate() : new Date(d)
  if (isNaN(date)) return '—'
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(date)
}

// Data per input type="date" (yyyy-mm-dd)
export function toInputDate(d) {
  if (!d) return ''
  const date = d?.toDate ? d.toDate() : new Date(d)
  if (isNaN(date)) return ''
  return date.toISOString().split('T')[0]
}

// ---- Formattazione numeri ----

export function formatNum(n, decimals = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)
}

export function formatPercent(n) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return `${Number(n).toFixed(1)}%`
}

// ---- Toast notifiche ----

let toastContainer = null

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container')
    if (!toastContainer) {
      toastContainer = document.createElement('div')
      toastContainer.id = 'toast-container'
      toastContainer.className = 'toast-container'
      document.body.appendChild(toastContainer)
    }
  }
  return toastContainer
}

export function toast(msg, type = 'success', duration = 3000) {
  const container = getToastContainer()
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  container.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(20px)'
    el.style.transition = 'all .2s'
    setTimeout(() => el.remove(), 200)
  }, duration)
}

// ---- Modal ----

export function openModal(id) {
  const el = document.getElementById(id)
  if (el) el.classList.add('open')
}

export function closeModal(id) {
  const el = document.getElementById(id)
  if (el) el.classList.remove('open')
}

// Chiude modal cliccando fuori
export function initModalClose() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open')
    })
  })
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open')
    })
  })
}

// ---- Conferma eliminazione ----

export function confirmDelete(msg = 'Sei sicuro di voler eliminare questo elemento?') {
  return window.confirm(msg)
}

// ---- Genera ID unico ----

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// ---- Capitalizza prima lettera ----

export function capitalize(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// ---- Badge stato ----

export function stateBadge(stato, mappa) {
  // mappa: { 'attivo': ['badge-green', 'Attivo'], 'scaduto': ['badge-red', 'Scaduto'] }
  const def = mappa[stato] || ['badge-gray', stato || '—']
  return `<span class="badge ${def[0]}">${def[1]}</span>`
}

// ---- Data corrente formattata (per topbar) ----

export function todayFormatted() {
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date())
}

// ---- Movimenti: voci multi-aliquota ----

// Arrotonda a 2 decimali. Serve perché in JS 0.1+0.2 = 0.30000000000000004:
// sommando molte voci gli scarti si accumulano e i totali non tornano.
export function eur(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
}

/**
 * Normalizza QUALSIASI movimento in un array di voci.
 *
 * Dal luglio 2026 un movimento può contenere più voci con aliquote IVA
 * diverse (uno scontrino con 22% + 4% + 0%), salvate nel campo `righe`.
 *
 * I documenti salvati PRIMA non hanno quel campo: per loro sintetizziamo al
 * volo una voce sola dai campi scalari che hanno già. Nessuna migrazione,
 * nessuna scrittura — il documento vecchio resta com'è su Firestore.
 *
 * Usare SEMPRE questa funzione invece di leggere m.iva_rate direttamente:
 * su un documento a IVA mista quel campo vale null.
 */
export function righeMovimento(m) {
  if (Array.isArray(m.righe) && m.righe.length) return m.righe

  const imponibile = m.imponibile != null
    ? Number(m.imponibile)
    : eur((Number(m.importo) || 0) - (Number(m.iva_importo) || 0))

  return [{
    descrizione: '',
    imponibile,
    iva_rate:    Number(m.iva_rate) || 0,
    iva_importo: Number(m.iva_importo) || 0,
    totale:      Number(m.importo) || 0
  }]
}

// Aliquote effettivamente usate in un movimento, ordinate crescenti
export function aliquoteMovimento(m) {
  return [...new Set(
    righeMovimento(m)
      .filter(r => (Number(r.imponibile) || 0) > 0)
      .map(r => Number(r.iva_rate) || 0)
  )].sort((a, b) => a - b)
}


// ---- Debounce (per search) ----

export function debounce(fn, ms = 300) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
