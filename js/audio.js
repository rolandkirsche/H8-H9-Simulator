/* ================= AUDIO ================= */
let muted=false;
export function setMuted(v){ muted=!!v; }
export function isMuted(){ return muted; }

let audioCtx=null;
function ensureAudio(){
  if(muted) return null;
  if(!audioCtx){
    const Ctor = window.AudioContext||window.webkitAudioContext;
    if(!Ctor) return null;
    audioCtx = new Ctor();
  }
  if(audioCtx.state==='suspended'){ audioCtx.resume(); }
  return audioCtx;
}
function tone(startTime,dur,freq){
  const ctx=audioCtx;
  const osc=ctx.createOscillator(), gain=ctx.createGain();
  osc.type='square'; osc.frequency.value=freq;
  gain.gain.setValueAtTime(0.0001,startTime);
  gain.gain.exponentialRampToValueAtTime(0.16,startTime+0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001,startTime+dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime); osc.stop(startTime+dur+0.02);
}
// beep() darf niemals eine Ausnahme werfen: sie wird ueberall im Panel-Code
// aufgerufen (auch mitten in Power-On/Reset-Ablaeufen), und ein blockierter
// oder fehlender AudioContext (Autoplay-Richtlinien, eingeschraenkte
// Umgebungen, Node ohne window) soll die eigentliche Panel-Funktion nicht abbrechen.
export function beep(kind){
  try{
    const ctx=ensureAudio(); if(!ctx) return;
    const now=ctx.currentTime;
    if(kind==='pulsing'){ for(let i=0;i<4;i++) tone(now+i*0.16, 0.08, 460); return; }
    const specs={short:[0.04,1500], medium:[0.13,900], long:[0.5,420]};
    const s=specs[kind]||specs.short;
    tone(now,s[0],s[1]);
  }catch(err){ /* Ton ist rein kosmetisch - Panel-Funktion muss trotzdem weiterlaufen */ }
}
