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

// ---- Debounce (per search) ----

export function debounce(fn, ms = 300) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
