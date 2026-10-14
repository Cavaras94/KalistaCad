# KalistaCad

**Kalista** è un programma libero per disegnare planimetrie 2D: muri, porte, finestre, locali con la superficie, quote, retini, blocchi, stampa in scala e PDF. Si usa nel browser e non serve installarlo: c'è anche una versione da chiavetta, che si apre con un doppio clic e funziona senza Internet.

I comandi, gli alias e i tasti sono quelli di DraftSight e AutoCAD (L, PL, REC, M, CO, TR, OFFSET, F3, F8…), con i nomi anche in italiano (LINEA, MURO, PORTA, QUOTA…). Chi preferisce le finestre di dialogo può usarle; chi è abituato alla riga di comando può spegnerle in Impostazioni.

## Usarlo subito

**https://cavaras94.github.io/KalistaCad/**: si apre nel browser, senza scaricare niente.

Con Chrome o Edge lo si può anche **installare come app**: pulsante "Installa" nella barra dell'indirizzo (o menu ⋮ → "Installa Kalista"). Così ha la sua icona sul desktop e nel menu Start, si apre in una finestra propria, funziona anche senza Internet e i file `.kalista` (e DXF/DWG, con "Apri con") si aprono con un doppio clic. Gli aggiornamenti arrivano da soli: la versione nuova si scarica alla prima apertura con la rete e si usa da quella successiva.

I disegni restano sul computer di chi li fa: si salvano come file `.kalista`, niente viene mandato in rete.

## Cosa fa

- **Disegno**: linee, polilinee con archi, rettangoli, cerchi, archi, ellissi, spline, testi su più righe, retini (pieno, 45°, mattoni, listoni, spina di pesce, piastrelle, calcestruzzo, isolante…).
- **Planimetria**: muri con le misure interne, esterne o sull'asse, angoli e innesti giuntati, muri con il retino (per esempio il muretto tecnico); porte e finestre che aprono il muro e lo seguono; locali con la superficie in m².
- **Quote**: lineari, allineate, continue, dalla linea di base, raggio, diametro, angolari, direttrici. Di un muro si quota il filo, interno o esterno.
- **Modifica**: sposta, copia, ruota, specchio, scala, offset, taglia, estendi, raccorda, smusso, serie, stira, spezza, unisci, esplodi, grip, annulla e ripristina.
- **Blocchi**: crea, inserisci, modifica sul posto, rinomina.
- **File**: formato `.kalista`; import ed export DXF; import DWG (tramite LibreDWG).
- **Stampa**: fogli da A4 ad A0, scala esatta (1:50, 1:100…) o adattata, cartiglio, spessori di linea, PDF.

## Come si avvia

Serve [Node.js](https://nodejs.org/) (versione 20 o più recente).

```
npm install
npm run dev        # apre su http://localhost:5173
```

Su Windows basta un doppio clic su `avvia.bat`: la prima volta installa quello che serve, poi avvia il programma e apre il browser.

## Pubblicazione

A ogni push su `master` GitHub controlla i tipi, fa girare i test e pubblica la versione nuova su GitHub Pages (`.github/workflows/pages.yml`). Le icone dell'app sono in `public/` e si rifanno dal logo con `node scripts/icone.mjs`.

## Versione da chiavetta

```
npm run chiavetta
```

oppure doppio clic su `crea-chiavetta.bat`. Il risultato è la cartella `chiavetta/Kalista`: si copia così com'è su una chiavetta o su un computer, e il programma si apre con un doppio clic su `Kalista.html`. I due file della cartella devono restare insieme.

## Prove

```
npm test               # test unitari
npm run e2e            # collaudo in Chrome o Edge: digita i comandi come un utente
npm run e2e:chiavetta  # prepara la versione da chiavetta e la collauda aperta da disco
```

## Come è fatto

Web app in TypeScript con Vite, senza framework. Il disegno si fa su canvas, la stampa in SVG.

- `src/model`: entità, geometria, muri, operazioni di modifica, documento con annulla e ripristina
- `src/tools`: i comandi (uno strumento per comando)
- `src/view`: disegno a schermo, snap, selezione
- `src/ui`: interfaccia, riga di comando, pannelli, finestre di dialogo
- `src/io`: import ed export DXF/DWG, file `.kalista`
- `src/print`: impaginazione e stampa

`STATO.md` è il diario del lavoro: cosa c'è, cosa è stato provato, i difetti noti e le cose da fare.

## Contribuire

Segnalazioni, idee e modifiche sono benvenute: si può aprire una *issue* o proporre una *pull request*. Prima di proporre una modifica conviene far girare `npm test` e `npm run e2e`.

## Licenza

Copyright © 2026 Cavaras94 e chi ha contribuito.

Kalista è software libero: lo si può usare, studiare, modificare e ridistribuire secondo i termini della **GNU General Public License, versione 3 o successiva** (vedi il file [LICENSE](LICENSE)). Chi ridistribuisce il programma, anche modificato, deve farlo con la stessa licenza e insieme al codice sorgente.

Il programma è distribuito sperando che sia utile, ma **senza alcuna garanzia**.

Usa [LibreDWG](https://www.gnu.org/software/libredwg/) (GPL-3.0, tramite `@mlightcad/libredwg-web`) per leggere i file DWG e [dxf-parser](https://github.com/gdsestimating/dxf-parser) (MIT) per i DXF. AutoCAD e DraftSight sono marchi dei rispettivi proprietari: Kalista non ha legami con loro, ne riprende soltanto i comandi.
