# Kalista — stato del lavoro (12 ottobre 2026)

Kalista (prima si chiamava Planimetrie): programma di disegno 2D per planimetrie, sul modello di DraftSight: stessi comandi, alias e tasti.
Web app (TypeScript + Vite), gira nel browser.

## Avvio

```
npm install
npm run dev        # apre su http://localhost:5173
npm test           # test unitari (79)
npm run e2e        # collaudo in Chrome: digita i comandi come un utente
npm run chiavetta  # prepara la versione da chiavetta in chiavetta/Kalista
npm run e2e:chiavetta  # la prepara e la collauda aperta da disco, in Chrome e in Edge
```

## Fatto e verificato

- Disegno: LINEA, POLILINEA (con archi), RETTANGOLO, CERCHIO (centro/2P/3P), ARCO, ELLISSE (per asse o dal
  centro), SPLINE (per punti, aperta o chiusa), TESTO, TRATTEGGIO (clic interno).
- Blocchi: BLOCCO crea un blocco dalla selezione, INSERISCI lo mette dove serve con scala e rotazione,
  ESPLODI lo riapre. Si salvano nel file, si specchiano, possono contenere altri blocchi.
- Planimetria: MURO (spessore, giustificazione, angoli giuntati, innesti a T), PORTA, FINESTRA
  (aprono il muro, distanza dallo spigolo), LOCALE (clic dentro la stanza → superficie in m²).
- Quote: lineare, allineata, continua, raggio, diametro, angolare (fra due linee o su un arco).
  Altezza del testo: per tutte in Impostazioni, per la singola quota nel pannello Proprietà; il
  pennello (COPIA PROPRIETÀ, MA) la copia da una quota alle altre insieme a layer e colore.
- Unità: cambiandole in Impostazioni il disegno si converte e le misure reali restano le stesse
  (500 cm diventano 5 m, e si adeguano spessori, testi, griglia). All'import di DXF/DWG si sceglie
  l'unità del file vedendo quanto misurerebbe il disegno.
- Modifica: sposta, copia, ruota, specchio, scala, offset (anche di polilinee con archi), taglia, estendi, raccorda, stira, unisci,
  esplodi, smusso, serie rettangolare e polare, cancella, corrispondenza proprietà, grip, copia/incolla, annulla/ripristina.
- Riga di comando con alias DraftSight/AutoCAD, coordinate `x,y` `@dx,dy` `@d<a`, distanza diretta,
  Invio/Spazio ripete l'ultimo comando, opzioni cliccabili, autocompletamento.
- F3 snap ad oggetto, F7 griglia, F8 orto, F9 snap, F10 polare; selezione a finestra/intersezione.
- Pannelli Proprietà e Layer. Salvataggio .kalista (i vecchi .planim si aprono ancora), salvataggio automatico nel browser.
- DXF: import ed export (R12), con unità, colori, layer, blocchi, quote.
- DWG: import tramite LibreDWG (WebAssembly, licenza GPL-3.0). Verificato che il modulo si carica
  in sviluppo e nella versione compilata e che un file rovinato dà un errore chiaro.
  Provato dall'utente con un DWG vero scaricato (12 ottobre): si apre.
- Stampa: A4–A0, scala 1:1…1:5000 o adatta, cartiglio, spessori in mm, PDF dal browser.
  Verificata la scala esatta (500 cm a 1:100 = 50 mm) e il formato del PDF.

Collaudo nel browser: 88 controlli su 88 passano. Versione da chiavetta: 8 su 8 (Chrome ed Edge).

## Versioni

La versione è quella di `package.json` e compare in alto a sinistra accanto al nome (passandoci sopra
si legge anche la data), nella prima riga della riga di comando, in F1 e nel LEGGIMI della chiavetta.
Prima di distribuire una copia nuova: aumentare la versione in `package.json`, poi `crea-chiavetta.bat`.

- 0.2.0 (12 ottobre 2026): nome Kalista e logo; smusso, serie, quote raggio/diametro/angolare,
  ellisse, spline, blocchi, offset di polilinee con archi; cambio di unità che converte il disegno;
  scelta dell'unità all'import; altezza del testo per singola quota e pennello; versione da chiavetta.
- 0.1.0 (9 ottobre 2026): prima versione.

## Avvio rapido

- `avvia.bat`: per lavorare sul programma. Installa le dipendenze la prima volta, avvia e apre il browser.
- `crea-chiavetta.bat`: prepara `chiavetta/Kalista`, la cartella da copiare sulla chiavetta. Sui PC dei
  ragazzi basta un doppio clic su `Kalista.html`: niente installazione, niente rete. La cartella va
  rigenerata dopo ogni modifica al programma.

## Da fare

1. Blocchi: una finestra per modificarli sul posto, e l'elenco per rinominarli o eliminare quelli non
   usati. Oggi un blocco si modifica così: ESPLODI un inserimento, correggere, BLOCCO con lo stesso
   nome (chiede conferma e aggiorna tutti gli inserimenti).
2. I blocchi dei file DXF/DWG importati arrivano ancora come gruppi, non come blocchi di Kalista.
3. Ellissi e spline non si possono tagliare, estendere né fare in offset; ESPLODI le trasforma in
   polilinee, che invece sì. Mancano gli archi di ellisse disegnabili (quelli importati sono polilinee).
4. Un secondo DWG vero, di una versione vecchia (R14/2000), per confronto.

## Note

- Altezze predefinite: testi 20 cm, quote 15 cm (2 e 1,5 mm su carta a 1:100). Vale per i disegni
  nuovi; quelli già salvati tengono le loro impostazioni.
- Il collaudo si ferma con un errore se un clic cade fuori dall'area di disegno.
- Versione da chiavetta: una pagina aperta da disco non può caricare moduli né scaricare file, quindi
  tutto il programma sta dentro `Kalista.html` e il lettore DWG in `kalista-dwg.js`, caricato solo
  quando si apre un DWG. I due file devono restare nella stessa cartella.
- Le chiavi del salvataggio automatico nel browser si chiamano ancora `planimetrie.*`: cambiarle
  farebbe perdere il lavoro non salvato.
- Logo (fiammella blu con lancia) in `src/ui/logo.ts`; la stessa figura è l'icona della scheda in `index.html`.
- Blocchi: l'inserimento (`insert`) contiene solo nome, punto, scala e rotazione; il contenuto sta in
  `doc.blocks`. Per disegnare, stampare ed esportare gli inserimenti vengono aperti nel loro contenuto
  (`drawList` in `src/view/render.ts`), così ogni pezzo tiene il suo layer e colore; ciò che nel blocco
  sta sul layer 0 prende il layer dell'inserimento. L'export DXF scrive il contenuto, non il blocco.
- Nella riga di comando I e INSERT ora inseriscono un blocco, come in AutoCAD; per importare un
  DXF/DWG dentro il disegno c'è IMPORTA.
- Nel collaudo i clic di selezione vanno fatti da vicino: con lo zoom lontano cadono sui grip delle
  entità già selezionate.
- Unità dei file importati: l'unità dichiarata nei DWG è spesso sbagliata (dichiarano millimetri ma
  sono in metri o centimetri), per questo l'import la chiede sempre. La proposta iniziale è quella
  che dà al disegno la taglia di un edificio (fra 3 m e 1 km).
- 12 ottobre: corretto il pannello Proprietà, che toglieva gli zeri finali agli interi (40 mostrato
  come 4, un muro da 30 come 3).
