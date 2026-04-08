// ============================================================
// JS/MODULES/COMPENSI.JS — Logica modulo Compensi Soci
// Importato dinamicamente da router.js quando si naviga a #compensi
// ============================================================

import { db, collections, toTimestamp, FieldValue } from '../../js/firebase-config.js'
import {
  formatEuro, formatDate, formatPercent,
  toInputDate, toast, openModal, closeModal,
  initModalClose, confirmDelete
} from '../../js/utils.js'
import { ICONS } from '../../css/icons.js'

// ── Stato locale del modulo ──────────────────────────────────
let soci      = []   // array documenti Firestore soci
let compensi  = []   // array documenti Firestore compensi
let filtroSocio = '' // ID socio selezionato nel filtro ('' = tutti)
let filtroAnno  = String(new Date().getFullYear()) // anno selezionato


// ============================================================
// INIT — chiamato dal router dopo l'iniezione dell'HTML
// ============================================================

export async function init() {
  try {
    // 1. Carica i dati in parallelo per velocizzare
    await caricaDati()

    // 2. Popola select e filtri con i dati reali
    popolaFiltri()

    // 3. Render componenti
    renderSociCards()
    renderKPI()
    renderTabella()

    // 4. Collega tutti gli eventi
    initEventi()
    initModalClose() // chiude modal cliccando fuori

  } catch (err) {
    console.error('Errore init compensi:', err)
    toast('Errore nel caricamento del modulo', 'error')
  }
}


// ============================================================
// CARICAMENTO DATI DA FIRESTORE
// ============================================================

async function caricaDati() {
  // Fetch soci e compensi in parallelo con Promise.all
  const [snapSoci, snapCompensi] = await Promise.all([
    collections.soci().orderBy('nome').get(),
    collections.compensi().orderBy('createdAt', 'desc').get()
  ])

  soci     = snapSoci.docs.map(d => ({ id: d.id, ...d.data() }))
  compensi = snapCompensi.docs.map(d => ({ id: d.id, ...d.data() }))
}


// ============================================================
// RENDER — CARD SOCI
// ============================================================

function renderSociCards() {
  const grid = document.getElementById('soci-grid')
  if (!grid) return

  // Nessun socio nel DB
  if (soci.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        ${ICONS.users}
        <p>Nessun socio trovato in Firestore.</p>
      </div>`
    return
  }

  const annoCorrente = new Date().getFullYear()

  grid.innerHTML = soci.map(socio => {
    // Filtra i compensi di questo socio
    const compensiSocio = compensi.filter(c => c.socio_ref === socio.id)

    // Totale compensi già pagati nell'anno corrente (YTD)
    const totaleYTD = compensiSocio
      .filter(c => {
        if (c.stato !== 'pagata') return false
        const anno = estraiAnno(c)
        return anno === annoCorrente
      })
      .reduce((sum, c) => sum + (c.importo || 0), 0)

    // Totale ancora da ricevere (tutti gli anni)
    const totaleDaRicevere = compensiSocio
      .filter(c => c.stato === 'da_pagare')
      .reduce((sum, c) => sum + (c.importo || 0), 0)

    // Colore barra superiore: verde se ha ricevuto tutto, ambra se ha importi in sospeso
    const coloreCard = totaleDaRicevere > 0 ? 'amber' : 'green'

    return `
      <div class="kpi-card ${coloreCard}">

        <!-- Nome + email socio -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div class="kpi-label">${ICONS.users} Socio</div>
            <div style="font-size:16px;font-weight:800;color:var(--text0);margin-top:4px">
              ${escHtml(socio.nome)}
            </div>
            ${socio.email
              ? `<div style="font-size:10px;color:var(--text2);margin-top:2px">${escHtml(socio.email)}</div>`
              : ''}
          </div>
          <!-- Quota percentuale in evidenza -->
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:24px;font-weight:800;color:var(--secondary);line-height:1">
              ${socio.quota_percentuale || 0}%
            </div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text2)">
              Quota
            </div>
          </div>
        </div>

        <!-- Riga totali -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;
                    padding-top:10px;border-top:1px solid var(--border)">
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text2)">
              Ricevuti YTD
            </div>
            <div style="font-size:14px;font-weight:700;color:var(--green);margin-top:3px">
              ${formatEuro(totaleYTD)}
            </div>
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text2)">
              Da ricevere
            </div>
            <div style="font-size:14px;font-weight:700;
                        color:${totaleDaRicevere > 0 ? 'var(--amber)' : 'var(--text2)'};margin-top:3px">
              ${totaleDaRicevere > 0 ? formatEuro(totaleDaRicevere) : '—'}
            </div>
          </div>
        </div>

        <!-- Bottone modifica quota -->
        <button class="btn btn-secondary btn-sm"
          style="margin-top:12px;width:100%;justify-content:center"
          onclick="window.__compModQuota('${socio.id}', '${escAttr(socio.nome)}', ${socio.quota_percentuale || 0})">
          ${ICONS.edit} Modifica quota
        </button>

      </div>
    `
  }).join('')
}


// ============================================================
// RENDER — KPI CARDS
// ============================================================

function renderKPI() {
  const annoCorrente = new Date().getFullYear()

  // Compensi dell'anno corrente
  const compensiAnno = compensi.filter(c => estraiAnno(c) === annoCorrente)

  // Totale erogato (stato = pagata) nell'anno corrente
  const totaleErogati = compensiAnno
    .filter(c => c.stato === 'pagata')
    .reduce((sum, c) => sum + (c.importo || 0), 0)

  // Totale in sospeso (tutti gli anni, non solo l'anno corrente)
  const totaleDaErogare = compensi
    .filter(c => c.stato === 'da_pagare')
    .reduce((sum, c) => sum + (c.importo || 0), 0)

  // Media per periodo: tot erogati / periodi distinti con almeno un pagamento
  const periodiDistinti = new Set(
    compensiAnno
      .filter(c => c.stato === 'pagata' && c.periodo)
      .map(c => c.periodo)
  )
  const mediaPerPeriodo = periodiDistinti.size > 0
    ? totaleErogati / periodiDistinti.size
    : 0

  // Aggiorna valori nel DOM
  const setEl = (id, val) => {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  }
  setEl('kpi-erogati',    formatEuro(totaleErogati))
  setEl('kpi-da-erogare', formatEuro(totaleDaErogare))
  setEl('kpi-media',      formatEuro(mediaPerPeriodo))
}


// ============================================================
// RENDER — TABELLA COMPENSI
// ============================================================

function renderTabella() {
  const wrap = document.getElementById('tabella-compensi-wrap')
  if (!wrap) return

  // Applica filtro socio e filtro anno
  const dati = compensi.filter(c => {
    const matchSocio = !filtroSocio || c.socio_ref === filtroSocio
    const matchAnno  = !filtroAnno  || String(estraiAnno(c)) === filtroAnno
    return matchSocio && matchAnno
  })

  // Nessun risultato
  if (dati.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        ${ICONS.euro}
        <p>Nessun compenso trovato con i filtri selezionati.</p>
      </div>`
    return
  }

  // Genera righe tabella
  const righe = dati.map(c => {
    // Badge stato
    const badge = c.stato === 'pagata'
      ? `<span class="badge badge-green">
           ${ICONS.check.replace('width="16"', 'width="11"').replace('height="16"', 'height="11"')}
           Pagata
         </span>`
      : `<span class="badge badge-amber">Da pagare</span>`

    // Bottone "Paga" — visibile solo se ancora da pagare
    const btnPaga = c.stato === 'da_pagare'
      ? `<button class="btn btn-success btn-sm"
           onclick="window.__compPaga('${c.id}')" title="Segna come pagata">
           ${ICONS.check} Paga
         </button>`
      : ''

    return `
      <tr>
        <td>
          <span style="font-weight:600;color:var(--text0)">${escHtml(c.socio_nome || '—')}</span>
        </td>
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
// POPOLA FILTRI E SELECT NEI FORM
// ============================================================

function popolaFiltri() {
  // ── Selettore anno ──────────────────────────────────────────
  const elAnno = document.getElementById('filtro-anno')
  if (elAnno) {
    const annoCorrente = new Date().getFullYear()
    // Raccoglie anni unici dai dati, poi aggiunge l'anno corrente se mancante
    const anniSet = new Set(compensi.map(c => estraiAnno(c)).filter(Boolean))
    anniSet.add(annoCorrente)
    const anni = [...anniSet].sort((a, b) => b - a) // ordine decrescente

    elAnno.innerHTML =
      `<option value="">Tutti gli anni</option>` +
      anni.map(a =>
        `<option value="${a}" ${String(a) === filtroAnno ? 'selected' : ''}>${a}</option>`
      ).join('')
  }

  // ── Select socio nel filtro tabella ────────────────────────
  const elFiltroSocio = document.getElementById('filtro-socio')
  if (elFiltroSocio) {
    // Mantieni "Tutti i soci" come prima opzione
    elFiltroSocio.innerHTML =
      `<option value="">Tutti i soci</option>` +
      soci.map(s =>
        `<option value="${s.id}" ${s.id === filtroSocio ? 'selected' : ''}>
           ${escHtml(s.nome)}
         </option>`
      ).join('')
  }

  // ── Select socio nel form nuovo compenso ───────────────────
  aggiornaSelectSocioForm()
}

// Aggiorna solo la select del form (utile dopo modifica quota)
function aggiornaSelectSocioForm() {
  const elFormSocio = document.getElementById('compenso-socio')
  if (!elFormSocio) return
  const valAttuale = elFormSocio.value
  elFormSocio.innerHTML =
    `<option value="">Seleziona socio...</option>` +
    soci.map(s =>
      `<option value="${s.id}" data-quota="${s.quota_percentuale || 0}">
         ${escHtml(s.nome)} (${s.quota_percentuale || 0}%)
       </option>`
    ).join('')
  elFormSocio.value = valAttuale // ripristina selezione precedente
}


// ============================================================
// EVENTI
// ============================================================

function initEventi() {
  // Filtro anno → aggiorna tabella
  document.getElementById('filtro-anno')
    ?.addEventListener('change', e => {
      filtroAnno = e.target.value
      renderTabella()
    })

  // Filtro socio → aggiorna tabella
  document.getElementById('filtro-socio')
    ?.addEventListener('change', e => {
      filtroSocio = e.target.value
      renderTabella()
    })

  // Bottone "Nuovo compenso"
  document.getElementById('btn-nuovo-compenso')
    ?.addEventListener('click', apriModalNuovo)

  // Salva compenso nel modal
  document.getElementById('btn-salva-compenso')
    ?.addEventListener('click', salvaCompenso)

  // Chiudi modal compenso
  document.getElementById('btn-cancel-compenso')
    ?.addEventListener('click', () => closeModal('modal-compenso'))
  document.getElementById('modal-compenso-close')
    ?.addEventListener('click', () => closeModal('modal-compenso'))

  // Salva quota socio
  document.getElementById('btn-salva-quota')
    ?.addEventListener('click', salvaQuota)

  // Chiudi modal quota
  document.getElementById('btn-cancel-quota')
    ?.addEventListener('click', () => closeModal('modal-quota'))
  document.getElementById('modal-quota-close')
    ?.addEventListener('click', () => closeModal('modal-quota'))

  // Suggerimento automatico: si aggiorna quando cambia il totale distribuibile
  document.getElementById('totale-distribuibile')
    ?.addEventListener('input', aggiornaSuggerimentoQuote)

  // Mostra/nascondi il box calcolo quote quando si seleziona un socio
  document.getElementById('compenso-socio')
    ?.addEventListener('change', e => {
      const box = document.getElementById('calc-box')
      if (box) box.style.display = e.target.value ? 'block' : 'none'
      aggiornaSuggerimentoQuote()
    })

  // Avviso live sulla somma quote nel modal quota
  document.getElementById('quota-valore')
    ?.addEventListener('input', aggiornaAvvisoQuota)

  // ── Espone funzioni al DOM per i click inline nella tabella ──
  // (necessario perché l'HTML viene iniettato dinamicamente)
  window.__compEdit    = editCompenso
  window.__compDelete  = deleteCompenso
  window.__compPaga    = pagaCompenso
  window.__compModQuota = apriModalModificaQuota
}


// ============================================================
// MODAL NUOVO COMPENSO — apri e reset form
// ============================================================

function apriModalNuovo() {
  // Svuota tutti i campi
  document.getElementById('compenso-id').value       = ''
  document.getElementById('compenso-socio').value    = ''
  document.getElementById('compenso-importo').value  = ''
  document.getElementById('compenso-periodo').value  = ''
  document.getElementById('compenso-data').value     = ''
  document.getElementById('compenso-stato').value    = 'da_pagare'
  document.getElementById('compenso-note').value     = ''
  document.getElementById('totale-distribuibile').value = ''
  document.getElementById('quote-preview').innerHTML = ''
  document.getElementById('calc-box').style.display  = 'none'
  document.getElementById('modal-compenso-title').textContent = 'Nuovo compenso'

  openModal('modal-compenso')
}


// ============================================================
// MODAL MODIFICA COMPENSO — popola con i dati esistenti
// ============================================================

function editCompenso(id) {
  const c = compensi.find(x => x.id === id)
  if (!c) return toast('Compenso non trovato', 'error')

  document.getElementById('compenso-id').value       = c.id
  document.getElementById('compenso-socio').value    = c.socio_ref || ''
  document.getElementById('compenso-importo').value  = c.importo || ''
  document.getElementById('compenso-periodo').value  = c.periodo || ''
  document.getElementById('compenso-data').value     = toInputDate(c.data_pagamento)
  document.getElementById('compenso-stato').value    = c.stato || 'da_pagare'
  document.getElementById('compenso-note').value     = c.note || ''

  // Mostra il box calcolo se c'è un socio selezionato
  const box = document.getElementById('calc-box')
  if (box) box.style.display = c.socio_ref ? 'block' : 'none'

  document.getElementById('modal-compenso-title').textContent = 'Modifica compenso'
  openModal('modal-compenso')
}


// ============================================================
// SALVATAGGIO COMPENSO (add o update)
// ============================================================

async function salvaCompenso() {
  // Leggi i valori dal form
  const id      = document.getElementById('compenso-id').value.trim()
  const socioId = document.getElementById('compenso-socio').value
  const importo = parseFloat(document.getElementById('compenso-importo').value)
  const periodo = document.getElementById('compenso-periodo').value.trim()
  const data    = document.getElementById('compenso-data').value
  const stato   = document.getElementById('compenso-stato').value
  const note    = document.getElementById('compenso-note').value.trim()

  // ── Validazione ────────────────────────────────────────────
  if (!socioId)                           return toast('Seleziona un socio', 'error')
  if (!importo || isNaN(importo) || importo <= 0) return toast('Inserisci un importo valido', 'error')
  if (!periodo)                           return toast('Inserisci il periodo', 'error')

  // Recupera il nome del socio per salvarlo come campo denormalizzato
  const socio = soci.find(s => s.id === socioId)
  if (!socio) return toast('Socio non trovato', 'error')

  // Oggetto dati da salvare
  const dati = {
    socio_ref:      socioId,
    socio_nome:     socio.nome,
    importo,
    periodo,
    data_pagamento: data ? toTimestamp(data) : null,
    stato,
    note
  }

  // ── Feedback visivo sul bottone ────────────────────────────
  const btn = document.getElementById('btn-salva-compenso')
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...' }

  try {
    if (id) {
      // MODIFICA — aggiorna documento esistente
      await collections.compensi().doc(id).update(dati)
      toast('Compenso aggiornato con successo', 'success')
    } else {
      // NUOVO — aggiunge documento
      dati.createdAt = FieldValue.serverTimestamp()
      await collections.compensi().add(dati)
      toast('Compenso aggiunto con successo', 'success')
    }

    closeModal('modal-compenso')

    // Ricarica i dati e aggiorna tutta la UI
    await caricaDati()
    renderSociCards()
    renderKPI()
    renderTabella()

  } catch (err) {
    console.error('Errore salvataggio compenso:', err)
    toast('Errore nel salvataggio. Riprova.', 'error')
  } finally {
    // Ripristina bottone
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
    // Data di pagamento = oggi
    const oggi = new Date().toISOString().split('T')[0]
    await collections.compensi().doc(id).update({
      stato:          'pagata',
      data_pagamento: toTimestamp(oggi)
    })
    toast('Compenso segnato come pagato', 'success')

    await caricaDati()
    renderSociCards()
    renderKPI()
    renderTabella()
  } catch (err) {
    console.error('Errore pagamento compenso:', err)
    toast('Errore nell\'aggiornamento', 'error')
  }
}


// ============================================================
// MODAL MODIFICA QUOTA SOCIO
// ============================================================

function apriModalModificaQuota(id, nome, quota) {
  document.getElementById('quota-socio-id').value   = id
  document.getElementById('quota-socio-nome').value = nome
  document.getElementById('quota-valore').value     = quota
  document.getElementById('quota-avviso').textContent = ''

  // Mostra subito l'avviso con la situazione attuale
  aggiornaAvvisoQuota()
  openModal('modal-quota')
}

// Avviso live sulla somma totale quote
function aggiornaAvvisoQuota() {
  const avviso  = document.getElementById('quota-avviso')
  const id      = document.getElementById('quota-socio-id')?.value
  const nuovaQt = parseFloat(document.getElementById('quota-valore')?.value) || 0

  if (!avviso || !id) return

  // Somma delle quote di tutti gli altri soci (escluso quello che stiamo modificando)
  const altriSoci   = soci.filter(s => s.id !== id)
  const sommaAltri  = altriSoci.reduce((s, x) => s + (x.quota_percentuale || 0), 0)
  const sommaFinale = sommaAltri + nuovaQt

  if (sommaFinale > 100) {
    avviso.style.color = 'var(--red)'
    avviso.textContent = `⚠ Totale quote: ${sommaFinale.toFixed(1)}% — supera il 100%`
  } else {
    avviso.style.color = 'var(--text2)'
    avviso.textContent = `Somma totale quote: ${sommaFinale.toFixed(1)}% di 100%`
  }
}

async function salvaQuota() {
  const id    = document.getElementById('quota-socio-id').value
  const quota = parseFloat(document.getElementById('quota-valore').value)

  if (!id) return
  if (isNaN(quota) || quota < 0 || quota > 100) {
    return toast('Quota deve essere un numero tra 0 e 100', 'error')
  }

  // Controllo che la somma totale non superi 100%
  const altriSoci  = soci.filter(s => s.id !== id)
  const sommaAltri = altriSoci.reduce((s, x) => s + (x.quota_percentuale || 0), 0)
  if (sommaAltri + quota > 100) {
    return toast(
      `La somma delle quote supererebbe 100% (${(sommaAltri + quota).toFixed(1)}%)`,
      'error'
    )
  }

  try {
    await collections.soci().doc(id).update({ quota_percentuale: quota })
    toast('Quota aggiornata', 'success')
    closeModal('modal-quota')

    // Ricarica dati e aggiorna UI
    await caricaDati()
    renderSociCards()
    popolaFiltri() // aggiorna la select con la nuova percentuale
  } catch (err) {
    console.error('Errore aggiornamento quota:', err)
    toast('Errore nel salvataggio della quota', 'error')
  }
}


// ============================================================
// SUGGERIMENTO AUTOMATICO QUOTE
// Quando l'utente inserisce un "totale da distribuire",
// mostra quanto spetta a ogni socio in base alle sue quote.
// ============================================================

function aggiornaSuggerimentoQuote() {
  const totaleEl   = document.getElementById('totale-distribuibile')
  const previewEl  = document.getElementById('quote-preview')
  const socioSelEl = document.getElementById('compenso-socio')

  if (!totaleEl || !previewEl) return

  const totale = parseFloat(totaleEl.value)

  // Nessun valore inserito → svuota anteprima
  if (!totale || isNaN(totale) || totale <= 0) {
    previewEl.innerHTML = ''
    return
  }

  const socioSelezionato = socioSelEl?.value

  // Genera una riga per ogni socio con la sua quota calcolata
  const righe = soci.map(s => {
    const quotaEuro  = (totale * (s.quota_percentuale || 0)) / 100
    const isSelected = s.id === socioSelezionato

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:6px 8px;border-radius:var(--rs);margin-bottom:3px;
                  background:${isSelected ? 'var(--primaryD)' : 'var(--bg)'};
                  border:1px solid ${isSelected ? 'rgba(230,22,92,.2)' : 'var(--border)'}">
        <span style="font-size:12px;font-weight:${isSelected ? '700' : '500'};
                     color:${isSelected ? 'var(--primary)' : 'var(--text1)'}">
          ${escHtml(s.nome)}
          <span style="font-weight:400;color:var(--text2)">(${s.quota_percentuale || 0}%)</span>
        </span>
        <span style="font-size:12px;font-weight:700;
                     color:${isSelected ? 'var(--primary)' : 'var(--text0)'};
                     display:flex;align-items:center;gap:6px">
          ${formatEuro(quotaEuro)}
          ${isSelected
            ? `<button type="button" class="btn btn-primary btn-sm"
                 onclick="document.getElementById('compenso-importo').value='${quotaEuro.toFixed(2)}';
                          this.textContent='✓ Usato';this.disabled=true"
                 style="font-size:10px;padding:2px 8px">
                 Usa
               </button>`
            : ''}
        </span>
      </div>`
  }).join('')

  previewEl.innerHTML = righe
}


// ============================================================
// UTILITY LOCALI
// ============================================================

// Estrae l'anno (number) da un documento compenso.
// Prova prima dal campo "periodo" (es. "Gennaio 2025" → 2025),
// poi dalla data_pagamento, poi da createdAt.
function estraiAnno(c) {
  if (c.periodo) {
    const m = c.periodo.match(/\b(20\d\d)\b/)
    if (m) return parseInt(m[1])
  }
  const campi = [c.data_pagamento, c.createdAt]
  for (const campo of campi) {
    if (campo) {
      const d = campo.toDate ? campo.toDate() : new Date(campo)
      if (!isNaN(d)) return d.getFullYear()
    }
  }
  return new Date().getFullYear()
}

// Escape HTML per sicurezza (evita XSS con nomi/email)
function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Escape per attributi HTML (es. onclick con stringhe)
function escAttr(str) {
  if (!str) return ''
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;')
}
