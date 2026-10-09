# Planimetrie — stato del lavoro (9 ottobre 2026)

Programma di disegno 2D per planimetrie, sul modello di DraftSight: stessi comandi, alias e tasti.
Web app (TypeScript + Vite), gira nel browser.

## Avvio

```
npm install
npm run dev        # apre su http://localhost:5173
npm test           # test unitari (33)
npm run e2e        # collaudo in Chrome: digita i comandi come un utente
```

## Fatto e verificato

- Disegno: LINEA, POLILINEA (con archi), RETTANGOLO, CERCHIO (centro/2P/3P), ARCO, TESTO, TRATTEGGIO (clic interno).
- Planimetria: MURO (spessore, giustificazione, angoli giuntati, innesti a T), PORTA, FINESTRA
  (aprono il muro, distanza dallo spigolo), LOCALE (clic dentro la stanza → superficie in m²).
- Quote: lineare, allineata, continua.
- Modifica: sposta, copia, ruota, specchio, scala, offset, taglia, estendi, raccorda, stira, unisci,
  esplodi, cancella, corrispondenza proprietà, grip, copia/incolla, annulla/ripristina.
- Riga di comando con alias DraftSight/AutoCAD, coordinate `x,y` `@dx,dy` `@d<a`, distanza diretta,
  Invio/Spazio ripete l'ultimo comando, opzioni cliccabili, autocompletamento.
- F3 snap ad oggetto, F7 griglia, F8 orto, F9 snap, F10 polare; selezione a finestra/intersezione.
- Pannelli Proprietà e Layer. Salvataggio .planim, salvataggio automatico nel browser.
- DXF: import ed export (R12), con unità, colori, layer, blocchi, quote.
- DWG: import tramite LibreDWG (WebAssembly, licenza GPL-3.0). Verificato che il modulo si carica
  in sviluppo e nella versione compilata e che un file rovinato dà un errore chiaro.
- Stampa: A4–A0, scala 1:1…1:5000 o adatta, cartiglio, spessori in mm, PDF dal browser.
  Verificata la scala esatta (500 cm a 1:100 = 50 mm) e il formato del PDF.

Collaudo nel browser: 58 controlli su 61 passano.

## Da fare

1. **Tre controlli del collaudo falliscono** (aggiunti per ultimi, non ancora indagati):
   - ESTENDI fino alla linea verticale (test e2e, sezione comandi di modifica);
   - clic destro come Invio durante LINEA;
   - Ctrl+C / Ctrl+V.
   Può essere il test o il programma: va guardato prima di correggere.
2. **Provare un DWG vero**: finora l'import DWG è provato solo con dati sintetici. Serve un file
   reale (meglio due: uno recente e uno vecchio).
3. Altezze predefinite di testi e quote pensate per 1:50: a 1:100 escono piccole (1,2 mm).
   Valutare 20 cm per i testi e 15 per le quote.
4. Non ancora fatti: SMUSSO (chamfer), SERIE (array), blocchi modificabili (oggi si importano
   come gruppi), ellissi e spline disegnabili, quote angolari e radiali, offset di polilinee con archi.
5. Un file `avvia.bat` per aprirlo con un doppio clic.
