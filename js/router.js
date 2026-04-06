// ============================================================
// ROUTER.JS — Caricamento dinamico dei moduli
// Legge l'hash URL e carica il modulo corrispondente.
// ============================================================

import { THEME } from '../config/theme.js'
import { ICONS } from '../css/icons.js'

// Modulo attualmente caricato
let currentModule = null

// Cache dei moduli già caricati (evita fetch ripetuti)
const moduleCache = {}

// ---- Inizializzazione ----

export function initRouter() {
  // Costruisce la sidebar dal config
  buildSidebar()

  // Naviga al modulo iniziale
  const hash = window.location.hash.replace('#', '') || 'dashboard'
  navigateTo(hash)

  // Ascolta i cambi di hash
  window.addEventListener('hashchange', () => {
    const id = window.location.hash.replace('#', '')
    navigateTo(id)
  })
}

// ---- Navigazione ----

export async function navigateTo(moduleId) {
  // Verifica che il modulo esista nel menu
  const menuItem = THEME.menu.find(m => m.id === moduleId)
  if (!menuItem) {
    console.warn(`Modulo "${moduleId}" non trovato nel menu.`)
    return
  }

  // Aggiorna hash URL
  if (window.location.hash !== `#${moduleId}`) {
    window.location.hash = moduleId
  }

  // Aggiorna topbar title
  const topbarTitle = document.getElementById('topbar-title')
  if (topbarTitle) topbarTitle.textContent = menuItem.label

  // Aggiorna voce attiva nella sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === moduleId)
  })

  // Carica HTML del modulo
  await loadModule(moduleId)
  currentModule = moduleId
}

// ---- Caricamento modulo ----

async function loadModule(id) {
  const container = document.getElementById('main-content')
  if (!container) return

  // Mostra spinner di caricamento
  container.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      Caricamento...
    </div>
  `

  try {
    // Controlla la cache
    let html = moduleCache[id]

    if (!html) {
      const res = await fetch(`modules/${id}.html`)
      if (!res.ok) throw new Error(`Impossibile caricare modules/${id}.html`)
      html = await res.text()
      moduleCache[id] = html
    }

    container.innerHTML = html

    // Carica e inizializza il JS del modulo se esiste
    try {
      const mod = await import(`./modules/${id}.js`)
      if (typeof mod.init === 'function') {
        await mod.init()
      }
    } catch (e) {
      // Il JS del modulo è opzionale
    }

  } catch (err) {
    console.error(err)
    container.innerHTML = `
      <div class="empty-state">
        <p>Errore nel caricamento del modulo <strong>${id}</strong>.</p>
        <p style="margin-top:8px;font-size:11px;color:var(--text2)">${err.message}</p>
      </div>
    `
  }
}

// ---- Costruzione sidebar ----

function buildSidebar() {
  const nav = document.getElementById('sb-nav')
  const externals = document.getElementById('sb-externals')
  const brand = document.getElementById('sb-brand')

  if (!nav) return

  // --- BRAND ---
  if (brand) {
    if (THEME.brand.logo) {
      // Logo immagine — nessun tagline testuale, il logo include già tutto
      brand.innerHTML = `
        <img
          src="${THEME.brand.logo}"
          alt="${THEME.brand.logoAlt}"
          class="sb-logo-img"
          style="max-height:${THEME.brand.logoHeight};width:auto;display:block;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block'"
        >
        <div class="sb-logo-text" style="display:none">${THEME.brand.name}</div>
      `
    } else {
      brand.innerHTML = `
        <div class="sb-logo-text">${THEME.brand.name}</div>
        <div class="sb-tagline">${THEME.brand.tagline}</div>
      `
    }
  }

  // --- MENU PRINCIPALE ---
  let lastSection = null
  let navHTML = ''

  THEME.menu.forEach(item => {
    // Intestazione sezione
    if (item.section !== lastSection) {
      if (item.section) {
        navHTML += `<div class="sb-section">${item.section}</div>`
      }
      lastSection = item.section
    }

    const icon = ICONS[item.icon] || ICONS.dot
    navHTML += `
      <div class="nav-item" data-id="${item.id}" onclick="window.location.hash='${item.id}'">
        ${icon}
        <span>${item.label}</span>
      </div>
    `
  })

  nav.innerHTML = navHTML

  // --- LINK ESTERNI ---
  if (externals && THEME.externalLinks.length > 0) {
    let extHTML = ''
    THEME.externalLinks.forEach(link => {
      const icon = ICONS[link.icon] || ICONS.external
      extHTML += `
        <a class="nav-item-ext" href="${link.url}" target="_blank" rel="noopener">
          ${icon}
          <span>${link.label}</span>
        </a>
      `
    })
    externals.innerHTML = extHTML
    externals.style.display = 'block'
  }

  // --- APPLICA COLORI TEMA ---
  applyTheme()
}

// ---- Applica colori da theme.js alle CSS variables ----

function applyTheme() {
  const root = document.documentElement
  if (THEME.colors) {
    Object.entries(THEME.colors).forEach(([key, val]) => {
      root.style.setProperty(`--${key}`, val)
    })
  }
}
