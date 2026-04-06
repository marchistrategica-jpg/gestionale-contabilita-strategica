# Gestionale Strategica MNS

## Setup iniziale (da fare una volta sola)

### 1. Clona il repository
```bash
git clone https://github.com/TUO-USERNAME/gestionale-mns.git
cd gestionale-mns
```

### 2. Crea il progetto Firebase
1. Vai su [console.firebase.google.com](https://console.firebase.google.com)
2. Clic su **Aggiungi progetto** → dai un nome (es. `gestionale-mns`)
3. Disabilita Google Analytics (non serve) → **Crea progetto**
4. Dal menu laterale: **Firestore Database** → **Crea database** → Modalità produzione → Scegli la regione (europe-west6 = Zurigo, la più vicina)
5. Dal menu laterale: **Impostazioni progetto** (ingranaggio) → **Le tue app** → icona `</>` (Web) → Registra app → copia la config

### 3. Inserisci le credenziali Firebase
Apri `js/firebase-config.js` e sostituisci i valori con quelli copiati:
```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  ...
}
```

### 4. Lancia il seed del database
```bash
# Installa dipendenze
npm install firebase-admin

# Scarica Service Account Key:
# Firebase Console → Impostazioni → Account di servizio → Genera nuova chiave privata
# Salva il file come: firebase/serviceAccount.json

# Lancia il seed
node firebase/seed.js
```

### 5. Pubblica su GitHub Pages
```bash
git add .
git commit -m "Setup iniziale"
git push
```
In GitHub: Settings → Pages → Source: main branch → root `/` → Save

### 6. Personalizza il branding
Apri `config/theme.js` e modifica:
- `brand.logo` con il percorso del tuo logo
- `externalLinks` con gli URL dei gestionali commerciali
- Aggiorna i nomi dei soci in Firestore

---

## Struttura cartelle

```
/
├── config/theme.js     ← Brand, colori, menu (tocca solo questo per personalizzare)
├── css/
│   ├── base.css        ← Stili globali
│   └── icons.js        ← Libreria icone SVG
├── js/
│   ├── firebase-config.js
│   ├── router.js
│   ├── utils.js
│   └── modules/        ← JS specifico per ogni modulo
├── modules/            ← HTML di ogni sezione
├── firebase/
│   └── seed.js         ← Da lanciare una volta sola
└── index.html          ← Shell principale
```

## Aggiungere un nuovo modulo

1. Crea `modules/nuovo.html`
2. (Opzionale) Crea `js/modules/nuovo.js` con `export function init() { ... }`
3. Aggiungi nel menu in `config/theme.js`:
```js
{ id: 'nuovo', label: 'Nuova Sezione', icon: 'nome-icona', section: 'Categoria' }
```
4. Commit e push. Fine.
