import { rom, powered, powerOn, romPressKey, romReleaseKey, usartReset, ROM_KEY_BYTE } from "./h8.js";
import { wire } from "./wire.js";
import { cassette, cassetteChanged } from "./cassette.js";
import { EXTENDED_BASIC_TAPE } from "./data/extended-basic-tape.js";

/* ===== Testprogramme: laufen ueber echte, zeitgesteuerte Tastendruecke =====
   Heathkit OP-Handbuch 595-2014-02, Seite 4-8. Die Initial Test Routine ist
   92 Bytes lang (Adresse 040100-040233) und enthaelt selbst die Rohdaten fuer
   die Lauftext-Meldung "your H8 IS UP And running" (siehe ROM_SEG in js/h8.js). */
export function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
const INITIAL_TEST_ROUTINE = [
  0o76,0o02,0o62,0o10,0o40,0o06,0o04,0o41,0o170,0o40,
  0o21,0o13,0o40,0o16,0o11,0o176,0o22,0o43,0o23,0o15,
  0o302,0o117,0o40,0o16,0o03,0o76,0o377,0o315,0o53,0o00,
  0o15,0o302,0o131,0o40,0o05,0o302,0o112,0o40,0o76,0o62,
  0o315,0o140,0o02,0o76,0o62,0o315,0o53,0o00,0o76,0o62,
  0o315,0o140,0o02,0o303,0o105,0o40,0o377,0o262,0o270,0o272,
  0o275,0o377,0o222,0o200,0o377,0o237,0o244,0o377,0o272,0o230,
  0o377,0o220,0o326,0o302,0o377,0o275,0o272,0o271,0o271,0o373,
  0o271,0o240,0o377,0o236,0o376,0o362,0o236,0o376,0o362,0o236,
  0o376,0o362
];

export function romPressAndRelease(byte, holdMs, gapMs){
  return new Promise(resolve=>{
    romPressKey(byte);
    setTimeout(()=>{
      romReleaseKey();
      setTimeout(resolve, gapMs);
    }, holdMs);
  });
}
async function romTypeDigits(digits, holdMs, gapMs){
  for(const d of digits) await romPressAndRelease(ROM_KEY_BYTE[d], holdMs, gapMs);
}
export async function romLoadExample(){
  if(!powered){ powerOn(); await delay(800); }
  await romPressAndRelease(ROM_KEY_BYTE.MEM, 60, 50);
  await romTypeDigits([0,4,0,0,0,0], 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 50);
  const bytes=[0o76,0o05,0o306,0o03,0o166]; // MVI A,5 ; ADI 3 ; HLT -> Adresse 040000
  for(const val of bytes){
    const digs=val.toString(8).padStart(3,'0').split('').map(Number);
    await romTypeDigits(digs, 60, 50);
  }
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 80);
  await romPressAndRelease(ROM_KEY_BYTE.REG, 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE[6], 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 50);
  await romTypeDigits([0,4,0,0,0,0], 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 50);
}
export async function romLoadInitialTestRoutine(){
  if(!powered){ powerOn(); await delay(800); }
  await romPressAndRelease(ROM_KEY_BYTE.MEM, 50, 40);
  await romTypeDigits([0,4,0,1,0,0], 50, 40);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 50, 40);
  for(const val of INITIAL_TEST_ROUTINE){
    const digs=val.toString(8).padStart(3,'0').split('').map(Number);
    await romTypeDigits(digs, 50, 40);
  }
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 50, 60);
  await romPressAndRelease(ROM_KEY_BYTE.REG, 50, 40);
  await romPressAndRelease(ROM_KEY_BYTE[6], 50, 40);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 50, 40);
  await romTypeDigits([0,4,0,1,0,0], 50, 40);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 50, 40);
}

// Selbst geschriebenes Demoprogramm (kein Original-Handbuchcode!) fuer die
// H9-Anbindung, diesmal aber auf den ECHTEN Ports der H8-5-Karte (Handbuch
// 595-2032-03, S.29/45/48): erst die Standard-USART-Initialisierung (Mode-
// Instruction 0116 oktal = 8 Bit/1 Stopbit/x16-Takt, danach eine Command-
// Instruction 065 oktal = TxEN+RxE+ER+RTS), dann eine Polling-Schleife,
// die das Statuswort an Port 373 auf RxRDY (Bit1) prueft, das Zeichen von
// Port 372 liest und sofort per OUT 372 zurueckschickt.
// WICHTIG (empirisch ermittelt): die Adresseingabe am Frontpanel behandelt die
// 6 Ziffern NICHT als eine fortlaufende oktale Zahl, sondern als zwei getrennte
// 3-stellige oktale BYTES (hi dann lo, je 000-377 gueltig) - "040300" ergibt
// also (040 oktal)*256+(300 oktal) = 0x20*256+0xC0 = 0x20C0, NICHT 0x40C0. Die
// Sprungziele unten sind entsprechend auf 0x20C0 (Schleifenanfang) gesetzt.
//   20C0: MVI A,0116 ; OUT 373 ; MVI A,065 ; OUT 373
//   20C8: IN 373 ; ANI 2 ; JZ 20C8 ; IN 372 ; OUT 372 ; JMP 20C8
// WICHTIG (per Live-Debugging gefunden, 11.09.2026): das Command-Byte darf
// NICHT das DTR-Bit (Bit1) setzen. usartReceive() loest bei gesetztem DTR pro
// empfangenem Byte einen echten RST-3-Interrupt (Vektor 030 oktal) aus - das
// ist PAM8s EIGENE, unveraenderte ROM-Routine fuer den Konsolen-Empfang, die
// dieses winzige Polling-Demo weder kennt noch erwartet. Da das Demo (anders
// als PAM8-Programme) nie einen eigenen Stack Pointer setzt, springt die Firmware-
// ISR beim RET auf einen undefinierten SP zurueck - beobachtet wurde ein Sprung
// zurueck an die Programmanfangsadresse 20C0, wodurch die Initialisierung ein
// zweites Mal mit bereits gesetztem expectMode=false laeuft und Mode-/Command-
// Byte im USART-Modell vertauscht + alle Enable-Bits geloescht werden (TxEN/RxE
// bleiben danach dauerhaft aus - erklärt frueheres Symptom: FULL DUPLEX zeigte
// nach dem ersten Tastendruck dauerhaft kein Echo mehr, HALBDUPLEX schien "OK"
// nur wegen des davon unabhaengigen lokalen Echos). Ohne DTR bleibt
// pendingRxInterrupt immer false, das Demo bleibt reines Polling ohne jeden
// Interrupt - genau wie dokumentiert.
const SERIAL_ECHO_DEMO = [
  0o076,0o116,0o323,0o373,0o076,0o065,0o323,0o373,
  0o333,0o373,0o346,0o002,0o312,0o310,0o040,
  0o333,0o372,0o323,0o372,0o303,0o310,0o040
];
// Laeuft gerade die Tastendruck-Kette des Echo-Demos? Siehe romLoadTapeAndGo.
let serialEchoTyping = false;
export async function romLoadSerialEcho(){
  serialEchoTyping = true;
  try{
    await romTypeSerialEcho();
  } finally {
    serialEchoTyping = false;
  }
}
async function romTypeSerialEcho(){
  if(!powered){ powerOn(); await delay(800); }
  await romPressAndRelease(ROM_KEY_BYTE.MEM, 60, 50);
  await romTypeDigits([0,4,0,3,0,0], 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 50);
  for(const val of SERIAL_ECHO_DEMO){
    const digs=val.toString(8).padStart(3,'0').split('').map(Number);
    await romTypeDigits(digs, 60, 50);
  }
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 80);
  await romPressAndRelease(ROM_KEY_BYTE.REG, 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE[6], 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 50);
  await romTypeDigits([0,4,0,3,0,0], 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE.ALTER, 60, 50);
  await romPressAndRelease(ROM_KEY_BYTE[4], 60, 50); // GO - Programm startet sofort
}
// Direktstart "Extended Benton Harbor BASIC": legt das echte Kassettenabbild
// (EXTENDED_BASIC_TAPE) auf das virtuelle Band und drueckt LOAD - dieselbe echte
// PAM8-ROM-Ladefunktion, die auch selbst gedumpte Baender liest (Sync-Byte-Suche,
// STX, Header, CRC-16, siehe Kommentar bei romIoIn/romIoOut in js/h8.js). Beim originalen DUMP-
// Vorgang wird laut Handbuch (595-2014-02, S.30 "Enter the entry point address in
// the PC register") die Einsprungadresse mit gesichert; PAM8s LOAD stellt sie beim
// Laden automatisch im PC-Register wieder her, weshalb laut Handbuch (S.31,
// "EXECUTING A SAVED PROGRAM") anschliessend GO ohne erneute Adresseingabe genuegt.
// Auf das Bandende wird gepollt (cassette.pos), statt eine feste Wartezeit zu
// raten, weil kein echtes UART-Timing nachgebildet wird (s. Kommentar in
// js/cassette.js) und die tatsaechliche Ladezeit deshalb von der ROM-eigenen Polling-Schleife
// abhaengt, nicht von einer festen Baudrate.
export async function romLoadExtendedBasic(){
  // BASIC hat einen eigenen, vollstaendigen Konsolentreiber. Falls zuvor manuell
  // das Echo-Demo geladen wurde (Button "Echo-Demo auf H8 neu laden"), laeuft es
  // als Endlosschleife weiter (kehrt nie von selbst zum Monitor zurueck), und die
  // sanfte romRegainMonitorControl() (die bewusst das RAM nicht loescht, siehe
  // Kommentar dort) setzt zwar die CPU-Register zurueck, aber NICHT den USART-
  // Zustand oder ein evtl. noch ausstehendes RST-3 (rom.pendingRxInterrupt) - live
  // beobachtet blieb der USART dadurch dauerhaft im Zustand des Echo-Demos haengen
  // und BASICs eigene Konsolen-Initialisierung kam nie zum Zug. Deshalb hier
  // vorsorglich denselben USART-/Interrupt-Reset wie in romDoReset().
  if(rom.cpu){ usartReset(rom.usart); rom.pendingRxInterrupt=false; wire.toH8.length=0; }
  await romLoadTapeAndGo(EXTENDED_BASIC_TAPE, 300);
  // Nach dem GO laeuft BASIC nachweislich (echter Code im RAM, PC verlaesst das
  // ROM) und wartet danach auf ein einzelnes Zeichen ueber die Konsole, um sich
  // mit Anmelde-Banner und seinem Prompt-Zeichen "*" zu melden - live verifiziert
  // fuer Issue #10.02.01 (siehe Kommentar in js/data/extended-basic-tape.js) sowie
  // gegen die identische Technik im Schwesterprojekt "h8-h9-emulator"
  // (github.com/rolandkirsche/h8-h9-emulator, dortige Funktion
  // bootBentonHarborBasic), das denselben einzelnen CR fuer die
  // nicht-erweiterte Benton-Harbor-BASIC-Variante verwendet.
  await delay(600);
  wire.toH8.push(0x0D);
}
// Bringt den Monitor in seinen Grundzustand zurueck, OHNE das RAM zu loeschen -
// im Unterschied zu romDoReset(), das fuer einen zuverlaessigen Kaltstart bewusst
// auch das RAM neu initialisiert (siehe Kommentar dort). Empirisch verifiziert:
// PAM8s LOAD-Kommando nimmt keine Tastendruecke mehr an, sobald ein Fremdprogramm
// (z.B. ein zuvor per GO gestartetes) die Foreground-Ausfuehrung uebernommen hat -
// ein reiner CPU-Register-Reset (wie ein "warmer" RESET am echten Geraet, laut
// Handbuch: "Reset laesst das RAM unangetastet") holt den Monitor zuverlaessig
// zurueck, ohne dabei etwas im RAM zu zerstoeren.
export function romRegainMonitorControl(){
  if(!rom.cpu) return;
  rom.cpu.reset();
  rom.cpu.pc = 0;
}
// Legt tapeBytes auf das virtuelle Band, drueckt LOAD und wartet per Polling auf
// cassette.pos, bis das Band vollstaendig gelesen ist (oder die Position sich
// maxIdleTicks*100ms lang nicht mehr bewegt), und drueckt danach GO. Grundlage
// fuer den BASIC-Direktstart, siehe romLoadExtendedBasic oben.
export async function romLoadTapeAndGo(tapeBytes, maxIdleTicks){
  // Falls der Nutzer gerade manuell das Echo-Demo laedt (Button "Echo-Demo auf H8
  // neu laden"), dessen Tastendruck-Kette erst zu Ende laufen lassen - sie teilt
  // sich mit unserer eigenen rom.keyByte und wuerde sich sonst mit unseren eigenen
  // Tastendruecken gegenseitig ueberschreiben.
  while(serialEchoTyping) await delay(150);
  if(!powered){
    powerOn();
    await delay(800);
  } else {
    romRegainMonitorControl();
    await delay(800); // nach PC=0 laeuft PAM8s RAM-Groessentest erneut, s. CLAUDE.md
  }
  cassette.data = tapeBytes.slice();
  cassette.pos = 0;
  cassetteChanged();
  await romPressAndRelease(ROM_KEY_BYTE.LOAD, 80, 60);
  let lastPos = cassette.pos, stableTicks = 0;
  for(let i=0; i<300 && stableTicks<maxIdleTicks && cassette.pos<cassette.data.length; i++){
    await delay(100);
    if(cassette.pos === lastPos) stableTicks++; else { stableTicks=0; lastPos=cassette.pos; }
  }
  // GO (Taste 4) startet nur zuverlaessig, wenn das Panel bereits im REG-Modus
  // die PC-Anzeige zeigt - sonst interpretiert PAM8 dieselbe Taste als "DE"
  // (Doppelbelegung "DE / GO"). Ohne dieses REG+6 davor haengt der GO-Druck vom
  // zufaelligen Vorzustand des Panels ab (live beobachtet: nach frischem
  // Kaltstart schlug er zuverlaessig fehl, PC blieb im Monitor stehen).
  await romPressAndRelease(ROM_KEY_BYTE.REG, 80, 60);
  await romPressAndRelease(ROM_KEY_BYTE[6], 80, 60);
  await romPressAndRelease(ROM_KEY_BYTE[4], 80, 60); // GO - startet ab der beim Laden wiederhergestellten PC-Adresse
}
