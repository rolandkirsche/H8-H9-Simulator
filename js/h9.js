import { beep } from "./audio.js";
import { wire } from "./wire.js";

/* ================= H9-TERMINAL (nach Original-Bedienungsanleitung 595-2017-03) =================
 * Das echte H9 ist reine TTL-/MSI-Logik ohne Mikroprozessor - es gibt keine Firmware,
 * die sich nachbauen liesse. Verhalten hier so genau wie im Original-Handbuch beschrieben
 * nachgebildet - werkseitig fest verdrahtete 12 Zeilen x 80 Zeichen (Handbuch S.32).
 * U.a. nur BACK SPACE,
 * BELL, LINE FEED und CARRIAGE RETURN haben ueberhaupt eine Wirkung - alle anderen der
 * 32 ASCII-Steuerzeichen (inkl. ESC) werden laut Handbuch S.8 weder dargestellt noch ins
 * Bild-RAM geschrieben, egal ob von der Tastatur oder ueber die Leitung. Pfeiltasten,
 * HOME und die Loeschfunktionen sind reine "Local Function Keys" ohne Sendewirkung
 * (Handbuch S.4). FULL DUPLEX, AUTO CARRY und SCROLL sind echte Kippschalter, deren
 * Handbuch-Grundstellung bei allen dreien "ausgerastet" ist (Handbuch S.5, S.7f) - SCROLL
 * startet hier abweichend davon bewusst eingerastet, siehe Kommentar bei h9.scroll unten.
 * KEIN Anspruch auf Bit-genaue
 * Schaltungssimulation; SHORT FORM, PLOT, BAUD RATE, OFF LINE, BREAK und XMIT PAGE aus
 * dem Original sind hier nicht nachgebildet. Die serielle H8-Seite nutzt die echten
 * Ports der H8-5-Karte (372/373 oktal, Konsolen-USART - siehe romIoIn/romIoOut in js/h8.js),
 * aber mit stark vereinfachtem 8251-Verhalten (kein Timing/Baudrate/Fehlererkennung).
 */
// Werkseitig fest verdrahtete H9-Zeilenzahl (TTL-/MSI-Logik, kein Software-Limit
// am Original) - siehe Handbuch S.32.
export const H9_COLS=80, H9_ROWS=12;
export let h9powered = false;
export const h9 = {
  buf:null, row:0, col:0, flashUntil:0,
  fullDuplex:false, // ausgerastet = Halbduplex/Lokal-Echo, die Grundstellung lt. Handbuch S.7
  autoCarry:false,  // ausgerastet = kein automatischer Zeilenumbruch, Grundstellung lt. Handbuch S.5
  // Bewusste Abweichung von der Handbuch-Grundstellung (dort ausgerastet, s.
  // history): auf Nutzerwunsch standardmaessig eingerastet, damit laengere
  // Sitzungen (z.B. Extended-BASIC-Ausgabe) nicht bei voller Seite in HOLD
  // SCREEN haengenbleiben. Der Schalter selbst bleibt ein echtes, frei
  // umschaltbares Original-Bedienelement - nur sein Startzustand ist hier
  // veraendert.
  scroll:true,
  hold:false,
  runHandle:null,
};
function h9ResetScreen(){
  h9.buf = new Uint8Array(H9_COLS*H9_ROWS).fill(0x20);
  h9.row=0; h9.col=0; h9.hold=false;
}
function h9ScrollUp(){
  h9.buf.copyWithin(0, H9_COLS, H9_COLS*H9_ROWS);
  h9.buf.fill(0x20, H9_COLS*(H9_ROWS-1));
}
function h9EraseToEndOfLine(){
  h9.buf.fill(0x20, h9.row*H9_COLS+h9.col, h9.row*H9_COLS+H9_COLS);
}
// ERASE PAGE loescht laut Handbuch S.4 die GESAMTE Seite (nicht nur ab Cursor) und
// setzt den Cursor auf Home zurueck - u.a. der Weg, HOLD SCREEN wieder zu verlassen.
function h9ErasePage(){
  h9.buf.fill(0x20);
  h9.row=0; h9.col=0; h9.hold=false;
}
function h9Bell(){
  h9.flashUntil = performance.now()+120;
  beep('short');
}
// RETURN bzw. empfangenes CR: Cursor an den Zeilenanfang der AKTUELLEN Zeile - laut
// Handbuch S.5 ausdruecklich KEIN Zeilenvorschub, das macht ausschliesslich LINE FEED/LF.
function h9CarriageReturn(){ h9.col=0; }
// LINE FEED bzw. empfangenes LF: eine Zeile weiter. Ist die Seite voll UND SCROLL nicht
// eingerastet, geht das Terminal laut Handbuch S.8 in HOLD SCREEN: Cursor springt auf
// Bildanfang und blinkt dort (siehe Cursor-Blink in h9Render), externe Eingaben werden
// ignoriert, bis SCROLL eingerastet oder ERASE PAGE gedrueckt wird.
function h9LineFeed(){
  if(h9.row < H9_ROWS-1){ h9.row++; return; }
  if(h9.scroll){ h9ScrollUp(); return; }
  h9.row=0; h9.col=0; h9.hold=true;
}
function h9PutChar(ch){
  h9.buf[h9.row*H9_COLS+h9.col]=ch;
  h9.col++;
  if(h9.col>=H9_COLS){
    if(h9.autoCarry){ h9.col=0; h9LineFeed(); }
    else h9.col=H9_COLS-1; // ohne AUTO CARRY bleibt der Cursor stehen und ueberschreibt (Handbuch S.5)
  }
}
// Nur diese vier der 32 ASCII-Steuerzeichen haben ueberhaupt eine Wirkung, gleichermassen
// von der Tastatur wie von der Leitung (Handbuch S.8, "CONTROL CHARACTERS"). Alle anderen,
// inkl. ESC, werden stillschweigend verworfen - nicht dargestellt, nicht gespeichert.
function h9ApplyByte(byte){
  if(byte===0x07){ h9Bell(); return; }
  if(byte===0x08){ if(h9.col>0) h9.col--; return; } // Back Space bewegt nur den Cursor, loescht nichts
  if(byte===0x0D){ h9CarriageReturn(); return; }
  if(byte===0x0A){ h9LineFeed(); return; }
  // RUBOUT/DEL (0x7F, alle Bits gesetzt): das Handbuch beschreibt fuer den Normalbetrieb
  // keine Bildschirmwirkung (nur im Plot-Modus taucht sein Bitmuster als Strich auf,
  // Handbuch S.6) - hier als destruktives Loeschen nachgebildet (Cursor zurueck + Zeichen
  // entfernen), da eine Taste, die sichtbar gar nichts tut, in der Praxis wie ein Fehler wirkt.
  if(byte===0x7F){ if(h9.col>0){ h9.col--; h9.buf[h9.row*H9_COLS+h9.col]=0x20; } return; }
  if(byte>=0x20 && byte<=0x7E){ h9PutChar(byte); return; }
}

// Weisser P4-Phosphor (Handbuch S.32: "12" diagonal, P4 phosphor"), nicht gruen wie
// spaetere Heath-Terminals.
const H9_FG='#eef1ea', H9_BG='#07080a', H9_CELL_W=9, H9_CELL_H=18, H9_SCALE=2;
let h9Canvas=null, h9Ctx=null;
export function h9AttachCanvas(canvas){
  h9Canvas = canvas;
  h9Ctx = canvas.getContext('2d');
}
export function h9Render(){
  if(!h9Ctx) return;
  const ctx=h9Ctx;
  const w=H9_COLS*H9_CELL_W*H9_SCALE, h=H9_ROWS*H9_CELL_H*H9_SCALE;
  if(h9Canvas.width!==w || h9Canvas.height!==h){ h9Canvas.width=w; h9Canvas.height=h; }
  const flashing = h9.flashUntil>performance.now();
  ctx.shadowBlur=0;
  ctx.fillStyle = flashing ? H9_FG : H9_BG;
  ctx.fillRect(0,0,w,h);
  if(!h9powered || !h9.buf) return;
  ctx.font = Math.round(H9_CELL_H*H9_SCALE*0.72)+'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline='middle';
  ctx.fillStyle = flashing ? H9_BG : H9_FG;
  ctx.shadowColor = H9_FG;
  ctx.shadowBlur = 3;
  for(let r=0;r<H9_ROWS;r++){
    for(let c=0;c<H9_COLS;c++){
      const ch=h9.buf[r*H9_COLS+c];
      if(ch===0x20) continue;
      // Der Zeichengenerator kennt nur Grossbuchstaben (Handbuch S.32) - vom Rechner
      // empfangene Kleinbuchstaben werden zwar gespeichert, aber wie Grossbuchstaben
      // dargestellt (Handbuch S.6).
      ctx.fillText(String.fromCharCode(ch).toUpperCase(), c*H9_CELL_W*H9_SCALE, r*H9_CELL_H*H9_SCALE+H9_CELL_H*H9_SCALE/2);
    }
  }
  if(Math.floor(performance.now()/500)%2===0){
    ctx.shadowBlur=0;
    ctx.globalAlpha=0.5;
    ctx.fillStyle=H9_FG;
    ctx.fillRect(h9.col*H9_CELL_W*H9_SCALE, h9.row*H9_CELL_H*H9_SCALE, H9_CELL_W*H9_SCALE, H9_CELL_H*H9_SCALE);
    ctx.globalAlpha=1;
  }
}
function h9RunLoop(){
  function frame(){
    if(!h9powered){ h9.runHandle=null; return; }
    // HOLD SCREEN: externe Eingaben (seriell/parallel) werden verworfen, bis SCROLL
    // eingerastet oder ERASE PAGE gedrueckt wird (Handbuch S.8).
    if(h9.hold) wire.toH9.length=0;
    else while(wire.toH9.length) h9ApplyByte(wire.toH9.shift());
    h9Render();
    // setTimeout statt requestAnimationFrame - siehe Kommentar in romRunLoop:
    // rAF wird in einem Hintergrund-Tab ausgesetzt, setTimeout nur gedrosselt.
    h9.runHandle=setTimeout(frame, 16);
  }
  h9.runHandle = setTimeout(frame, 16);
}
function h9PowerOn(){
  h9ResetScreen(); h9.flashUntil=0;
  h9RunLoop();
}
function h9PowerOff(){
  if(h9.runHandle){ clearTimeout(h9.runHandle); h9.runHandle=null; }
  h9Render();
}
// Liefern den neuen Schalterzustand zurueck; die Schalter-Optik setzt js/main.js.
export function h9TogglePower(){
  h9powered = !h9powered;
  if(h9powered){ h9PowerOn(); beep('medium'); }
  else { h9PowerOff(); }
  return h9powered;
}
export function h9ToggleMode(flag){
  h9[flag] = !h9[flag];
  if(flag==='scroll' && h9.scroll) h9.hold=false; // SCROLL einrasten beendet HOLD SCREEN
  return h9[flag];
}

// "Local Function Keys" (Handbuch S.4): Pfeiltasten, HOME und die Loeschfunktionen
// wirken NUR lokal auf die Anzeige und senden nichts ueber die Leitung.
export const H9_LOCAL_KEYS = {
  'ArrowUp':   ()=>{ if(h9.row>0) h9.row--; },
  'ArrowDown': ()=>{ if(h9.row<H9_ROWS-1) h9.row++; },
  'ArrowLeft': ()=>{ if(h9.col>0) h9.col--; },
  'ArrowRight':()=>{ if(h9.col<H9_COLS-1) h9.col++; },
  'Home':      ()=>{ h9.row=0; h9.col=0; },
  'End':       ()=>{ h9EraseToEndOfLine(); },   // ERASE EOL
  'PageDown':  ()=>{ h9ErasePage(); },          // ERASE PAGE
};
// Sendende Sondertasten. Eine eigene RUBOUT/DEL-Taste (0x7F) gehoert laut Handbuch
// (S.6, Pictorial 1-3) zur normalen 52-Tasten-ASCII-Tastatur; eine eigene BACK-SPACE-
// Taste gibt es dagegen NICHT - BS entsteht ausschliesslich ueber STRG+H (Handbuch S.8).
// Die PC-Tasten Rueckschritt/Entf werden hier ergonomisch auf RUBOUT gelegt.
const H9_TX_KEYS = {
  'Enter':[0x0D], 'Escape':[0x1B], 'Backspace':[0x7F], 'Delete':[0x7F],
};
export function h9KeyToBytes(e){
  if(e.ctrlKey && e.key.length===1){
    const c = e.key.toUpperCase().charCodeAt(0);
    if(c>=0x40 && c<=0x5F) return [c & 0x1F]; // Strg+Buchstabe/Sonderzeichen, z.B. Strg+H = BS
  }
  if(H9_TX_KEYS[e.key]) return H9_TX_KEYS[e.key];
  // Das H9 kann von der Tastatur laut Handbuch (S.4/S.6) KEINE Kleinbuchstaben erzeugen -
  // die Tastaturelektronik verschiebt automatisch auf Grossbuchstaben.
  if(e.key.length===1) return [e.key.toUpperCase().charCodeAt(0) & 0x7F];
  return null;
}
export function h9SendKeyBytes(bytes){
  if(!h9powered) return;
  for(const b of bytes){
    wire.toH8.push(b & 0xFF);
    // Halbduplex (Grundstellung, FULL-DUPLEX-Taste ausgerastet): sofortes Lokal-Echo,
    // unabhaengig davon, ob und wie der Rechner antwortet (Handbuch S.7).
    if(!h9.fullDuplex) h9ApplyByte(b & 0xFF);
  }
  beep('short');
}
