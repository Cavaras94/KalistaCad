# Kalista — stato del lavoro (13 ottobre 2026)

Kalista (prima si chiamava Planimetrie): programma di disegno 2D per planimetrie, sul modello di DraftSight: stessi comandi, alias e tasti.
Web app (TypeScript + Vite), gira nel browser.

## Avvio

```
npm install
npm run dev        # apre su http://localhost:5173
npm test           # test unitari (168)
npm run e2e        # collaudo in Chrome: digita i comandi come un utente
npm run chiavetta  # prepara la versione da chiavetta in chiavetta/Kalista
npm run e2e:chiavetta  # la prepara e la collauda aperta da disco, in Chrome e in Edge
```

## Fatto e verificato

- Disegno: LINEA, POLILINEA (con archi), RETTANGOLO, CERCHIO (centro/2P/3P), ARCO, ELLISSE (per asse o dal
  centro), SPLINE (per punti, aperta o chiusa), TESTO, TRATTEGGIO (clic interno).
- Blocchi: BLOCCO crea un blocco dalla selezione, INSERISCI lo mette dove serve con scala e rotazione,
  ESPLODI lo riapre. Si salvano nel file, si specchiano, possono contenere altri blocchi.
  Selezionato, un blocco mostra il punto base (grip grande con la crocetta) da cui lo si sposta.
- Planimetria: MURO (spessore, giustificazione, riempimento con un retino, angoli giuntati, innesti
  a T), PORTA, FINESTRA (aprono il muro, distanza dallo spigolo), LOCALE (clic dentro la stanza →
  superficie in m²).
- Quote: lineare, allineata, continua, raggio, diametro, angolare (fra due linee o su un arco).
  Di un muro si quotano i fili, da spigolo a spigolo, non l'asse.
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

Collaudo nel browser: 214 controlli su 214 passano. Versione da chiavetta: 12 su 12 (Chrome ed Edge).

## Versioni

La versione è quella di `package.json` e compare in alto a sinistra accanto al nome (passandoci sopra
si legge anche la data), nella prima riga della riga di comando, in F1 e nel LEGGIMI della chiavetta.
Prima di distribuire una copia nuova: aumentare la versione in `package.json`, poi `crea-chiavetta.bat`.

- 0.4.5 (14 ottobre 2026): finestre di dialogo per i comandi (vedi "Versione 0.4.5" più sotto);
  MURO, tornando con un clic sul punto di partenza la stanza si chiude e l'ultimo angolo viene
  giuntato come gli altri (con le misure interne restava aperto); corretti i difetti trovati con una
  revisione delle 0.4.3–0.4.4.
- 0.4.4 (13 ottobre 2026): i muri si disegnano con le misure interne (prima sull'asse: una stanza
  disegnata 300 misurava 290 dentro) e la quota di un muro selezionato prende il filo dal lato in cui
  la si mette (vedi "Versioni 0.4.3 e 0.4.4" più sotto).
- 0.4.3 (13 ottobre 2026): tre richieste di chi lo usa (vedi "Versioni 0.4.3 e 0.4.4" più sotto): punto per
  spostare i blocchi, quote dei muri dai fili e non dall'asse, retini nuovi e muri con il retino.
- 0.4.2 (13 ottobre 2026): i muri dentro un blocco restano giuntati agli angoli e porte e finestre
  continuano ad aprirli (prima, creato il blocco, ogni muro tornava un rettangolo a sé).
- 0.4.1 (13 ottobre 2026): stampa di una finestra corretta (si stampa solo la finestra, adattata al
  foglio; si sceglie con due clic o trascinando) e stampa dei soli oggetti selezionati; icona del PAN
  (una mano) diversa da quella di SPOSTA; freccetta o clic destro su GRIGLIA, SNAP, POLARE ed ESNAP
  nella barra di stato per scegliere i tipi di snap, il passo dello snap (incremento del cursore),
  il passo della griglia e l'angolo polare senza aprire le Impostazioni.
- 0.4.0 (13 ottobre 2026): testi su più righe in un riquadro che cresce, cartiglio nuovo (Nome
  cliente, Posa gres, Note) salvato nel disegno, Nuovo da file base e Salva con nome in barra
  (vedi "Versione 0.4.0" più sotto).
- 0.3.0 (12 ottobre 2026): tutte le funzioni che mancavano rispetto a DraftSight e le richieste
  arrivate per mail (vedi "Versione 0.3.0" più sotto), poi una seconda revisione completa.
- 0.2.1 (12 ottobre 2026): correzioni dopo una revisione completa del codice (vedi "Revisione del 12
  ottobre" più sotto). Nessun comando nuovo.
- 0.2.0 (12 ottobre 2026): nome Kalista e logo; smusso, serie, quote raggio/diametro/angolare,
  ellisse, spline, blocchi, offset di polilinee con archi; cambio di unità che converte il disegno;
  scelta dell'unità all'import; altezza del testo per singola quota e pennello; versione da chiavetta.
- 0.1.0 (9 ottobre 2026): prima versione.

## Avvio rapido

- `avvia.bat`: per lavorare sul programma. Installa le dipendenze la prima volta, avvia e apre il browser.
- `crea-chiavetta.bat`: prepara `chiavetta/Kalista`, la cartella da copiare sulla chiavetta. Sui PC dei
  ragazzi basta un doppio clic su `Kalista.html`: niente installazione, niente rete. La cartella va
  rigenerata dopo ogni modifica al programma.

## Versione 0.4.5: finestre dei comandi

Richiesta di chi lo usa: le impostazioni dei comandi in finestre, non solo nella riga di comando.

- All'avvio si apre una finestra con i valori già compilati (gli ultimi usati); Invio = OK, Esc
  annulla il comando. Poi si disegna col mouse come prima.
  - MURO: spessore, su cosa cadono le misure, riempimento (riquadri con i retini disegnati).
  - TRATTEGGIO: retino (riquadri; doppio clic = sceglie e conferma), passo, angolo. L'opzione
    Pattern della riga di comando riapre la finestra.
  - INSERISCI: i blocchi del disegno come miniature, scala, rotazione.
  - PORTA e FINESTRA: larghezza del vano (una volta, all'avvio). TESTO: altezza, rotazione,
    allineamento; poi si clicca il punto e si scrive.
  - OFFSET (distanza o passante), RACCORDA (raggio, tutta la polilinea), SMUSSO (due distanze),
    SERIE (rettangolare o polare: la finestra mostra solo i campi del tipo scelto; per la polare si
    clicca poi il centro).
  - RUOTA e SCALA: dato il punto base, angolo o fattore nella finestra, con il pulsante "Col mouse"
    per farlo trascinando come prima.
- Le domande sì/no (ridefinire un blocco, salvare la modifica di un blocco, cancellare gli originali
  dello specchio, ruotare le copie della serie, eliminare un layer pieno) hanno una finestra con i
  pulsanti Sì e No. Chiudendola senza rispondere la domanda resta nella riga di comando.
- Ognuno sceglie come lavorare: prima voce delle Impostazioni, "Modo di lavorare": con le finestre
  (di partenza) o solo con la riga di comando, come in AutoCAD. È una preferenza del browser
  (`planimetrie.dialogs`), non del disegno.
  Le opzioni nella riga di comando funzionano anche con le finestre accese.
- Il collaudo (`npm run e2e`) le spegne all'inizio, perché dà i valori digitando, e le prova
  accese in una parte a sé; quello della chiavetta le prova accese.
- Codice: `withForm` e `askYesNo` in `src/tools/base.ts`, finestra generica `formDialog` in
  `src/ui/dialogs.ts` (numeri, scelte a pulsanti, riquadri con disegno, caselle; voci che si vedono
  solo con una certa scelta).

Revisione delle 0.4.3–0.4.4 (un revisore separato, ogni difetto riprodotto con un test). Corretti:

- OFFSET, TAGLIA nel mezzo e SPEZZA toglievano il retino ai muri che ne nascevano.
- MURO con le misure interne: i muri già fissati cambiavano lato muovendo il mouse, e premendo Invio
  si poteva ottenere un muro diverso dall'anteprima. Ora il lato lo decidono i punti già dati.
- Un percorso che tornava indietro su se stesso dava muri in diagonale: ora ogni tratto si sposta per
  conto suo e gli angoli si fanno dove i tratti si tagliano. Il cursore sull'ultimo punto non fa più
  sparire l'anteprima.
- Un muro di un tratto solo con le misure interne nasceva spostato di mezzo spessore: ora, se il
  percorso non gira, sta sull'asse.
- Muro con riempimento Pieno: un contorno in più nel DXF ed esplodendolo.
- In stampa le righe del retino dei muri prendevano lo spessore di linea del muro: ora sono sottili.

Restano (segnalati dalla revisione, non corretti):

- Esplodendo un muro con un retino il retino sparisce (restano i bordi).
- Il retino è ancorato all'origine del disegno: spostando un muro o un blocco, il disegno del retino
  scorre dentro il muro invece di muoversi con lui.

## Versioni 0.4.3 e 0.4.4: cosa c'è di nuovo

- **Blocchi, punto per spostarli**: il grip sul punto base ora è più grande e ha una crocetta. Se il
  punto base cade fuori dal disegno del blocco (blocchi importati da DWG/DXF, o creati dando un punto
  base lontano) compare un secondo grip al centro dell'ingombro: tutti e due spostano il blocco.
- **Muri con le misure interne** (0.4.4): MURO ora parte con "misure interne": i punti che si danno sono gli
  spigoli interni della stanza e lo spessore va verso l'esterno, in qualunque verso la si disegni
  (lo decide il verso in cui gira il percorso; un tratto solo vale come filo sinistro). Una stanza
  disegnata 300 × 200 misura 300 × 200 dentro. Prima le misure cadevano sull'asse e la stanza veniva
  più stretta di uno spessore. Opzione Giustificazione: Interne, Esterne, Centro (asse), Sinistra, Destra.
- **Quote dei muri**: QUOTA, Invio, clic su un muro misura il filo, da spigolo a spigolo, non più
  l'asse: l'interno o l'esterno secondo il lato in cui si mette la linea di quota (l'anteprima cambia
  passando da una parte all'altra). Quotando per punti, dove due muri fanno angolo lo snap preferisce
  gli spigoli che si vedono alla fine dell'asse, che lì è nascosta dentro lo spessore (l'asse si
  aggancia ancora andandoci sopra).
- **Retini**: in più doppie linee a 45° (muratura), listoni sfalsati, spina di pesce (con angolo 45°
  viene dritta), zig-zag (isolante), calcestruzzo. Le famiglie di righe ora si descrivono come nei
  file .pat dei CAD (`HATCH_FAMS` in `src/model/entities.ts`): aggiungerne uno è una riga.
- **Muri con il retino** (per esempio il muretto tecnico): MURO, opzione Riempimento, oppure
  "Riempimento" e "Passo retino" nel pannello Proprietà di un muro già fatto; il pennello (MA) li
  copia. Il muro si disegna e si stampa a righe al posto del riempimento pieno; passo predefinito un
  terzo dello spessore. Le righe sono solo disegno: non fanno da snap né da bordi di taglio, e nel DXF
  escono come linee.
- Menu della barra di stato (snap, griglia): Invio ed Esc valgono da subito; prima, per un istante
  dopo l'apertura, non venivano sentiti (il collaudo ci inciampava).

## Versione 0.4.0: cosa c'è di nuovo

- **Testi su più righe**: TESTO, DIRETTRICE e il doppio clic su un testo aprono un riquadro accanto al
  punto, che cresce in altezza e larghezza con quello che si scrive. Invio va a capo; Ctrl+Invio, OK
  o un clic fuori confermano; Esc annulla. Nel disegno si vede l'anteprima mentre si scrive. Non si
  scrive più `\n`. La prima riga resta sul punto cliccato e le altre scendono (`retext`).
  Nel pannello Proprietà il testo è una casella a più righe (vale uscendo dalla casella o con Ctrl+Invio).
- **Cartiglio**: tre voci, NOME CLIENTE, POSA GRES e NOTE; tolte scala, data, tavola e disegnatore.
  Caselle a più righe: gli a capo scritti restano, le righe lunghe vanno a capo da sole e se il testo
  è tanto il carattere si riduce per farlo stare nella casella (`fitCell`). Le scritte ora stanno nel
  disegno (`doc.cartiglio`) e si salvano con lui: ogni file ha le sue. Foglio, scala, colori e logo
  restano preferenze del browser.
- **File base**: NUOVODA (pulsante "Nuovo da un file base") apre un disegno come copia senza nome: al
  primo Salva viene chiesto il nome del file nuovo (proposto: il nome del cliente) e il file base non
  viene toccato. "Salva con nome" ha un pulsante in barra (prima solo Ctrl+Maiusc+S). Apri tiene il
  riferimento al file (dove il browser lo permette), così Salva riscrive quello senza chiedere dove.

## Versione 0.3.0: cosa c'è di nuovo

Richieste arrivate per mail:

- **RACCORDA e SMUSSO** ora lavorano anche sugli spigoli di rettangoli e polilinee (prima solo fra
  linee e muri, per questo "non funzionava"); opzione Polilinea per raccordare tutti gli spigoli.
- **AREA**: opzione Interno (un clic dentro la stanza, come LOCALE); Oggetto accetta anche ellissi,
  spline, tratteggi e immagini.
- **Retini**: pieno, 45°, incrociato, linee, quadretti, mattoni, tratteggiate, puntinato; passo e
  angolo si cambiano anche dopo, dal pannello Proprietà.
- **Immagini** (IMMAGINE): JPG e PNG nel disegno, che si spostano, ruotano, scalano e vanno in stampa;
  pulsante "Aggiungi logo" nel cartiglio della finestra di stampa.
- **Copia proprietà** (MA): opzione Impostazioni con le caselle per scegliere cosa copiare.
- **Blocchi**: MODBLOCCO li apre per modificarli sul posto, CHIUDIBLOCCO salva; RINOMINABLOCCO,
  ELIMINABLOCCHI; i blocchi dei DWG/DXF importati restano blocchi (quelli con attributi, in serie,
  con un colore proprio o con scale diverse nei due versi arrivano ancora come gruppi).
- **Quote**: stile a frecce o a tratti (Impostazioni), dalla linea di base (DBA), DIRETTRICE con testo.

Funzioni che mancavano rispetto a DraftSight:

- Porte e finestre seguono il muro (spostato, ruotato, allungato, tagliato) e spariscono con lui.
- Snap digitati durante un punto (FIN, MED, INT, PER, CEN, QUA, VIC, INS, NES): basta cliccare
  l'entità in un punto qualsiasi. Puntamento snap ad oggetto (F11): allineamento con i punti agganciati.
- Z, ZE e PAN dentro un comando non lo annullano.
- TAGLIA/ESTENDI: Maiusc scambia i due comandi; un clic a vuoto apre una linea di intercettazione.
- Alla richiesta di selezione: TUTTO, U (ultimo), P (precedente).
- POLIGONO, PUNTO, RETTANGOLO con Dimensioni, SPEZZA, ALLUNGA, DIVIDI, MISURA, EDITPL (vertici,
  apri e chiudi), arco di ellisse; LINEA con Invio riparte dall'ultimo punto.
- Layer: ELIMINALAYER (anche dal pannello), LAYERCORRENTE, ISOLA/ANNULLAISOLA, SPEGNILAYER,
  ACCENDILAYER; tipo di linea e spessore per singola entità; avviso se si disegna su un layer nascosto.
- Ellissi e spline si tagliano, estendono e fanno in offset (diventando polilinee).

## Da fare

Difetti noti:

1. Numeri con la virgola: dove il comando aspetta un punto, `2,40` è il punto (2; 40) e non la
   distanza 2,40 (in metri il programma lo fa notare e suggerisce `2.40`). Dove aspetta un numero,
   la virgola è quella dei decimali. È la convenzione di AutoCAD, ma in metri ci si casca.
2. Altezze predefinite di testi e quote (20 e 15 cm) pensate per piante a 1:100: in un locale
   piccolo o a 1:50 conviene ridurle da Impostazioni.
3. Le immagini stanno dentro il file del disegno: ogni copia ne porta una intera (per ripeterle
   conviene farne un blocco), e con immagini pesanti il salvataggio automatico nel browser si ferma
   (il programma avvisa).
4. Durante la modifica di un blocco non si eliminano layer e non si cambiano unità; le modifiche a
   colore o visibilità dei layer fatte lì non si annullano dopo CHIUDIBLOCCO.
5. Export DXF: le immagini non ci sono (il programma lo dice); blocchi, quote, muri e retini escono
   come linee sciolte; lo spessore per singola entità non c'è nel formato.
6. STIRA sposta un arco solo se il suo centro è nel riquadro. LINEA [Annulla] dopo una modifica fatta
   dal pannello durante il comando annulla quella modifica.
7. Import: cerchi con la normale verso -Z nei DXF; unità in pollici o piedi trattate come non
   dichiarate; i layout di stampa dei DWG (con i loro cartigli e loghi) non vengono letti.
8. AREA Oggetto su un locale va cliccata sull'etichetta; SPEZZA ed EDITPL prendono il punto del clic
   senza snap alla griglia.

Funzioni che mancano ancora:

0. Muri con le misure interne o esterne aggiunti in un secondo comando: per giuntarsi ai muri che
   ci sono già l'asse nuovo deve finire sull'asse di quelli, cosa che succede da sola solo con
   Giustificazione Centro. Servirebbe che MURO riconoscesse lo spigolo di un muro esistente.
1. Blocchi con attributi; libreria di blocchi pronti (sanitari, arredi) da cui pescare; un comando
   per cambiare il punto base di un blocco già fatto.
2. Stile delle quote più ricco (testo sopra o in linea, unità, tolleranze); quota ordinata.
3. Tratteggi associativi (che seguono il contorno quando lo si modifica).
4. Spessore di linea visibile per entità nel DXF; export DXF con blocchi e quote veri.
5. Un secondo DWG vero, di una versione vecchia (R14/2000), per confronto.

## Seconda revisione (versione 0.3.0)

Due revisioni del codice e una prova d'uso nel browser (un bagno 2,40 × 1,80 disegnato in metri e in
centimetri, poi impaginato), sulle novità della 0.3.0. Corretti 40 difetti, i più seri:

- tagliare o spezzare un muro cancellava le sue porte; allungarlo dall'inizio o cambiargli colore le spostava;
- nella modifica di un blocco: dopo 100 passi di annullamento il disegno poteva essere sostituito dal
  contenuto del blocco; cambio di unità e rinomine non valevano per il disegno in attesa; Ctrl+S
  diceva "Salvato" senza salvare il lavoro fatto nel blocco; l'export DXF esportava solo il blocco;
- PAN o ZOOM dentro un comando: Invio azzerava la selezione del comando in attesa;
- gli snap digitati funzionavano solo a pochi pixel dal punto cercato;
- le parole di snap venivano prese per opzioni (CEN per Centro, INT per Interno, FIN per Finestra);
- `N` + Invio a riposo apriva "Nuovo disegno";
- le immagini non si selezionavano cliccandoci sopra; i PNG pesanti gonfiavano il file;
- la griglia diventava tratteggiata se nel disegno c'era una linea tratteggiata;
- "Precedente" e ANNULLAISOLA ricordavano il disegno di prima dopo Nuovo o Apri;
- la distanza di porte e finestre "dallo spigolo" era contata dall'asse del muro, non dallo spigolo interno;
- retini a tratti su aree enormi generavano milioni di trattini; DIVIDI non aveva un limite;
- le quote corte avevano frecce e testo sovrapposti.

## Revisione del 12 ottobre (versione 0.2.1)

Tre revisioni del codice in parallelo (geometria, comandi e interfaccia, file e stampa), ciascun
difetto riprodotto con uno script prima di correggerlo. Corretti:

- Import DWG: entravano anche i layout di stampa (cartigli sovrapposti alla pianta); gli attributi
  dei blocchi diventavano "[object Object]" nell'origine, due volte; archi, polilinee e blocchi con
  normale -Z uscivano specchiati.
- Import DXF: testi "Adatta"/"Allinea" spostati; barre e graffe tolte dai testi semplici; colore
  vero ignorato quando c'era anche l'indice; DaLayer dentro un blocco prendeva il colore del blocco;
  tipi non letti (HATCH, LEADER, ATTRIB) spariti senza avviso; arco perso sui vertici doppi.
- Export DXF: nomi di layer con accenti rovinati; frecce piene delle quote esportate vuote.
- File: un disegno con più di circa 120.000 entità non si riapriva; il salvataggio automatico di un
  disegno troppo grande lasciava la copia vecchia senza avvisare.
- Stampa: errore se un'entità stava su un layer eliminato ("Elimina vuoti" non contava il contenuto
  dei blocchi); "Adatta al foglio" poteva tagliare di un soffio; data del cartiglio ferma al primo uso.
- Geometria: specchio dei testi dalla parte sbagliata; LOCALE e TRATTEGGIO non trovavano la stanza
  con un mobile a destra del clic; RACCORDA con raggio troppo grande rovesciava le linee; righe di
  tratteggio mancanti sui vertici; OFFSET oltre misura dava forme rovesciate; tagli persi
  sull'estremo iniziale degli archi; UNISCI non chiudeva i contorni di due pezzi; ESTENDI toglieva
  l'arco dal gruppo; le righe dei tratteggi facevano da bordi di taglio; tangenze false in metri.
- Comandi: RUOTA e SCALA con Riferimento applicavano subito il valore; SPOSTA/COPIA Spostamento con
  `@dx,dy` contava dall'ultimo punto; copia/incolla di soli cerchi, archi o testi finiva lontano;
  TAGLIA/ESTENDI [Annulla] annullava comandi precedenti; le copie restavano nel gruppo degli
  originali; Canc non funzionava con il cursore nella riga di comando; un riquadro di selezione
  aperto si chiudeva durante il comando successivo; passo del tratteggio e raggio del cerchio
  ignoravano impostazioni e cambio di unità; dopo Apri restava la selezione del disegno di prima;
  Ctrl+X cancellava anche dai layer bloccati; un clic durante la richiesta di spessore o larghezza
  lasciava MURO e PORTA a metà; Invio a metà comando lasciava la selezione; CERCHIO per tre punti
  allineati si bloccava; "si" non valeva per "Sì"; 150 decimali nelle quote bloccavano il disegno;
  una lettera con un menu del pannello attivo cambiava layer; Ctrl+S faceva perdere il comando in corso.

## Note

- App installabile (PWA, 14 ottobre 2026): online su https://cavaras94.github.io/KalistaCad/, pubblicata
  da GitHub Actions a ogni push su master (prima tsc e test unitari). Manifest e icone in `public/`
  (icone rifatte dal logo con `node scripts/icone.mjs`); service worker scritto dalla build
  (`vite.config.ts`, modello in `src/pwa/sw.template.js`) con l'elenco di tutti i file, LibreDWG
  compreso: dopo la prima apertura funziona senza rete. Una versione nuova si scarica da sola e si
  usa dalla riapertura successiva (il programma lo scrive nella riga di comando). Installata, apre
  .kalista/.dxf/.dwg con un doppio clic (`file_handlers` nel manifest, `launchQueue` in `main.ts`).
  Nella chiavetta il service worker non c'è (pagina aperta da disco) e i link al manifest si tolgono.
- Il collaudo, nella parte della versione compilata, imposta NODE_ENV=production: il server di
  sviluppo avviato prima lo lascia a development e la build verrebbe quella di sviluppo.
- Copia senza rete: le risposte si cercano ignorando l'intestazione Vary (`ignoreVary`), se no con
  certi server la copia c'è ma non viene trovata.

- Progetto pubblico e libero (14 ottobre 2026): https://github.com/Cavaras94/KalistaCad, licenza
  GPL-3.0 o successiva (file `LICENSE`). La scelta è obbligata da LibreDWG, che è GPL-3.0 ed è
  dentro la versione da chiavetta: chi la riceve ha diritto al sorgente. La chiavetta porta
  `LICENZA.txt` e nel LEGGIMI il link al sorgente. `README.md` è la presentazione per chi arriva su GitHub.

- Altezze predefinite: testi 20 cm, quote 15 cm (2 e 1,5 mm su carta a 1:100). Vale per i disegni
  nuovi; quelli già salvati tengono le loro impostazioni.
- Il collaudo si ferma con un errore se un clic cade fuori dall'area di disegno. Disegna i muri
  sull'asse (lo imposta all'inizio), perché le sue coordinate sono scritte così.
- Il controllo "modifica del testo: riga aggiunta sotto" del collaudo una volta non è passato
  e alla ripetizione sì: sembra una questione di tempi del riquadro di testo, da guardare.
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
- Modifica di un blocco sul posto: `doc.editing` tiene da parte il disegno vero mentre `doc.ents` è il
  contenuto del blocco; `toData` scrive sempre il disegno vero, con il blocco com'è in quel momento.
- Porte e finestre seguono i muri in `Doc.followWalls`, chiamata a ogni `edit`: decide guardando
  com'era il muro prima e com'è dopo; se l'apertura è stata toccata nella stessa modifica non interviene.
- Ordine con cui la riga di comando legge una risposta durante un comando: sigla esatta di un'opzione,
  parole di selezione (TUTTO, U, P), snap digitati, inizio dell'etichetta di un'opzione, comandi di vista
  (Z, ZE, PAN), numero, punto.
- Nel collaudo i clic di selezione vanno fatti da vicino: con lo zoom lontano cadono sui grip delle
  entità già selezionate.
- Unità dei file importati: l'unità dichiarata nei DWG è spesso sbagliata (dichiarano millimetri ma
  sono in metri o centimetri), per questo l'import la chiede sempre. La proposta iniziale è quella
  che dà al disegno la taglia di un edificio (fra 3 m e 1 km).
- 12 ottobre: corretto il pannello Proprietà, che toglieva gli zeri finali agli interi (40 mostrato
  come 4, un muro da 30 come 3).
