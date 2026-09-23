/* ================= H8-FRONTPANEL (DOM) =================
   Anzeige (7-Segment, Lampen) und Bedienung (Tastenfeld, Tastatur-Kuerzel,
   Netzschalter) fuer die Maschine aus js/h8.js. */
import { rom, powered, togglePower, romPressKey, romReleaseKey, romDoReset, romDoRTM, decodeRomSeg, ROM_KEY_BYTE } from "./h8.js";

/* ================= 7-SEGMENT FONT ================= */
const SEGMENTS = {
  '0':{a:1,b:1,c:1,d:1,e:1,f:1,g:0}, '1':{a:0,b:1,c:1,d:0,e:0,f:0,g:0},
  '2':{a:1,b:1,c:0,d:1,e:1,f:0,g:1}, '3':{a:1,b:1,c:1,d:1,e:0,f:0,g:1},
  '4':{a:0,b:1,c:1,d:0,e:0,f:1,g:1}, '5':{a:1,b:0,c:1,d:1,e:0,f:1,g:1},
  '6':{a:1,b:0,c:1,d:1,e:1,f:1,g:1}, '7':{a:1,b:1,c:1,d:0,e:0,f:0,g:0},
  'A':{a:1,b:1,c:1,d:0,e:1,f:1,g:1}, 'b':{a:0,b:0,c:1,d:1,e:1,f:1,g:1},
  'C':{a:1,b:0,c:0,d:1,e:1,f:1,g:0}, 'c':{a:0,b:0,c:0,d:1,e:1,f:0,g:1},
  'd':{a:0,b:1,c:1,d:1,e:1,f:0,g:1}, 'E':{a:1,b:0,c:0,d:1,e:1,f:1,g:1},
  'H':{a:0,b:1,c:1,d:0,e:1,f:1,g:1}, 'L':{a:0,b:0,c:0,d:1,e:1,f:1,g:0},
  'P':{a:1,b:1,c:0,d:0,e:1,f:1,g:1}, 'S':{a:1,b:0,c:1,d:1,e:0,f:1,g:1},
  'F':{a:1,b:0,c:0,d:0,e:1,f:1,g:1},
  '8':{a:1,b:1,c:1,d:1,e:1,f:1,g:1},
  // Kleinbuchstaben aus dem Lauftext der Initial Test Routine ("your H8 IS UP And running")
  'o':{a:1,b:1,c:0,d:0,e:0,f:1,g:1},
  'u':{a:0,b:1,c:0,d:0,e:0,f:1,g:1},
  'r':{a:1,b:0,c:0,d:0,e:0,f:1,g:0},
  'I':{a:0,b:0,c:0,d:0,e:1,f:1,g:0},
  'n':{a:1,b:1,c:0,d:0,e:0,f:1,g:0},
  'N':{a:0,b:0,c:1,d:0,e:1,f:0,g:1}, // "n" in "And" - eigenes Muster, siehe ROM_SEG 0x56
  'i':{a:0,b:1,c:0,d:0,e:0,f:0,g:0},
  'g':{a:1,b:1,c:1,d:1,e:0,f:1,g:1},
  // Pfeil-/Zierzeichen am Ende der Meldung
  '[':{a:0,b:0,c:0,d:0,e:1,f:1,g:1},
  '-':{a:0,b:0,c:0,d:0,e:0,f:0,g:1},
  ']':{a:0,b:1,c:1,d:0,e:0,f:0,g:1},
  ' ':{a:0,b:0,c:0,d:0,e:0,f:0,g:0}
};
const SEG_LETTERS=['a','b','c','d','e','f','g'];

/* ================= DISPLAY RENDER ================= */
const digitEls=[];
function buildDigits(){
  const row=document.getElementById('display-row');
  const addrGroup=document.createElement('div'); addrGroup.className='addr-group';
  const dataGroup=document.createElement('div'); dataGroup.className='data-group';
  row.appendChild(addrGroup); row.appendChild(dataGroup);
  for(let i=0;i<9;i++){
    const d=document.createElement('div');
    d.className='digit';
    d.innerHTML = SEG_LETTERS.map(s=>'<i class="seg seg-'+s+'"></i>').join('') + '<i class="dp"></i>';
    (i<6?addrGroup:dataGroup).appendChild(d);
    const segEls={};
    SEG_LETTERS.forEach(s=>{ segEls[s]=d.querySelector('.seg-'+s); });
    digitEls.push({segEls, dp:d.querySelector('.dp')});
  }
}
function setDigit(i,ch,dpOn){
  const pat=SEGMENTS[ch]||SEGMENTS[' '];
  const ref=digitEls[i];
  SEG_LETTERS.forEach(s=>{ ref.segEls[s].classList.toggle('on', !!pat[s]); });
  ref.dp.classList.toggle('on', !!dpOn);
}
function setLamp(name,on){
  const el=document.querySelector('.lamp[data-lamp="'+name+'"]');
  if(el) el.classList.toggle('lit', !!on);
}

function romRender(){
  const el=statusEl;
  if(!powered || !rom.cpu){
    for(let i=0;i<9;i++) setDigit(i,' ',false);
    setLamp('ion',false); setLamp('mon',false); setLamp('run',false); setLamp('pwr',false);
    if(el) el.textContent='Gerät ausgeschaltet.';
    return;
  }
  setLamp('pwr', true);
  setLamp('ion', rom.ionSeen);
  // Heuristik: Monitor-Code liegt vollstaendig im ROM (Adresse 0-1023). Nutzt
  // rom.userSeen (siehe romRunLoop in js/h8.js) statt der reinen Momentaufnahme von
  // rom.cpu.pc, da diese wegen des Interrupt-Sampling-Alias-Effekts fast nie
  // "im Anwenderprogramm" zeigen wuerde, obwohl es tatsaechlich laeuft.
  const inRom = !rom.userSeen;
  setLamp('mon', inRom);
  setLamp('run', !inRom);
  // Bit 7 ist wie die uebrigen Segmentbits aktiv-Low (0 = Punkt an) - bestaetigt
  // durch die DOD-Routine im Original-Quelltext (XOR B / AND 7F / XOR B legt
  // Bit 7 direkt aus dem rotierenden "DspRot"-Muster fest, ohne Polaritaetswechsel).
  for(let i=1;i<=9;i++) setDigit(i-1, decodeRomSeg(rom.display[i]), (rom.display[i]&0x80)===0);
  if(el) el.textContent = 'PC=0'+rom.cpu.pc.toString(8)+' oktal · '+(inRom?'Monitor aktiv':'Anwenderprogramm läuft');
}

function renderPowerToggle(on){
  powerToggle.classList.toggle('on', on);
  powerToggle.setAttribute('aria-checked', on?'true':'false');
}

/* ================= EVENT WIRING ================= */
function keyByteForButton(btn){
  if(btn.dataset.num!==undefined) return ROM_KEY_BYTE[parseInt(btn.dataset.num,10)];
  return ROM_KEY_BYTE[btn.dataset.action];
}

// Die Original-Tastenmatrix unterscheidet Druecken/Loslassen (Debounce +
// Auto-Repeat laeuft im ROM selbst), daher hier auf mousedown/up statt click.
function romKeyDown(e){
  if(!powered) return;
  const btn=e.target.closest('button.key');
  if(!btn) return;
  if(btn.dataset.num==='0' && (e.ctrlKey || e.metaKey)){ romDoReset(); return; }
  if(btn.dataset.num==='0' && e.shiftKey){ romDoRTM(); return; }
  const byte = keyByteForButton(btn);
  if(byte!==undefined) romPressKey(byte);
}
function romKeyUp(){ romReleaseKey(); }
// Ziffer aus dem physischen Tastencode lesen (e.code, z.B. "Digit0"), nicht
// aus e.key: mit gedrueckter Shift-Taste liefert e.key layoutabhaengig ein
// verschobenes Zeichen statt der Ziffer (z.B. "=" bei Shift+0 auf deutscher,
// ")" auf US-Tastatur) - dadurch schlug die Ziffernerkennung fehl und
// Umschalt+0 (RTM) reagierte nie. Strg+0 (RESET) funktionierte nur zufaellig,
// weil Strg das erzeugte Zeichen nicht veraendert.
function digitFromEvent(e){
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code||'');
  if(m) return parseInt(m[1],10);
  const k=e.key;
  return (k>='0' && k<='9') ? parseInt(k,10) : null;
}

let statusEl=null, powerToggle=null;
export function initPanel(){
  statusEl=document.getElementById('status-line');
  buildDigits();
  rom.onRender = romRender;
  rom.onPowerChange = renderPowerToggle;

  const keypadEl = document.getElementById('keypad');
  keypadEl.addEventListener('mousedown', romKeyDown);
  // Loslassen bewusst auf window, nicht nur auf dem Tastenfeld: so bleibt die Taste
  // gedrueckt, auch wenn die Maus beim Klicken minimal zwischen zwei Tasten wandert.
  window.addEventListener('mouseup', romKeyUp);
  keypadEl.addEventListener('touchstart', (e)=>{ romKeyDown(e); }, {passive:true});
  window.addEventListener('touchend', romKeyUp);
  window.addEventListener('touchcancel', romKeyUp);

  powerToggle=document.getElementById('power-toggle');
  powerToggle.addEventListener('click', togglePower);
  powerToggle.addEventListener('keydown', (e)=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); togglePower(); } });

  const h9Frame = document.getElementById('h9-screen-frame');
  window.addEventListener('keydown',(e)=>{
    if(e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')) return;
    // Der H9-Bildschirm hat seinen eigenen Tastatur-Handler (siehe h9Frame in
    // js/main.js) und sendet Zeichen ueber die serielle Leitung. Ohne diese Abgrenzung
    // wuerde ein Tastendruck WAEHREND der H9-Bildschirm fokussiert ist zusaetzlich
    // hier als H8-Frontpanel-Taste interpretiert (z.B. "m" -> MEM), obwohl der
    // Anwender offensichtlich auf dem Terminal tippen wollte - empirisch am
    // hoerbaren H8-Tastenklick erkannt, waehrend auf dem H9-Bildschirm nichts
    // ankam, weil der eigentliche h9Frame-Handler mangels Fokus gar nicht feuerte.
    if(e.target===h9Frame || (h9Frame && h9Frame.contains(e.target))) return;
    if(e.repeat) return;
    if(!powered) return;
    const digit = digitFromEvent(e);
    if(digit!==null && digit<=7){
      if((e.ctrlKey||e.metaKey) && digit===0){ romDoReset(); e.preventDefault(); return; }
      if(e.shiftKey && digit===0){ romDoRTM(); e.preventDefault(); return; }
      romPressKey(ROM_KEY_BYTE[digit]); e.preventDefault(); return;
    }
    const k=e.key;
    const map={m:'MEM', r:'REG', a:'ALTER', c:'CANCEL', l:'LOAD', d:'DUMP'};
    if(map[k.toLowerCase()]){ romPressKey(ROM_KEY_BYTE[map[k.toLowerCase()]]); e.preventDefault(); return; }
    if(k==='+'||k==='='){ romPressKey(ROM_KEY_BYTE.PLUS); e.preventDefault(); return; }
    if(k==='-'){ romPressKey(ROM_KEY_BYTE.MINUS); e.preventDefault(); return; }
  });
  window.addEventListener('keyup',(e)=>{
    if(e.target===h9Frame || (h9Frame && h9Frame.contains(e.target))) return;
    const digit = digitFromEvent(e);
    if(digit!==null && digit<=7){ romReleaseKey(); return; }
    const k=e.key.toLowerCase();
    if('mracld+=-'.includes(k)) romReleaseKey();
  });

  romRender();
}
