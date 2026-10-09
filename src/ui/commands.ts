// Comandi e alias, come in DraftSight/AutoCAD (nomi inglesi e italiani).
import type { Host, Tool } from '../tools/base';
import { LineTool, PolylineTool, RectTool, CircleTool, ArcTool, TextTool, HatchTool } from '../tools/draw';
import { WallTool, DoorTool, WindowTool, RoomTool, DimTool, DimContinueTool } from '../tools/plan';
import {
  EraseTool, MoveTool, CopyTool, RotateTool, MirrorTool, ScaleTool, OffsetTool, TrimTool, ExtendTool, FilletTool,
  ExplodeTool, StretchTool, JoinTool, MatchPropTool,
} from '../tools/modify';
import { DistTool, AreaTool, IdTool, ListTool, ZoomTool, PanTool, PasteTool } from '../tools/misc';

export interface CmdDef {
  name: string;
  aliases: string[];
  label: string;
  group: 'Disegno' | 'Planimetria' | 'Modifica' | 'Quote' | 'Vista' | 'Informazioni' | 'File' | 'Impostazioni';
  make?: (h: Host) => Tool;
  /** azione dell'applicazione, per i comandi che non sono strumenti di disegno */
  action?: string;
  keys?: string;
}

export const COMMANDS: CmdDef[] = [
  { name: 'LINE', aliases: ['L', 'LINEA'], label: 'Linea', group: 'Disegno', make: h => new LineTool(h) },
  { name: 'PLINE', aliases: ['PL', 'POLYLINE', 'POLILINEA'], label: 'Polilinea', group: 'Disegno', make: h => new PolylineTool(h) },
  { name: 'RECTANGLE', aliases: ['REC', 'RECT', 'RECTANG', 'RETTANGOLO'], label: 'Rettangolo', group: 'Disegno', make: h => new RectTool(h) },
  { name: 'CIRCLE', aliases: ['C', 'CERCHIO'], label: 'Cerchio', group: 'Disegno', make: h => new CircleTool(h) },
  { name: 'ARC', aliases: ['A', 'ARCO'], label: 'Arco', group: 'Disegno', make: h => new ArcTool(h) },
  { name: 'TEXT', aliases: ['T', 'DT', 'MT', 'MTEXT', 'NOTE', 'TESTO'], label: 'Testo', group: 'Disegno', make: h => new TextTool(h) },
  { name: 'HATCH', aliases: ['H', 'BH', 'BHATCH', 'TRATTEGGIO'], label: 'Tratteggio', group: 'Disegno', make: h => new HatchTool(h) },

  { name: 'WALL', aliases: ['MURO', 'MU'], label: 'Muro', group: 'Planimetria', make: h => new WallTool(h) },
  { name: 'DOOR', aliases: ['PORTA', 'PO'], label: 'Porta', group: 'Planimetria', make: h => new DoorTool(h) },
  { name: 'WINDOW', aliases: ['FINESTRA', 'FI', 'WIN'], label: 'Finestra', group: 'Planimetria', make: h => new WindowTool(h) },
  { name: 'ROOM', aliases: ['LOCALE', 'LO', 'STANZA'], label: 'Locale (superficie)', group: 'Planimetria', make: h => new RoomTool(h) },

  { name: 'DIMLINEAR', aliases: ['DLI', 'DIMLIN', 'QL', 'QUOTA'], label: 'Quota lineare', group: 'Quote', make: h => new DimTool(h, false) },
  { name: 'DIMALIGNED', aliases: ['DAL', 'DIMALI', 'QA'], label: 'Quota allineata', group: 'Quote', make: h => new DimTool(h, true) },
  { name: 'DIMCONTINUE', aliases: ['DCO', 'DIMCONT', 'QC'], label: 'Quota continua', group: 'Quote', make: h => new DimContinueTool(h) },

  { name: 'ERASE', aliases: ['E', 'DELETE', 'CANCELLA'], label: 'Cancella', group: 'Modifica', make: h => new EraseTool(h), keys: 'Canc' },
  { name: 'MOVE', aliases: ['M', 'SPOSTA'], label: 'Sposta', group: 'Modifica', make: h => new MoveTool(h) },
  { name: 'COPY', aliases: ['CO', 'CP', 'COPIA'], label: 'Copia', group: 'Modifica', make: h => new CopyTool(h) },
  { name: 'ROTATE', aliases: ['RO', 'RUOTA'], label: 'Ruota', group: 'Modifica', make: h => new RotateTool(h) },
  { name: 'MIRROR', aliases: ['MI', 'SPECCHIO'], label: 'Specchio', group: 'Modifica', make: h => new MirrorTool(h) },
  { name: 'SCALE', aliases: ['SC', 'SCALA'], label: 'Scala', group: 'Modifica', make: h => new ScaleTool(h) },
  { name: 'OFFSET', aliases: ['O'], label: 'Offset', group: 'Modifica', make: h => new OffsetTool(h) },
  { name: 'TRIM', aliases: ['TR', 'TAGLIA'], label: 'Taglia', group: 'Modifica', make: h => new TrimTool(h) },
  { name: 'EXTEND', aliases: ['EX', 'ESTENDI'], label: 'Estendi', group: 'Modifica', make: h => new ExtendTool(h) },
  { name: 'FILLET', aliases: ['F', 'RACCORDA', 'RACCORDO'], label: 'Raccorda', group: 'Modifica', make: h => new FilletTool(h) },
  { name: 'STRETCH', aliases: ['S', 'STIRA'], label: 'Stira', group: 'Modifica', make: h => new StretchTool(h) },
  { name: 'EXPLODE', aliases: ['X', 'ESPLODI'], label: 'Esplodi', group: 'Modifica', make: h => new ExplodeTool(h) },
  { name: 'JOIN', aliases: ['J', 'UNISCI'], label: 'Unisci', group: 'Modifica', make: h => new JoinTool(h) },
  { name: 'MATCHPROP', aliases: ['MA', 'PAINTER', 'CORRISPONDENZA'], label: 'Corrispondenza proprietà', group: 'Modifica', make: h => new MatchPropTool(h) },
  { name: 'PASTECLIP', aliases: ['INCOLLA'], label: 'Incolla', group: 'Modifica', make: h => new PasteTool(h), keys: 'Ctrl+V' },
  { name: 'COPYCLIP', aliases: ['COPIAAPPUNTI'], label: 'Copia negli appunti', group: 'Modifica', action: 'copyclip', keys: 'Ctrl+C' },
  { name: 'CUTCLIP', aliases: ['TAGLIAAPPUNTI'], label: 'Taglia negli appunti', group: 'Modifica', action: 'cutclip', keys: 'Ctrl+X' },
  { name: 'UNDO', aliases: ['U', 'ANNULLA'], label: 'Annulla', group: 'Modifica', action: 'undo', keys: 'Ctrl+Z' },
  { name: 'REDO', aliases: ['RIPRISTINA'], label: 'Ripristina', group: 'Modifica', action: 'redo', keys: 'Ctrl+Y' },
  { name: 'SELECTALL', aliases: ['SELEZIONATUTTO'], label: 'Seleziona tutto', group: 'Modifica', action: 'selectall', keys: 'Ctrl+A' },

  { name: 'ZOOM', aliases: ['Z'], label: 'Zoom', group: 'Vista', make: h => new ZoomTool(h) },
  { name: 'ZOOMEXTENTS', aliases: ['ZE', 'ZOOMESTENSIONI'], label: 'Zoom estensioni', group: 'Vista', action: 'zoomext', keys: 'doppio clic rotella' },
  { name: 'PAN', aliases: ['P'], label: 'Pan', group: 'Vista', make: h => new PanTool(h), keys: 'trascina con la rotella' },
  { name: 'REGEN', aliases: ['RE', 'R', 'RIGENERA'], label: 'Rigenera', group: 'Vista', action: 'regen' },

  { name: 'DIST', aliases: ['DI', 'DISTANZA'], label: 'Distanza', group: 'Informazioni', make: h => new DistTool(h) },
  { name: 'AREA', aliases: ['AA'], label: 'Area', group: 'Informazioni', make: h => new AreaTool(h) },
  { name: 'ID', aliases: ['IDPOINT'], label: 'Coordinate di un punto', group: 'Informazioni', make: h => new IdTool(h) },
  { name: 'LIST', aliases: ['LI', 'LS', 'LISTA'], label: 'Lista', group: 'Informazioni', make: h => new ListTool(h) },

  { name: 'NEW', aliases: ['NUOVO'], label: 'Nuovo', group: 'File', action: 'new', keys: 'Ctrl+N' },
  { name: 'OPEN', aliases: ['APRI'], label: 'Apri (anche DXF e DWG)', group: 'File', action: 'open', keys: 'Ctrl+O' },
  { name: 'SAVE', aliases: ['QSAVE', 'SALVA'], label: 'Salva', group: 'File', action: 'save', keys: 'Ctrl+S' },
  { name: 'SAVEAS', aliases: ['SALVACOME'], label: 'Salva con nome', group: 'File', action: 'saveas', keys: 'Ctrl+Maiusc+S' },
  { name: 'IMPORT', aliases: ['IMPORTA', 'INSERT', 'I'], label: 'Importa DXF/DWG nel disegno', group: 'File', action: 'import' },
  { name: 'DXFOUT', aliases: ['EXPORT', 'ESPORTA', 'SAVEDXF'], label: 'Esporta DXF', group: 'File', action: 'dxfout' },
  { name: 'PRINT', aliases: ['PLOT', 'STAMPA'], label: 'Stampa', group: 'File', action: 'print', keys: 'Ctrl+P' },

  { name: 'LAYER', aliases: ['LA'], label: 'Layer', group: 'Impostazioni', action: 'layer' },
  { name: 'PROPERTIES', aliases: ['PR', 'PROPS', 'CH', 'PROPRIETA'], label: 'Proprietà', group: 'Impostazioni', action: 'properties', keys: 'Ctrl+1' },
  { name: 'SETTINGS', aliases: ['DS', 'OS', 'OSNAP', 'DSETTINGS', 'UNITS', 'UN', 'IMPOSTAZIONI', 'OPZIONI'], label: 'Impostazioni (snap, unità, valori)', group: 'Impostazioni', action: 'settings' },
  { name: 'HELP', aliases: ['?', 'AIUTO', 'COMANDI'], label: 'Elenco comandi', group: 'Impostazioni', action: 'help', keys: 'F1' },
];

const INDEX = new Map<string, CmdDef>();
for (const c of COMMANDS) {
  INDEX.set(c.name, c);
  for (const a of c.aliases) INDEX.set(a, c);
}

export function findCommand(s: string): CmdDef | undefined {
  return INDEX.get(s.trim().toUpperCase().replace(/^[_.'-]+/, ''));
}

/** Suggerimenti per l'autocompletamento della riga di comando. */
export function suggest(prefix: string, max = 8): { key: string; cmd: CmdDef }[] {
  const p = prefix.trim().toUpperCase();
  if (!p) return [];
  const out: { key: string; cmd: CmdDef }[] = [];
  const seen = new Set<CmdDef>();
  for (const [k, c] of INDEX) {
    if (k.startsWith(p) && !seen.has(c)) { out.push({ key: k, cmd: c }); seen.add(c); }
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.key.length - b.key.length);
}
