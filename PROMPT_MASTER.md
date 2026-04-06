# PROMPT MASTER — Gestionale Strategica MNS

> Questo documento è il riferimento fisso per ogni sessione di sviluppo.
> Prima di iniziare qualsiasi lavoro su questo progetto, leggilo.

---

## Stack tecnico

| Elemento | Scelta |
|---|---|
| Hosting | GitHub Pages / Firebase Hosting |
| Database | Firebase Firestore |
| Auth | Firebase Authentication |
| Font | Montserrat (Google Fonts) |
| Icone | Solo SVG inline (nessuna libreria esterna) |
| CSS | Variabili CSS centralizzate in `config/theme.js` e `css/base.css` |
| JS | Vanilla JS modulare (ES Modules), nessun framework |

---

## Struttura cartelle

```
/
├── config/
│   └── theme.js          ← UNICO file per colori, logo, nome, link esterni
├── css/
│   ├── base.css          ← Layout, componenti, utility classes
│   └── icons.js          ← Libreria icone SVG come costanti JS
├── js/
│   ├── firebase-config.js
│   ├── auth.js
│   ├── router.js         ← Caricamento dinamico moduli
│   └── utils.js          ← Funzioni condivise
├── modules/              ← Un file HTML per ogni sezione
│   ├── dashboard.html
│   ├── contratti.html
│   ├── incassi.html
│   ├── iva.html
│   ├── costi.html
│   ├── provvigioni.html
│   └── compensi.html
├── firebase/
│   └── seed.js           ← Lancia una volta, crea tutto il DB
├── index.html            ← Shell: sidebar + topbar + contenitore moduli
└── PROMPT_MASTER.md
```

---

## Design System

### Colori (da config/theme.js)
```
--primary:    #e6165c   (magenta — azioni, link attivi, accenti)
--secondary:  #0f507b   (blu scuro — header, testi importanti)
--bg:         #ffffff   (sfondo generale)
--bg1:        #f4f7fa   (sidebar, card secondarie)
--bg2:        #edf1f7   (hover stati, righe tabella)
--text0:      #1b3050   (testo principale)
--text1:      #4a6380   (testo secondario)
--text2:      #8fa3b8   (testo terziario, label)
--border:     #dde4ed   (bordi generali)
--green:      #10b981
--red:        #f87171
--amber:      #fbbf24
--radius:     8px
--radius-sm:  5px
--sidebar-w:  220px
```

### Font
```html
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
- Headings: Montserrat 700/800
- Body: Montserrat 400/500
- Label uppercase: Montserrat 700, letter-spacing .12em

### Icone
- **Solo SVG inline** — nessun font-icon, nessuna libreria
- Tutte definite in `css/icons.js` come stringhe SVG esportate
- Dimensione standard: 16×16 (menu), 18×18 (azioni), 20×20 (KPI cards)
- Stroke colore: `currentColor`

---

## Architettura modulare

### Come funziona il routing
`router.js` legge l'URL hash (`#dashboard`, `#contratti`, ecc.) e:
1. Fa fetch del file `modules/{nome}.html`
2. Inietta il contenuto nel `<div id="main-content">`
3. Esegue l'init JS del modulo (`modules/{nome}.js` se esiste)
4. Aggiorna la voce attiva nella sidebar

### Come aggiungere un nuovo modulo
1. Creare `modules/nuovo.html`
2. Aggiungere la voce in `config/theme.js` nell'array `menu`
3. Fine. Nient'altro da toccare.

---

## config/theme.js — struttura

```js
export const THEME = {
  brand: {
    name: 'Strategica MNS',
    tagline: 'Gestionale interno',
    logo: null,  // null = usa testo; '/assets/logo.svg' = usa immagine
    logoAlt: 'Strategica MNS'
  },
  colors: {
    primary:   '#e6165c',
    secondary: '#0f507b',
  },
  externalLinks: [
    { label: 'Gestionale Commerciale 1', url: 'https://...', icon: 'external' },
    { label: 'Gestionale Commerciale 2', url: 'https://...', icon: 'external' }
  ],
  menu: [
    { id: 'dashboard',   label: 'Dashboard',         icon: 'dashboard',   section: null },
    { id: 'contratti',   label: 'Contratti',          icon: 'contract',    section: 'Gestione' },
    { id: 'incassi',     label: 'Incassi & Pagamenti',icon: 'payment',     section: 'Gestione' },
    { id: 'iva',         label: 'IVA & Conti',        icon: 'bank',        section: 'Contabilità' },
    { id: 'costi',       label: 'Costi & Break Even', icon: 'chart',       section: 'Contabilità' },
    { id: 'provvigioni', label: 'Provvigioni',         icon: 'percent',     section: 'Contabilità' },
    { id: 'compensi',    label: 'Compensi Soci',      icon: 'users',       section: 'Soci' },
  ]
}
```

---

## Firebase — Struttura collezioni Firestore

```
/contratti/{id}
  - numero, cliente, data_inizio, data_fine, valore, stato, note

/movimenti/{id}
  - tipo (incasso|pagamento), importo, data, descrizione, categoria
  - conto, iva_rate, iva_importo, contratto_ref

/conti/{id}
  - nome, iban, saldo_iniziale, banca

/costi/{id}
  - descrizione, importo, tipo (fisso|variabile), periodicita, categoria

/provvigioni/{id}
  - agente, importo, contratto_ref, data, stato (da_pagare|pagata)

/soci/{id}
  - nome, quota_percentuale, email

/compensi/{id}
  - socio_ref, importo, periodo, data_pagamento, note
```

---

## Regole di codice

1. **Niente jQuery** — vanilla JS puro
2. **Niente CSS framework** (no Bootstrap, no Tailwind) — solo il nostro `base.css`
3. **Tutti i colori** via CSS custom properties, mai hardcoded nel codice
4. **Ogni modulo** è autonomo: HTML + logica JS nello stesso file o file JS dedicato
5. **Commenti in italiano** nel codice
6. **Icone sempre SVG inline** — mai img, mai font-icon
7. **Firebase SDK v9** compat mode (già usata nel progetto precedente)
8. **Nessun dato hardcoded** — tutto viene da Firestore

---

## Note sessioni future

- Se si trova un bug in un modulo → si tocca solo quel file modulo
- Se si vuole cambiare branding → solo `config/theme.js`
- Se si vuole aggiungere un modulo → un file + una riga nel menu
- Manuale utente → ultima fase, generato automaticamente

---

*Ultimo aggiornamento: inizio progetto*
