# PROMPT MODULI — Gestionale Strategica MNS
# Copia il prompt del modulo che vuoi costruire e incollalo in una nuova chat di progetto.
# Ogni prompt è autosufficiente: contiene tutto il contesto necessario.

---

# ════════════════════════════════════════════════════════════
# PROMPT 0 — FIREBASE SETUP
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `index.html` — shell con sidebar e topbar
- `css/base.css` — design system completo con CSS variables
- `css/icons.js` — libreria icone SVG
- `config/theme.js` — configurazione brand, colori, menu
- `js/router.js` — routing modulare
- `js/utils.js` — funzioni condivise (formatEuro, formatDate, toast, ecc.)
- `js/firebase-config.js` — da completare con le credenziali

**Colori principali:**
- `--primary: #e6165c` (magenta)
- `--secondary: #0f507b` (blu scuro)
- Sfondo: `#ffffff`

**Obiettivo di questa chat:**
Devo configurare Firebase Firestore per questo progetto. Ho già un account Firebase ma non ho ancora creato il progetto.

Guidami passo per passo come se fossi un principiante:
1. Creazione progetto Firebase dalla console
2. Attivazione Firestore in modalità produzione
3. Regole di sicurezza Firestore adatte a un uso interno (accesso solo ad utenti autenticati)
4. Copia delle credenziali nel file `js/firebase-config.js`
5. Creazione e lancio del file `firebase/seed.js` che popola automaticamente queste collezioni:
   - `contratti` (numero, cliente, data_inizio, data_fine, valore, stato, note)
   - `movimenti` (tipo, importo, data, descrizione, categoria, conto, iva_rate, iva_importo, contratto_ref)
   - `conti` (nome, iban, saldo_iniziale, banca)
   - `costi` (descrizione, importo, tipo, periodicita, categoria)
   - `provvigioni` (agente, importo, contratto_ref, data, stato)
   - `soci` (nome, quota_percentuale, email)
   - `compensi` (socio_ref, importo, periodo, data_pagamento, note)

Il seed deve inserire dati di esempio realistici (non placeholder vuoti) così posso vedere subito il gestionale funzionante con dati veri.

Al termine dimmi esattamente quali file ho modificato e cosa devo fare su GitHub.


---

# ════════════════════════════════════════════════════════════
# PROMPT 1 — MODULO DASHBOARD
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `index.html` — shell con sidebar e topbar, carica i moduli dinamicamente
- `css/base.css` — design system con queste classi disponibili: `.kpi-grid`, `.kpi-card`, `.card`, `.card-header`, `.table-wrap`, `.badge`, `.btn`, `.btn-primary`, `.btn-secondary`, `.loading`, `.empty-state`
- `css/icons.js` — icone disponibili: dashboard, contract, payment, bank, chart, percent, users, external, plus, edit, trash, search, close, check, euro, calendar, filter, download
- `config/theme.js` — colori: `--primary #e6165c`, `--secondary #0f507b`
- `js/utils.js` — funzioni disponibili: `formatEuro(n)`, `formatDate(d)`, `formatDateShort(d)`, `formatNum(n)`, `formatPercent(n)`, `toast(msg, type)`, `openModal(id)`, `closeModal(id)`
- `js/firebase-config.js` — esporta `db` e `collections` (shortcut alle collezioni Firestore)

**Collezioni Firebase disponibili:**
- `movimenti` — tipo (incasso|pagamento), importo, data, descrizione, categoria, conto
- `contratti` — numero, cliente, data_inizio, data_fine, valore, stato (attivo|scaduto|sospeso)
- `conti` — nome, saldo_iniziale, banca
- `costi` — importo, tipo (fisso|variabile), periodicita

**Obiettivo di questa chat:**
Costruisci il modulo Dashboard del gestionale. Si compone di due file:

**File 1: `modules/dashboard.html`**
Struttura HTML del modulo con:
- Riga KPI cards (5 card): Fatturato YTD, Incassi mese corrente, Pagamenti mese corrente, Contratti attivi, Saldo totale conti
- Grafico andamento mensile incassi vs uscite (ultimi 6 mesi) — usa Chart.js caricato da CDN
- Tabella ultimi 10 movimenti con: data, descrizione, tipo (badge verde=incasso / rosso=pagamento), importo
- Tabella contratti in scadenza nei prossimi 60 giorni con: cliente, data scadenza, valore, stato

**File 2: `js/modules/dashboard.js`**
Logica JS con `export async function init()` che:
- Importa `db` da `../../js/firebase-config.js` e le utility da `../../js/utils.js`
- Legge i dati da Firestore in parallelo (Promise.all)
- Calcola i KPI e popola le card
- Popola le tabelle
- Inizializza il grafico Chart.js

**Regole di stile obbligatorie:**
- Usa solo classi di `base.css`, mai stili inline aggiuntivi salvo eccezioni necessarie
- Icone: solo SVG inline da `icons.js`, mai img o emoji
- Nessun dato hardcoded: tutto da Firestore
- Commenti in italiano nel codice
- Se Firestore è vuoto mostra `.empty-state` con messaggio appropriato


---

# ════════════════════════════════════════════════════════════
# PROMPT 2 — MODULO CONTRATTI
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `index.html` — shell con sidebar e topbar, carica i moduli dinamicamente
- `css/base.css` — classi disponibili: `.table-wrap`, `.card`, `.badge`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.modal`, `.modal-overlay`, `.form-control`, `.form-group`, `.form-row`, `.search-box`, `.empty-state`, `.loading`
- `css/icons.js` — icone: contract, plus, edit, trash, search, close, check, calendar, filter, download, euro
- `js/utils.js` — `formatEuro`, `formatDate`, `toInputDate`, `toast`, `openModal`, `closeModal`, `initModalClose`, `confirmDelete`, `stateBadge`
- `js/firebase-config.js` — esporta `db`, `collections`, `toTimestamp`

**Struttura documento Firestore `contratti/{id}`:**
```
numero: string          (es. "2024-001")
cliente: string
data_inizio: Timestamp
data_fine: Timestamp
valore: number          (valore totale contratto)
stato: string           (attivo | scaduto | sospeso | concluso)
note: string
createdAt: Timestamp
```

**Obiettivo di questa chat:**
Costruisci il modulo Contratti. Si compone di due file:

**File 1: `modules/contratti.html`**
- Header con titolo, contatore contratti totali, bottone "Nuovo contratto"
- Filtri: barra ricerca per cliente/numero + chip filtro per stato (Tutti / Attivi / In scadenza / Scaduti)
- Tabella con colonne: Numero, Cliente, Data inizio, Data fine, Valore, Stato, Azioni (modifica + elimina)
- Modal "Nuovo / Modifica contratto" con form: numero, cliente, data inizio, data fine, valore, stato, note
- Badge stati colorati: attivo=verde, scaduto=rosso, sospeso=ambra, concluso=grigio
- Contratti in scadenza entro 30 giorni evidenziati con bordo ambra

**File 2: `js/modules/contratti.js`**
Con `export async function init()` che gestisce:
- Caricamento e rendering lista contratti da Firestore
- Filtro e ricerca real-time (lato client)
- Apertura modal per nuovo contratto e per modifica
- Salvataggio (add/update) su Firestore con `toast` di conferma
- Eliminazione con `confirmDelete` e `toast`
- Ordinamento di default: data_fine crescente (prima i più vicini alla scadenza)

**Regole obbligatorie:**
- Usa solo classi di `base.css`
- Icone SVG inline da `icons.js`
- Nessun dato hardcoded
- Commenti in italiano
- Gestione errori Firebase con `toast(msg, 'error')`


---

# ════════════════════════════════════════════════════════════
# PROMPT 3 — MODULO INCASSI & PAGAMENTI
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `css/base.css` — classi: `.table-wrap`, `.badge`, `.btn`, `.modal`, `.form-control`, `.form-row`, `.kpi-grid`, `.kpi-card`, `.chip`, `.search-box`, `.empty-state`
- `css/icons.js` — icone: payment, plus, edit, trash, search, filter, download, euro, calendar, arrowDown, check
- `js/utils.js` — `formatEuro`, `formatDate`, `toInputDate`, `toast`, `openModal`, `closeModal`, `initModalClose`, `confirmDelete`
- `js/firebase-config.js` — esporta `db`, `collections`, `toTimestamp`

**Struttura documento Firestore `movimenti/{id}`:**
```
tipo: string            (incasso | pagamento)
importo: number
data: Timestamp
descrizione: string
categoria: string       (es. "Contratto", "Consulenza", "Affitto", "Stipendi", ...)
conto: string           (riferimento nome conto)
iva_rate: number        (es. 22)
iva_importo: number     (calcolato automaticamente)
contratto_ref: string   (ID contratto collegato, opzionale)
note: string
createdAt: Timestamp
```

**Obiettivo di questa chat:**
Costruisci il modulo Incassi & Pagamenti. Due file:

**File 1: `modules/incassi.html`**
- KPI in cima: Totale incassi mese, Totale pagamenti mese, Saldo netto mese, Totale incassi YTD
- Filtri: ricerca testo + chip Tutti/Incassi/Pagamenti + selettore mese/anno
- Tabella movimenti: data, descrizione, categoria (badge), conto, IVA%, importo (verde=incasso, rosso=pagamento), azioni
- Bottone "Nuovo movimento" — modal con form completo
- Riga totali in fondo alla tabella
- Bottone esporta CSV (solo i dati filtrati visibili)

**File 2: `js/modules/incassi.js`**
Con `export async function init()` che gestisce:
- Caricamento movimenti da Firestore con filtro per mese selezionato
- Calcolo KPI in tempo reale al cambio filtro
- Rendering tabella con colori differenziati incasso/pagamento
- Calcolo automatico IVA al cambio importo e aliquota nel form
- Salvataggio, modifica, eliminazione movimenti
- Esportazione CSV dei movimenti filtrati
- Ordinamento per data decrescente (più recenti in cima)

**Regole obbligatorie:**
- Usa solo classi di `base.css`
- Icone SVG inline da `icons.js`
- Nessun dato hardcoded
- Commenti in italiano
- Gestione errori con `toast`


---

# ════════════════════════════════════════════════════════════
# PROMPT 4 — MODULO IVA & CONTI CORRENTI
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `css/base.css` — classi: `.kpi-grid`, `.kpi-card`, `.table-wrap`, `.card`, `.badge`, `.btn`, `.modal`, `.form-control`, `.form-row`
- `css/icons.js` — icone: bank, euro, calendar, plus, edit, trash, check, download, arrowDown
- `js/utils.js` — `formatEuro`, `formatDate`, `toInputDate`, `toast`, `openModal`, `closeModal`, `initModalClose`, `confirmDelete`
- `js/firebase-config.js` — esporta `db`, `collections`, `toTimestamp`

**Strutture Firestore:**

`conti/{id}`:
```
nome: string
iban: string
banca: string
saldo_iniziale: number
createdAt: Timestamp
```

`movimenti/{id}` (già popolata dal modulo Incassi):
```
tipo, importo, data, iva_rate, iva_importo, conto, ...
```

**Obiettivo di questa chat:**
Costruisci il modulo IVA & Conti correnti. Due sezioni in un unico modulo:

**File 1: `modules/iva.html`**

*Sezione Conti correnti:*
- Card per ogni conto con: nome banca, IBAN mascherato, saldo calcolato (saldo iniziale + movimenti)
- Bottone aggiungi/modifica conto
- Mini estratto conto per ogni conto (ultimi 5 movimenti)

*Sezione IVA:*
- Selettore trimestre (I/II/III/IV) e anno
- KPI: IVA a credito (su acquisti), IVA a debito (su vendite), Saldo IVA da versare/a credito
- Tabella riepilogativa per aliquota (4%, 10%, 22%)
- Nota: questo è un riepilogo orientativo, non una dichiarazione fiscale

**File 2: `js/modules/iva.js`**
Con `export async function init()` che:
- Carica i conti da Firestore e calcola il saldo reale di ognuno sommando i movimenti
- Calcola l'IVA del trimestre selezionato leggendo i movimenti filtrati per data
- Aggiornamento in tempo reale al cambio trimestre/anno
- CRUD conti correnti (aggiungi, modifica, elimina)

**Regole obbligatorie:**
- Usa solo classi di `base.css`
- Icone SVG inline da `icons.js`
- Nessun dato hardcoded
- Commenti in italiano
- Avviso visibile: "I dati IVA sono indicativi — verificare con il proprio commercialista"


---

# ════════════════════════════════════════════════════════════
# PROMPT 5 — MODULO COSTI & BREAK EVEN
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `css/base.css` — classi: `.kpi-grid`, `.kpi-card`, `.table-wrap`, `.card`, `.badge`, `.btn`, `.modal`, `.form-control`, `.form-row`, `.empty-state`
- `css/icons.js` — icone: chart, plus, edit, trash, euro, percent, check, download
- `js/utils.js` — `formatEuro`, `formatNum`, `formatPercent`, `toast`, `openModal`, `closeModal`, `initModalClose`, `confirmDelete`
- `js/firebase-config.js` — esporta `db`, `collections`, `toTimestamp`

**Struttura Firestore `costi/{id}`:**
```
descrizione: string
importo: number
tipo: string            (fisso | variabile)
periodicita: string     (mensile | trimestrale | semestrale | annuale)
categoria: string       (es. "Struttura", "Personale", "IT", "Marketing", ...)
attivo: boolean
createdAt: Timestamp
```

**Obiettivo di questa chat:**
Costruisci il modulo Costi & Break Even. Due file:

**File 1: `modules/costi.html`**

*Sezione Costi:*
- KPI: Totale costi fissi mensili, Totale costi variabili mensili, Totale costi annuali
- Tabella costi suddivisa in due tab (Fissi / Variabili) con: descrizione, categoria (badge), periodicità, importo mensile normalizzato, azioni
- Bottone "Aggiungi costo"
- Modal form: descrizione, importo, tipo, periodicità, categoria, attivo (toggle)

*Sezione Break Even:*
- Input: fatturato medio mensile (preso automaticamente da media ultimi 6 mesi da `movimenti`)
- Calcolo e visualizzazione grafica (Chart.js) del punto di pareggio:
  - Linea costi fissi (orizzontale)
  - Linea ricavi (crescente)
  - Punto di intersezione evidenziato = Break Even
- KPI: Break Even mensile (€), Mesi per raggiungerlo al ritmo attuale, Margine di sicurezza %

**File 2: `js/modules/costi.js`**
Con `export async function init()` che:
- Carica i costi da Firestore e normalizza gli importi a mensile
- Legge i movimenti degli ultimi 6 mesi per calcolare il fatturato medio
- Calcola il break even e disegna il grafico con Chart.js da CDN
- CRUD costi con toast di conferma
- Aggiorna i calcoli in tempo reale dopo ogni modifica

**Regole obbligatorie:**
- Usa solo classi di `base.css`
- Icone SVG inline da `icons.js`
- Nessun dato hardcoded
- Commenti in italiano
- Chart.js caricato da CDN `cdnjs.cloudflare.com`


---

# ════════════════════════════════════════════════════════════
# PROMPT 6 — MODULO PROVVIGIONI
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `css/base.css` — classi: `.table-wrap`, `.badge`, `.btn`, `.modal`, `.form-control`, `.form-row`, `.kpi-grid`, `.kpi-card`, `.empty-state`
- `css/icons.js` — icone: percent, plus, edit, trash, check, euro, calendar, filter, download
- `js/utils.js` — `formatEuro`, `formatDate`, `toInputDate`, `toast`, `openModal`, `closeModal`, `initModalClose`, `confirmDelete`, `stateBadge`
- `js/firebase-config.js` — esporta `db`, `collections`, `toTimestamp`

**Struttura Firestore `provvigioni/{id}`:**
```
agente: string          (nome dell'agente/collaboratore)
importo: number
percentuale: number     (% applicata, opzionale)
contratto_ref: string   (ID contratto collegato, opzionale)
cliente: string         (nome cliente, per comodità)
data: Timestamp
stato: string           (da_pagare | pagata)
data_pagamento: Timestamp (solo se pagata)
note: string
createdAt: Timestamp
```

**Obiettivo di questa chat:**
Costruisci il modulo Provvigioni. Due file:

**File 1: `modules/provvigioni.html`**
- KPI: Totale provvigioni maturate YTD, Totale da pagare, Totale pagate YTD
- Filtri: ricerca per agente + chip Tutte/Da pagare/Pagate + selettore anno
- Tabella: agente, cliente/contratto, data, percentuale, importo, stato (badge), azioni
- Bottone "Nuova provvigione"
- Modal form: agente, cliente, contratto_ref (select dai contratti esistenti), data, percentuale, importo (calcolato automaticamente se inserisce % e importo contratto), stato, note
- Azione rapida "Segna come pagata" direttamente dalla tabella

**File 2: `js/modules/provvigioni.js`**
Con `export async function init()` che:
- Carica provvigioni e contratti da Firestore in parallelo
- Popola la select contratti nel form
- Calcolo automatico importo provvigione: quando si seleziona un contratto e si inserisce la %, calcola automaticamente l'importo
- Filtro e ricerca real-time lato client
- CRUD completo con toast
- Azione "Segna come pagata" aggiorna stato + data_pagamento su Firestore

**Regole obbligatorie:**
- Usa solo classi di `base.css`
- Icone SVG inline da `icons.js`
- Nessun dato hardcoded
- Commenti in italiano
- Gestione errori con `toast`


---

# ════════════════════════════════════════════════════════════
# PROMPT 7 — MODULO COMPENSI SOCI
# ════════════════════════════════════════════════════════════

Stiamo costruendo un gestionale web modulare per uso interno chiamato **Gestionale Strategica MNS**.

**Stack tecnico:**
- Frontend: HTML + CSS + Vanilla JS (ES Modules), nessun framework
- Database: Firebase Firestore (SDK v9 compat)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline
- Hosting: GitHub Pages

**File già esistenti nel progetto (non vanno riscritti):**
- `css/base.css` — classi: `.kpi-grid`, `.kpi-card`, `.table-wrap`, `.card`, `.badge`, `.btn`, `.modal`, `.form-control`, `.form-row`, `.empty-state`
- `css/icons.js` — icone: users, euro, percent, plus, edit, trash, check, calendar, download
- `js/utils.js` — `formatEuro`, `formatDate`, `formatPercent`, `toInputDate`, `toast`, `openModal`, `closeModal`, `initModalClose`, `confirmDelete`
- `js/firebase-config.js` — esporta `db`, `collections`, `toTimestamp`

**Strutture Firestore:**

`soci/{id}`:
```
nome: string
quota_percentuale: number   (es. 50 = 50%)
email: string
createdAt: Timestamp
```

`compensi/{id}`:
```
socio_ref: string           (ID documento socio)
socio_nome: string          (nome, per comodità)
importo: number
periodo: string             (es. "Gennaio 2025", "Q1 2025")
data_pagamento: Timestamp
stato: string               (da_pagare | pagata)
note: string
createdAt: Timestamp
```

**Obiettivo di questa chat:**
Costruisci il modulo Compensi Soci. Due file:

**File 1: `modules/compensi.html`**

*Sezione Soci:*
- Card per ogni socio con: nome, quota %, totale compensi percepiti YTD, totale da ricevere
- Bottone modifica quota (modal semplice)

*Sezione Compensi:*
- KPI: Totale compensi erogati YTD, Totale da erogare, Compenso medio mensile
- Filtri: select socio (Tutti / singolo socio) + selettore anno
- Tabella: socio, periodo, importo, data pagamento, stato (badge), azioni
- Bottone "Nuovo compenso"
- Modal form: select socio, importo, periodo, data pagamento, stato, note
- Suggerimento automatico importo: se inserisce il totale distribuibile, calcola automaticamente la quota di ogni socio in base alle percentuali

**File 2: `js/modules/compensi.js`**
Con `export async function init()` che:
- Carica soci e compensi da Firestore in parallelo
- Costruisce le card soci con i totali calcolati
- Suggerimento quota automatico nel form
- Filtro per socio e anno
- CRUD compensi con toast
- Aggiornamento KPI in tempo reale

**Regole obbligatorie:**
- Usa solo classi di `base.css`
- Icone SVG inline da `icons.js`
- Nessun dato hardcoded
- Commenti in italiano
- Gestione errori con `toast`


---

# ════════════════════════════════════════════════════════════
# PROMPT 8 — WEB APP MOBILE SOCI (ultima fase)
# ════════════════════════════════════════════════════════════

Stiamo costruendo la **web app mobile** per i soci del Gestionale Strategica MNS.
È una PWA (Progressive Web App) separata dal gestionale principale, accessibile solo ai soci autenticati.

**Stack tecnico:**
- PWA: HTML + CSS + Vanilla JS, installabile su iPhone e Android
- Database: Firebase Firestore (stesso progetto del gestionale)
- Autenticazione: Firebase Authentication (email + password)
- Font: Montserrat (Google Fonts)
- Icone: solo SVG inline

**Il gestionale principale ha già queste collezioni Firebase:**
- `soci` (nome, quota_percentuale, email)
- `compensi` (socio_ref, socio_nome, importo, periodo, stato)
- `movimenti` (tipo, importo, data, descrizione, categoria)
- `contratti` (cliente, valore, stato, data_fine)
- `conti` (nome, saldo)

**Struttura cartelle della web app (separata dal gestionale):**
```
app-soci/
├── manifest.json       ← rende la PWA installabile
├── sw.js               ← service worker per offline
├── index.html          ← login
├── app.html            ← app principale post-login
├── css/app.css         ← stile mobile-first
└── js/
    ├── auth.js
    ├── firebase-config.js  (stessa config del gestionale)
    └── app.js
```

**Obiettivo di questa chat:**
Costruisci la web app mobile soci. Deve mostrare (dopo login):

1. **Header**: logo Strategica, nome socio loggato, bottone logout
2. **Card benvenuto**: "Ciao [Nome], la tua quota è [X]%"
3. **KPI veloci** (4 card): Compensi YTD, Ultimo compenso, Fatturato mese, Contratti attivi
4. **Ultimi movimenti** (lista scrollabile, ultimi 10)
5. **Sezione compensi personali** (solo del socio loggato)

**Requisiti tecnici:**
- Mobile-first, ottimizzata per schermo 390px (iPhone 14)
- Installabile come app (manifest.json + service worker)
- Autenticazione: ogni socio vede solo i propri dati (email di login = email in `soci`)
- Funziona anche offline con i dati dell'ultima sincronizzazione
- Colori: `--primary #e6165c`, `--secondary #0f507b`, sfondo bianco
- Touch-friendly: bottoni min 44px, nessun hover-only

Guidami passo per passo e produci tutti i file necessari.

---

# ════════════════════════════════════════════════════════════
# PROMPT 9 — MANUALE UTENTE
# ════════════════════════════════════════════════════════════

Stiamo concludendo il **Gestionale Strategica MNS**, un gestionale web modulare per uso interno.

**Moduli completati:**
- Dashboard — KPI, grafici, ultimi movimenti
- Contratti — CRUD completo con stati e scadenze
- Incassi & Pagamenti — movimenti con IVA, filtri, export CSV
- IVA & Conti correnti — riepilogo IVA trimestrale, saldi conti
- Costi & Break Even — costi fissi/variabili, calcolo punto di pareggio
- Provvigioni — gestione agenti, calcolo automatico, pagamenti
- Compensi Soci — quote, compensi, distribuzione automatica
- Web App Mobile — PWA per soci con dati in tempo reale

**Obiettivo di questa chat:**
Crea il **manuale utente completo** del gestionale in formato HTML scaricabile (`manuale.html`), con:

1. **Introduzione**: cosa è il gestionale, come accedervi, struttura generale
2. **Guida per ogni modulo** (uno per uno):
   - A cosa serve
   - Come si usa (azioni principali passo per passo)
   - Screenshot descrittivi (usa tabelle/box HTML per simulare le schermate)
   - FAQ e casi d'uso comuni
3. **Amministrazione**:
   - Come aggiungere un nuovo modulo
   - Come cambiare logo/colori (modificare theme.js)
   - Come aggiungere un socio
   - Come fare backup dei dati Firestore
4. **Risoluzione problemi comuni**

**Stile del manuale:**
- Font Montserrat
- Colori: `#0f507b` per titoli, `#e6165c` per accenti
- Logo Strategica in cima
- Navigazione laterale con indice cliccabile
- Stampabile (CSS @media print)
- Professionale, linguaggio semplice, adatto a utenti non tecnici
