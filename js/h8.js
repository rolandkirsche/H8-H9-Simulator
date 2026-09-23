/* ================= H8 MIT ECHTEM PAM8-ROM (Heath 444-13) =================
   8080A + 64K RAM + Original-ROM, Frontpanel-Ports 360/361 und die H8-5-Karte
   (Konsolen-USART 372/373, Kassetten-USART 370/371). Kein DOM-Zugriff: die
   Anzeige haengt sich ueber rom.onRender/rom.onPowerChange an (js/panel.js). */
import { CPU } from "./cpu.js";
import { PAM8_ROM } from "./data/pam8-rom.js";
import { beep } from "./audio.js";
import { wire } from "./wire.js";
import { cassette, cassetteChanged } from "./cassette.js";

// Rohe Bus-Werte fuer IN 360 je Taste, aus RCK-Tabelle im Original-Quelltext.
export const ROM_KEY_BYTE = {
  0:0xFE, 1:0xFC, 2:0xFA, 3:0xF8, 4:0xF6, 5:0xF4, 6:0xF2, 7:0xF0,
  LOAD:0xEF, DUMP:0xCF, PLUS:0xAF, MINUS:0x8F, CANCEL:0x6F, ALTER:0x4F, MEM:0x2F, REG:0x0F
};
const ROM_NO_KEY = 0xFF;
const ROM_RTM_BYTE = 0x2E; // Wired-AND von MEM(0x2F) und Taste 0(0xFE) auf dem Tastaturbus

// Segment-Dekodierung Port 361, empirisch bestaetigt (aktiv-low, Bit0=g..Bit6=f).
// Bit 7 traegt ausschliesslich den Dezimalpunkt (siehe DOD-Routine im Original-
// Quelltext) und hat nichts mit dem Zeichen selbst zu tun - deshalb hier NUR
// ueber die maskierten 7 Segmentbits nachschlagen. Ziffer "5" und Buchstabe "S"
// leuchten auf einem 7-Segment-Display identisch (0x24 maskiert); ein Byte mit
// gesetztem Punkt-Bit (z.B. 0xA4 = "5" mit Punkt) darf deshalb nicht mit dem
// vollstaendigen, ungemaskierten Byte gegen die Buchstabentabelle abgeglichen
// werden - das fuehrte bei der Adresse ...105 faelschlich zu "S" statt "5".
const ROM_SEG = {
  0x01:'0',0x73:'1',0x48:'2',0x60:'3',0x32:'4',0x24:'5',0x04:'6',0x71:'7',0x00:'8',
  0x18:'P',0x10:'A',0x1c:'F',0x06:'b',0x0d:'C',0x42:'d',0x0c:'E',0x12:'H',0x0f:'L',0x4e:'c',
  // Zusaetzliche Kleinbuchstaben, aus der "Initial Test Routine" (Handbuch S.4-8, Lauftext
  // "your H8 IS UP And running") direkt aus der 36-Byte-Nachrichtentabelle im Testprogramm
  // (Adresse 040100+0x38) dekodiert, Zeichen fuer Zeichen ueber den Wortkontext verifiziert:
  0x38:'o', 0x3a:'u', 0x3d:'r', 0x1f:'I', 0x39:'n', 0x7b:'i', 0x20:'g',
  // "n" in "And" nutzt ein ANDERES Muster (ceg) als die drei "n" in "running" (abf) -
  // eigener Eintrag noetig, da beide auf dasselbe Zeichen "n" abgebildet werden sollen,
  // aber unterschiedliche Segmente zeigen muessen (siehe SEGMENTS-Tabelle, dort als 'N').
  0x56:'N',
  // Drei-Zeichen-Pfeilmuster ("⊢⊣"-artig, lt. Handbuch), das die Meldung abschliesst:
  0x1e:'[', 0x7e:'-', 0x72:']'
};
export function decodeRomSeg(byte){
  const core = byte & 0x7f;
  return ROM_SEG[core]!==undefined ? ROM_SEG[core] : ' ';
}

export let powered = false;
export const rom = {
  cpu:null, mem:null,
  digitSel:0, display:new Uint8Array(10).fill(0x7f), speakerOn:false,
  keyByte: ROM_NO_KEY, keyHoldTimer:null,
  runHandle:null, stepCounter:0,
  ionSeen:false, userSeen:false,
  // Konsolen-USART-Register (Intel 8251) + Merker fuer den ausstehenden
  // RST-3-Empfangsinterrupt - siehe Kommentar bei romIoIn/romIoOut unten.
  usart:{mode:0,cmd:0,expectMode:true,rbr:0,rxReady:false,overrunErr:false,txEnabled:false,rxEnabled:false,dtr:false},
  pendingRxInterrupt:false,
  // Anschlusspunkte fuer die Frontpanel-Anzeige (js/panel.js), analog zu cpu.onIn/onOut.
  onRender:null, onPowerChange:null,
};

// Serielle H8-Seite fuer die H9-Anbindung UND die virtuelle Kassette: die
// echten Ports der Heathkit H8-5 "Serial I/O and Cassette Interface Card"
// (Handbuch 595-2032-03, S.29 "Port Select"): Die Standard-Jumperung der
// Karte - "used by the Heath software" - legt den Kassetten-USART auf Port
// 370/371 oktal und den KONSOLEN-USART auf Port 372/373 oktal.
// Beide USART-Ports der Karte sind Intel-8251-Register: das GERADE Portbyte
// ist der Datenport, das UNGERADE nimmt Mode-/Command-Bytes an und liefert
// das Statuswort (S.45/48 des Handbuchs). Fuer die Kassette (370/371) reicht
// die reine Statusbit-Nachbildung, weil PAM8s LOAD/DUMP dort per Polling
// arbeitet - siehe Absatz unten. Die KONSOLE (372/373) bildet dagegen das
// 8251 vollstaendig nach (Mode-/Command-Byte-Auswertung, RxRDY/TxRDY/TxE
// aus echten Enable-Bits, siehe usartOut/usartStatus): PAM8s Konsolen-
// Eingaberoutine wartet naemlich NICHT per Port-Polling auf ein Zeichen,
// sondern auf ein RAM-Flag, das erst eine eigene Interrupt-Routine auf
// RST 3 (Vektor 030 oktal = 0x18) setzt - getrennt vom periodischen
// Tastenfeld-Interrupt (RST 1, 0x08). Ohne diesen zweiten Interrupt (frueherer
// Stand dieser Datei) haengt jedes Programm, das echte Zeichen ueber die
// Konsole empfaengt (z.B. Benton Harbor BASIC), in dieser Warteschleife fest,
// auch wenn Zeichen im Byte-Puffer bereitstehen. Verifiziert per Cross-Check
// gegen eine zweite, unabhaengige Nachbildung (github.com/rolandkirsche/
// h8-h9-emulator), die echte BASIC-Kassetten nachweislich zum Laufen bringt.
// Die Kassette selbst (Port 370/371) ist KEIN selbst erfundenes Format: LOAD
// und DUMP sind die echten PAM8-ROM-Routinen (Heath 595-2348 Listing, S.1-18
// bis 1-48) - Sync-Byte-Suche, STX, Header und CRC-16 werden vollstaendig
// vom Original-ROM erzeugt bzw. geprueft. Die Simulation liefert dafuer nur
// den Byte-Transport (virtuelles Band = ein Byte-Array mit Bandkopf-Position,
// s. js/cassette.js) - Sync/CRC/Fehlerbehandlung laufen echt im ROM.
export function usartReset(u){
  u.mode=0; u.cmd=0; u.expectMode=true;
  u.rxReady=false; u.rbr=0; u.overrunErr=false;
  u.txEnabled=false; u.rxEnabled=false; u.dtr=false;
}
function usartStatus(u){
  let s=0x80; // Bit7 (DSR) liegt am H8-5 fest auf bereit.
  if(u.txEnabled){ s|=0x01; s|=0x04; } // TxRDY/TxE erst nach Enable im Command-Byte.
  if(u.rxReady) s|=0x02; // RxRDY
  if(u.overrunErr) s|=0x10;
  return s;
}
function usartIn(port){
  const u = rom.usart;
  if(port===0xFA){ u.rxReady=false; return u.rbr; }
  return usartStatus(u);
}
function usartOut(port,val){
  const u = rom.usart;
  if(port===0xFA){ if(u.txEnabled) wire.toH9.push(val & 0xFF); return; } // Konsolen-USART: Datenport
  // Port 373 oktal: erstes Byte nach Reset ist das Mode-Byte, danach folgen
  // Command-Bytes (Bit0 TxEN, Bit1 DTR, Bit2 RxE, Bit4 ER, Bit6 Internal
  // Reset - echte 8251-Belegung). Bit6 setzt die Mode-Erwartung zurueck,
  // wie im Original nach einem Command-Reset.
  if(u.expectMode){ u.mode = val; u.expectMode = false; return; }
  u.cmd = val;
  u.txEnabled = !!(val & 0x01);
  u.dtr = !!(val & 0x02);
  u.rxEnabled = !!(val & 0x04);
  if(val & 0x10) u.overrunErr = false;
  if(val & 0x40){ u.expectMode = true; u.txEnabled = false; u.rxEnabled = false; u.dtr = false; }
}
// Von der H9-Tastatur (wire.toH8, s. h9SendKeyBytes) oder programmgesteuert
// (z.B. die Leerzeichen-Erkennungssequenz nach dem BASIC-Laden, siehe
// romLoadExtendedBasic in js/programs.js) eintreffende Bytes landen hier im Empfangsregister;
// bei gesetztem DTR loest das den RST-3-Interrupt aus (siehe romRunLoop) -
// exakt wie ein echtes 8251 mit angeschlossenem DTR.
function usartReceive(byte){
  const u = rom.usart;
  if(!u.rxEnabled) return;
  if(u.rxReady) u.overrunErr = true;
  u.rbr = byte & 0xFF;
  u.rxReady = true;
  if(u.dtr) rom.pendingRxInterrupt = true;
}
function romIoIn(port){
  if(port===0xF0) return rom.keyByte;
  if(port===0xF8){ const v = cassette.pos < cassette.data.length ? cassette.data[cassette.pos++] : 0x00; cassetteChanged(); return v; } // Kassette: Datenport
  if(port===0xF9) return (cassette.pos < cassette.data.length ? 0x02 : 0x00) | 0x05; // Kassette: Statuswort
  if(port===0xFA || port===0xFB) return usartIn(port); // Konsolen-USART
  return 0xFF;
}
function romIoOut(port,val){
  if(port===0xF0){
    rom.digitSel = val & 0x0F;
    const speakerNow = !!(val & 0x80);
    // Das Original erzeugt den "bip" durch mehrere Refresh-Zyklen mit gesetztem
    // Lautsprecher-Bit (siehe RCK/Horn im Quelltext) - hier reicht die steigende
    // Flanke als Ausloeser, statt bei jedem einzelnen Digit-Refresh neu zu piepen.
    if(speakerNow && !rom.speakerOn) beep('short');
    rom.speakerOn = speakerNow;
  }
  else if(port===0xF1){ if(rom.digitSel>=1 && rom.digitSel<=9) rom.display[rom.digitSel]=val; }
  else if(port===0xF8){ cassette.data[cassette.pos++] = val & 0xFF; cassetteChanged(); } // Kassette: Datenport (DUMP)
  else if(port===0xFA || port===0xFB) usartOut(port,val); // Konsolen-USART
}

function romPowerOn(){
  const mem = new Uint8Array(65536);
  mem.set(PAM8_ROM, 0);
  rom.mem = mem;
  rom.digitSel=0; rom.display.fill(0x7f); rom.speakerOn=false; rom.keyByte=ROM_NO_KEY;
  rom.stepCounter=0; rom.ionSeen=false; rom.userSeen=false;
  usartReset(rom.usart); rom.pendingRxInterrupt=false; wire.toH8.length=0;
  const c = new CPU(mem, new Uint8Array(256));
  c.onIn = romIoIn; c.onOut = romIoOut;
  // Nur fuer diese Instanz: das reale H8 blendet ROM (0-1777 oktal) bei Schreibzugriffen
  // aus (siehe OP-Handbuch S.33) - Schreibversuche dorthin verpuffen, statt das ROM zu
  // ueberschreiben. Der JS-Nachbau-Modus kennt dagegen kein ROM und bleibt unveraendert.
  c.wr = function(addr,val){
    if((addr & 0xFFFF) < 1024) return;
    this.mem[addr & 0xFFFF] = val & 0xFF;
  };
  c.pc = 0;
  rom.cpu = c;
  romRunLoop();
  beep('medium');
}
function romPowerOff(){
  if(rom.runHandle){ clearTimeout(rom.runHandle); rom.runHandle=null; }
  if(rom.keyHoldTimer){ clearTimeout(rom.keyHoldTimer); rom.keyHoldTimer=null; }
  rom.cpu=null;
  if(rom.onRender) rom.onRender();
}
function romRunLoop(){
  function frame(){
    if(!powered || !rom.cpu){ rom.runHandle=null; return; }
    const c = rom.cpu;
    // ION soll den IFF-Zustand ("Interrupts freigegeben") anzeigen. Real
    // wechselt IFF sehr schnell zwischen an/aus (DI/EI-Paare in fast jeder
    // ISR) - auf echter Hardware treibt das eine LED, die das Auge durch
    // Nachleuchten als "an" wahrnimmt. Da hier nur einmal je Frame gerendert
    // wird, würde ein einzelner Schnappschuss am Frame-Ende ION praktisch
    // nie anzeigen: Frame-Budget=6000 ist ein exaktes Vielfaches der
    // Interrupt-Periode 400, wodurch das Frame-Ende fast immer genau in das
    // kurze "gerade unterbrochen"-Fenster faellt (empirisch gemessen: dort
    // iff=false, obwohl iff insgesamt gut 85% der Zeit true ist). Deshalb
    // wird ueber den gesamten Frame ODER-verknuepft, ob IFF zwischendurch
    // mal true war, statt nur den letzten Wert zu nehmen.
    // MON/RUN leiden am selben Aliasing-Problem: waehrend ein Anwenderprogramm
    // laeuft, dippt die periodische ISR alle ~400 Schritte kurz ins ROM
    // (Adresse <1024) - trifft der einzelne Schnappschuss am Frame-Ende
    // (wie bei ION) fast immer genau diesen Dip, zeigt RUN praktisch nie,
    // obwohl das Programm tatsaechlich laeuft (per Feinschritt-Tracking
    // verifiziert: das Sprungziel wird zuverlaessig erreicht, nur die Anzeige
    // hinkt hinterher). Deshalb ebenfalls ueber den Frame ODER-verknuepft:
    // war zu irgendeinem Zeitpunkt PC>=1024 (Anwendercode), gilt der Frame
    // als "Anwenderprogramm laeuft" - MON ergibt sich daraus als Gegenteil,
    // nicht als eigene unabhaengige Messung (sonst waeren waehrend eines
    // laufenden Programms wegen der ISR-Dips oft beide Lampen an).
    let iffSeen = false, userSeen = false;
    for(let i=0;i<6000;i++){
      // Von der H9-Tastatur eingetroffene Bytes (wire.toH8) ins USART-
      // Empfangsregister uebernehmen, sobald das vorherige gelesen wurde -
      // stoesst bei gesetztem DTR den RST-3-Interrupt weiter unten an.
      if(wire.toH8.length && !rom.usart.rxReady) usartReceive(wire.toH8.shift());
      if(c.halted){
        if(c.iff && rom.pendingRxInterrupt){ rom.pendingRxInterrupt=false; c.interrupt(0x18); }
        else if(c.iff){ c.interrupt(0x08); } else break;
      }
      c.step();
      if(c.iff) iffSeen = true;
      if(c.pc>=1024) userSeen = true;
      rom.stepCounter++;
      // Takt 400: empirisch stabil fuer Boot/Beispielprogramm/Initial Test Routine/RTM.
      // Ein Versuch mit 820 (naeher an der realen 2ms/500Hz-Rate) behebt zwar seltene
      // Faelle, in denen ein per HLT beendetes Programm nicht automatisch zum Monitor
      // zurueckfindet, fuehrt aber bei der 92-Byte-Testroutine zu echtem Stack-/PC-
      // Runaway (verifiziert per Trace: PC/SP springen nach GO in voellig unzusammen-
      // haengende Adressen ausserhalb von Programm und ROM). Das ist ein schwerwiegenderer
      // Fehler als die seltene fehlende Auto-Recovery, darum bleibt es bei 400. Bekannte
      // Grenze: nach HLT eines selbst-terminierenden Programms kann der Monitor haengen
      // bleiben - Abhilfe ist ein manueller RESET (Hardware-Funktion, unabhaengig vom ROM).
      if(c.iff && (rom.stepCounter % 400)===0){ c.interrupt(0x08); }
      // RST 3 (Konsolen-Empfangsinterrupt, s. usartReceive oben) hat Vorrang
      // vor dem naechsten periodischen Tick, sobald ein Zeichen bereitsteht.
      else if(c.iff && rom.pendingRxInterrupt){ rom.pendingRxInterrupt=false; c.interrupt(0x18); }
    }
    rom.ionSeen = iffSeen;
    rom.userSeen = userSeen;
    if(rom.onRender) rom.onRender();
    // setTimeout statt requestAnimationFrame: rAF-Callbacks werden von Chrome
    // in einem verdeckten/inaktiven Tab komplett ausgesetzt (nicht nur gedrosselt) -
    // damit fror der komplette Emulator (inkl. laufendem LOAD/DUMP) ein, sobald
    // der Tab den Fokus verlor, und blieb dort haengen, bis man zurueckwechselte.
    // setTimeout wird in Hintergrund-Tabs nur gedrosselt (min. ~1x/Sekunde),
    // laeuft also weiter, statt komplett zu pausieren.
    rom.runHandle = setTimeout(frame, 16);
  }
  rom.runHandle = setTimeout(frame, 16);
}
export function romPressKey(byte){
  if(!powered) return;
  if(rom.keyHoldTimer){ clearTimeout(rom.keyHoldTimer); rom.keyHoldTimer=null; }
  rom.keyByte = byte;
}
export function romReleaseKey(){
  rom.keyByte = ROM_NO_KEY;
}
export function romDoReset(){
  if(!rom.cpu) return;
  rom.cpu.reset();
  rom.cpu.pc = 0;
  // Reales Reset laesst laut Handbuch das RAM unangetastet und loescht nur die
  // CPU-Register. In dieser Emulation kommt der PAM8-eigene Speichergroessentest
  // beim Neustart aber nicht zuverlaessig mit Restdaten aus der vorherigen
  // Sitzung klar (haengt sich auf) - daher hier zusaetzlich das RAM (Adresse
  // 1024+, das ROM selbst bleibt unberuehrt) neu initialisieren, fuer einen
  // Reset, der immer sauber funktioniert.
  rom.mem.fill(0, 1024);
  rom.digitSel=0; rom.display.fill(0x7f); rom.speakerOn=false; rom.keyByte=ROM_NO_KEY;
  rom.stepCounter=0; rom.ionSeen=false; rom.userSeen=false;
  usartReset(rom.usart); rom.pendingRxInterrupt=false; wire.toH8.length=0;
  beep('long');
}
export function romDoRTM(){
  if(!powered) return;
  romPressKey(ROM_RTM_BYTE);
  if(rom.keyHoldTimer) clearTimeout(rom.keyHoldTimer);
  rom.keyHoldTimer = setTimeout(()=>{ romReleaseKey(); rom.keyHoldTimer=null; }, 120);
  beep('medium');
}

/* ================= POWER ================= */
export function powerOn(){
  powered=true;
  if(rom.onPowerChange) rom.onPowerChange(true);
  romPowerOn();
}
export function powerOff(){
  powered=false;
  if(rom.onPowerChange) rom.onPowerChange(false);
  romPowerOff();
}
export function togglePower(){ powered ? powerOff() : powerOn(); }
