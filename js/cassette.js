import { beep } from './audio.js';

// Virtuelle Kassette: ein Byte-Array mit "Bandkopf"-Position. DUMP schreibt
// ab der aktuellen Position (wie beim Ueberspielen ab Bandkopf-Stellung),
// LOAD liest ab der aktuellen Position - exakt wie bei einem echten
// Kassettenrekorder. REWIND setzt die Position auf 0 zurueck, ohne die
// Aufnahme zu loeschen. Die Port-Anbindung (370/371 oktal) steht in js/h8.js.
// onChange: Anschlusspunkt fuer die Statusanzeige (siehe js/main.js).
export const cassette = { data: [], pos: 0, onChange: null };
export function cassetteChanged(){ if(cassette.onChange) cassette.onChange(); }
export function cassetteStatusText(){
  if(cassette.data.length===0) return 'Band: leer';
  return 'Band: ' + cassette.data.length + ' Byte, Position ' + cassette.pos
    + (cassette.pos < cassette.data.length ? ' (' + (cassette.data.length-cassette.pos) + ' Byte ungelesen)' : ' (Bandende)');
}
export function cassetteRewind(){ cassette.pos = 0; cassetteChanged(); beep('short'); }
export function cassetteEject(){ cassette.data = []; cassette.pos = 0; cassetteChanged(); beep('medium'); }
export function cassetteInsert(bytes){ cassette.data = Array.from(bytes); cassette.pos = 0; cassetteChanged(); }
