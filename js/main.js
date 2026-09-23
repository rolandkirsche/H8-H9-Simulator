/* ================= APP-EINSTIEG =================
   Verdrahtet die Module mit der Seite (index.html): H8-Frontpanel (js/panel.js),
   H9-Bedienung, Karten-Buttons, virtuelle Kassette und den Service Worker. */
import { rom, powered, ROM_KEY_BYTE } from './h8.js';
import { h9, h9powered, h9AttachCanvas, h9Render, h9TogglePower, h9ToggleMode,
         H9_LOCAL_KEYS, h9KeyToBytes, h9SendKeyBytes } from './h9.js';
import { wire } from './wire.js';
import { cassette, cassetteChanged, cassetteStatusText, cassetteRewind, cassetteEject, cassetteInsert } from './cassette.js';
import { romLoadExample, romLoadInitialTestRoutine, romLoadSerialEcho, romLoadExtendedBasic,
         romPressAndRelease, romLoadTapeAndGo, romRegainMonitorControl } from './programs.js';
import { beep, isMuted, setMuted } from './audio.js';
import { initPanel } from './panel.js';

initPanel();

// Sperrt den Button, solange die (zeitgesteuerte) Tastendruck-Kette laeuft, und
// zeigt so lange busyLabel an - ein zweiter Klick waehrenddessen wird ignoriert.
async function runBusy(btn, busyLabel, task){
  if(btn.disabled) return;
  btn.disabled=true; const label=btn.textContent; btn.textContent=busyLabel;
  try{
    await task();
  } finally {
    btn.disabled=false; btn.textContent=label;
  }
}
function onClick(id, fn){ document.getElementById(id).addEventListener('click', fn); }

onClick('btn-example', (e)=> runBusy(e.currentTarget, 'Tippt …', romLoadExample));
onClick('btn-itr', (e)=> runBusy(e.currentTarget, 'Tippt …', romLoadInitialTestRoutine));
onClick('btn-serial-echo', (e)=> runBusy(e.currentTarget, 'Tippt …', romLoadSerialEcho));
onClick('btn-extended-basic', (e)=> runBusy(e.currentTarget, 'Kassette wird geladen …', romLoadExtendedBasic));
onClick('btn-mute', (e)=>{
  setMuted(!isMuted());
  e.target.textContent = isMuted() ? '🔇 Ton aus' : '🔊 Ton an';
});

/* ----- Kassette ----- */
const cassetteStatusEl = document.getElementById('cassette-status');
cassette.onChange = ()=>{ cassetteStatusEl.textContent = cassetteStatusText(); };
onClick('btn-cassette-rewind', cassetteRewind);
onClick('btn-cassette-eject', cassetteEject);
onClick('btn-cassette-save', ()=>{
  const blob = new Blob([new Uint8Array(cassette.data)], {type:'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'h8-kassette.h8tape';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
const cassetteFileInput = document.getElementById('cassette-file-input');
onClick('btn-cassette-load', ()=> cassetteFileInput.click());
cassetteFileInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    cassetteInsert(new Uint8Array(reader.result));
    beep('medium');
  };
  reader.readAsArrayBuffer(file);
  cassetteFileInput.value = '';
});
cassetteChanged();

/* ----- H9-Terminal ----- */
function setSwitch(el, on){
  el.classList.toggle('on', on);
  el.setAttribute('aria-checked', on?'true':'false');
}
function wireSwitch(id, action){
  const el=document.getElementById(id);
  const flip=()=> setSwitch(el, action());
  el.addEventListener('click', flip);
  el.addEventListener('keydown', (e)=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); flip(); } });
}
wireSwitch('h9-power-toggle', h9TogglePower);
wireSwitch('h9-duplex-toggle', ()=> h9ToggleMode('fullDuplex'));
wireSwitch('h9-autocarry-toggle', ()=> h9ToggleMode('autoCarry'));
wireSwitch('h9-scroll-toggle', ()=> h9ToggleMode('scroll'));

const h9Frame = document.getElementById('h9-screen-frame');
h9Frame.addEventListener('click', ()=> h9Frame.focus());
h9Frame.addEventListener('focus', ()=> h9Frame.classList.add('focused'));
h9Frame.addEventListener('blur', ()=> h9Frame.classList.remove('focused'));
h9Frame.addEventListener('keydown', (e)=>{
  if(!h9powered) return;
  if(H9_LOCAL_KEYS[e.key]){ H9_LOCAL_KEYS[e.key](); e.preventDefault(); return; }
  const bytes = h9KeyToBytes(e);
  if(bytes){ h9SendKeyBytes(bytes); e.preventDefault(); }
});
h9AttachCanvas(document.getElementById('h9-screen'));
h9Render();

/* ----- Offline-Faehigkeit (PWA) -----
   Service Worker nur ueber http(s) - unter file:// laufen ohnehin keine ES-Module. */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  navigator.serviceWorker.register('sw.js').catch(()=>{ /* App laeuft auch ohne Offline-Cache */ });
}

// Reiner Lese-Diagnose-Hook fuers Debugging in der Browser-Konsole - kein
// Verhaltensunterschied, greift nur lesend auf bereits existierende Objekte zu.
window.__h8dbg = { rom, wire, h9, cassette, cassetteChanged, romPressAndRelease, romLoadTapeAndGo, romRegainMonitorControl, ROM_KEY_BYTE,
  get powered(){return powered;}, get h9powered(){return h9powered;} };
