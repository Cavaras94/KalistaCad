# Kalista — stato del lavoro (12 ottobre 2026)

Kalista (prima si chiamava Planimetrie): programma di disegno 2D per planimetrie, sul modello di DraftSight: stessi comandi, alias e tasti.
Web app (TypeScript + Vite), gira nel browser.

## Avvio

```
npm install
npm run dev        # apre su http://localhost:5173
npm test           # test unitari (148)
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

Collaudo nel browser: 133 controlli su 133 passano. Versione da chiavetta: 10 su 10 (Chrome ed Edge).

## Versioni

La versione è quella di `package.json` e compare in alto a sinistra accanto al nome (passandoci sopra
si legge anche la data), nella prima riga della riga di comando, in F1 e nel LEGGIMI della chiavetta.
Prima di distribuire una copia nuova: aumentare la versione in `package.json`, poi `crea-chiavetta.bat`.

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

1. Blocchi con attributi; libreria di blocchi pronti (sanitari, arredi) da cui pescare.
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
