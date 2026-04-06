// ============================================================
// THEME.JS — File di configurazione centrale
// Per cambiare logo, colori, nome app o aggiungere voci al menu:
// modifica SOLO questo file.
// ============================================================

export const THEME = {

  // --- BRAND ---
  brand: {
    name: 'Strategica MNS',
    tagline: 'Gestionale interno',
    logo: 'assets/logo_Strategica.jpg',   // percorso logo | null = mostra solo testo
    logoAlt: 'Strategica — Analisi | Consulenza | AI',
    logoHeight: '44px'   // altezza massima del logo nella sidebar
  },

  // --- COLORI ---
  // Modifica qui per cambiare tema colori in tutta l'app
  colors: {
    primary:   '#e6165c',   // magenta — azioni principali, stati attivi
    primaryL:  '#ff3d7a',   // magenta chiaro — hover
    primaryD:  'rgba(230,22,92,0.09)',  // magenta sfumato — sfondi chip
    secondary: '#0f507b',   // blu scuro — header, testi importanti
    secondaryD:'rgba(15,80,123,0.10)',  // blu sfumato — hover righe
  },

  // --- LINK GESTIONALI ESTERNI ---
  // Appaiono come voci fisse in fondo alla sidebar
  externalLinks: [
    {
      label: 'Gestionale Commerciale 1',
      url:   'https://inserisci-url-qui.com',
      icon:  'external'
    },
    {
      label: 'Gestionale Commerciale 2',
      url:   'https://inserisci-url-qui.com',
      icon:  'external'
    }
  ],

  // --- MENU PRINCIPALE ---
  // Per aggiungere una voce: aggiungi un oggetto a questo array.
  // id        → corrisponde a modules/{id}.html
  // label     → testo visualizzato nel menu
  // icon      → nome icona (definita in css/icons.js)
  // section   → intestazione di sezione (null = nessuna)
  menu: [
    {
      id:      'dashboard',
      label:   'Dashboard',
      icon:    'dashboard',
      section: null
    },
    {
      id:      'contratti',
      label:   'Contratti',
      icon:    'contract',
      section: 'Gestione'
    },
    {
      id:      'incassi',
      label:   'Incassi & Pagamenti',
      icon:    'payment',
      section: 'Gestione'
    },
    {
      id:      'iva',
      label:   'IVA & Conti correnti',
      icon:    'bank',
      section: 'Contabilità'
    },
    {
      id:      'costi',
      label:   'Costi & Break Even',
      icon:    'chart',
      section: 'Contabilità'
    },
    {
      id:      'provvigioni',
      label:   'Provvigioni',
      icon:    'percent',
      section: 'Contabilità'
    },
    {
      id:      'compensi',
      label:   'Compensi Soci',
      icon:    'users',
      section: 'Soci'
    }
    // ↑ Aggiungi nuove voci qui sopra, rispettando il formato.
    // Esempio:
    // {
    //   id:      'nuova-sezione',
    //   label:   'Nuova Sezione',
    //   icon:    'nome-icona',
    //   section: 'Categoria'
    // }
  ]

}
