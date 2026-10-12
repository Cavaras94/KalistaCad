# Kalista — stato del lavoro (12 ottobre 2026)

Kalista (prima si chiamava Planimetrie): programma di disegno 2D per planimetrie, sul modello di DraftSight: stessi comandi, alias e tasti.
Web app (TypeScript + Vite), gira nel browser.

## Avvio

```
npm install
npm run dev        # apre su http://localhost:5173
npm test           # test unitari (99)
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

Collaudo nel browser: 94 controlli su 94 passano. Versione da chiavetta: 10 su 10 (Chrome ed Edge).

## Versioni

La versione è quella di `package.json` e compare in alto a sinistra accanto al nome (passandoci sopra
si legge anche la data), nella prima riga della riga di comando, in F1 e nel LEGGIMI della chiavetta.
Prima di distribuire una copia nuova: aumentare la versione in `package.json`, poi `crea-chiavetta.bat`.

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

## Da fare

Difetti noti, non ancora corretti:

1. Disegnare su un layer nascosto non avvisa: la linea viene creata ma non si vede. MURO, QUOTE e
   LOCALE scrivono sui loro layer anche se nascosti.
2. Numeri con la virgola: dove il comando aspetta un numero (raggio, angolo, spessore) `100,50` è
   letto come 100,5 e il programma lo dice; per un punto a quel passo serve un clic o `#x,y`. Dove
   aspetta un punto, `3,5` è il punto (3; 5) e non la distanza 3,5: lì i decimali vanno col punto.
3. LINEA [Annulla] dopo una modifica fatta dal pannello durante il comando annulla quella modifica.
4. STIRA sposta un arco solo se il suo centro è nel riquadro.
5. Import: cerchi ed ellissi con la normale verso -Z nei DXF (il lettore non la riporta); entità
   invisibili importate come visibili; unità in pollici o piedi trattate come non dichiarate.
6. Stampa: più spazi di seguito in un testo si fondono; testi lunghi escono dalle celle del cartiglio.
7. Porte e finestre non seguono il muro quando lo si sposta o lo si cancella.

Funzioni che mancano rispetto a DraftSight, in ordine di utilità per le planimetrie:

1. Snap digitati durante un punto (FIN, MED, INT, PER) e puntamento snap ad oggetto.
2. Zoom e pan dentro un comando (oggi Z annulla il comando in corso; la rotella funziona).
3. TAGLIA/ESTENDI con Maiusc per passare dall'uno all'altro, e su più entità con un riquadro.
4. Alla richiesta "Selezionare entità": TUTTO, Ultimo, Precedente.
5. POLIGONO, RETTANGOLO con dimensioni, SPEZZA, ALLUNGA, DIVIDI.
6. Modifica delle polilinee: aggiungere e togliere vertici, aprire e chiudere.
7. Quote dalla linea di base, direttrice con testo, stile delle quote (frecce o tratti).
8. Layer: eliminarne uno, rendere corrente quello dell'oggetto, isolarlo; tipo di linea e spessore
   per singola entità.
9. Blocchi: finestra per modificarli sul posto, rinominarli, eliminare quelli non usati; i blocchi
   dei DXF/DWG importati arrivano come gruppi. Oggi un blocco si modifica con ESPLODI, correzione e
   BLOCCO con lo stesso nome.
10. Ellissi e spline non si tagliano, estendono né si fanno in offset (ESPLODI le rende polilinee);
    archi di ellisse disegnabili.
11. Un secondo DWG vero, di una versione vecchia (R14/2000), per confronto.

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
- Nel collaudo i clic di selezione vanno fatti da vicino: con lo zoom lontano cadono sui grip delle
  entità già selezionate.
- Unità dei file importati: l'unità dichiarata nei DWG è spesso sbagliata (dichiarano millimetri ma
  sono in metri o centimetri), per questo l'import la chiede sempre. La proposta iniziale è quella
  che dà al disegno la taglia di un edificio (fra 3 m e 1 km).
- 12 ottobre: corretto il pannello Proprietà, che toglieva gli zeri finali agli interi (40 mostrato
  come 4, un muro da 30 come 3).
