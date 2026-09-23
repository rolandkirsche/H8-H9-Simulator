// 8080A-Emulator, von Grund auf geschrieben (keine Z80-Erweiterungen).
// cpu.onIn/cpu.onOut sind die Anschlusspunkte fuer die Port-Ein-/Ausgabe (siehe js/h8.js).
function parity(v){ v&=0xFF; let c=0; while(v){c+=v&1; v>>=1;} return c%2===0; }

export function CPU(mem, ports){
  this.mem=mem; this.ports=ports; this.reset();
}
CPU.prototype.reset=function(){
  this.a=0;this.b=0;this.c=0;this.d=0;this.e=0;this.h=0;this.l=0;
  this.f=0x02; this.sp=0; this.pc=0; this.iff=false; this.halted=false;
};
CPU.prototype.rd=function(addr){ return this.mem[addr & 0xFFFF]; };
CPU.prototype.wr=function(addr,val){ this.mem[addr & 0xFFFF]=val & 0xFF; };
CPU.prototype.fetch8=function(){ const v=this.rd(this.pc); this.pc=(this.pc+1)&0xFFFF; return v; };
CPU.prototype.fetch16=function(){ const lo=this.fetch8(), hi=this.fetch8(); return (hi<<8)|lo; };
CPU.prototype.push16=function(v){ this.sp=(this.sp-1)&0xFFFF; this.wr(this.sp,(v>>8)&0xFF); this.sp=(this.sp-1)&0xFFFF; this.wr(this.sp,v&0xFF); };
CPU.prototype.pop16=function(){ const lo=this.rd(this.sp); this.sp=(this.sp+1)&0xFFFF; const hi=this.rd(this.sp); this.sp=(this.sp+1)&0xFFFF; return (hi<<8)|lo; };

CPU.prototype.getBC=function(){return (this.b<<8)|this.c;};
CPU.prototype.setBC=function(v){this.b=(v>>8)&0xFF;this.c=v&0xFF;};
CPU.prototype.getDE=function(){return (this.d<<8)|this.e;};
CPU.prototype.setDE=function(v){this.d=(v>>8)&0xFF;this.e=v&0xFF;};
CPU.prototype.getHL=function(){return (this.h<<8)|this.l;};
CPU.prototype.setHL=function(v){this.h=(v>>8)&0xFF;this.l=v&0xFF;};

CPU.prototype.getReg=function(code){
  switch(code){case 0:return this.b;case 1:return this.c;case 2:return this.d;case 3:return this.e;
    case 4:return this.h;case 5:return this.l;case 6:return this.rd(this.getHL());case 7:return this.a;}
};
CPU.prototype.setReg=function(code,val){
  val&=0xFF;
  switch(code){case 0:this.b=val;break;case 1:this.c=val;break;case 2:this.d=val;break;case 3:this.e=val;break;
    case 4:this.h=val;break;case 5:this.l=val;break;case 6:this.wr(this.getHL(),val);break;case 7:this.a=val;break;}
};

CPU.prototype.setCarry=function(v){ this.f = v ? (this.f|0x01) : (this.f & ~0x01); };
CPU.prototype.getCarry=function(){ return (this.f&0x01)!==0; };
CPU.prototype.setAC=function(v){ this.f = v ? (this.f|0x10) : (this.f & ~0x10); };
CPU.prototype.getAC=function(){ return (this.f&0x10)!==0; };
CPU.prototype.getZ=function(){ return (this.f&0x40)!==0; };
CPU.prototype.getS=function(){ return (this.f&0x80)!==0; };
CPU.prototype.getP=function(){ return (this.f&0x04)!==0; };
CPU.prototype.setSZP=function(val){
  val&=0xFF;
  this.f &= ~(0x80|0x40|0x04);
  if(val&0x80) this.f|=0x80;
  if(val===0) this.f|=0x40;
  if(parity(val)) this.f|=0x04;
};

CPU.prototype.add=function(v,cin){
  const sum=this.a+v+cin;
  this.setAC(((this.a&0xF)+(v&0xF)+cin)>0xF);
  this.setCarry(sum>0xFF);
  this.a=sum&0xFF;
  this.setSZP(this.a);
};
CPU.prototype.sub=function(v,cin){
  const diff=this.a-v-cin;
  this.setAC(((this.a&0xF)-(v&0xF)-cin)>=0);
  this.setCarry(diff<0);
  const r=diff&0xFF;
  this.setSZP(r);
  return r;
};
CPU.prototype.inr=function(v){ const r=(v+1)&0xFF; this.setAC((v&0xF)+1>0xF); this.setSZP(r); return r; };
CPU.prototype.dcr=function(v){ const r=(v-1)&0xFF; this.setAC((v&0xF)!==0); this.setSZP(r); return r; };
CPU.prototype.dad=function(pv){ const sum=this.getHL()+pv; this.setCarry(sum>0xFFFF); this.setHL(sum&0xFFFF); };
CPU.prototype.ana=function(v){ this.setAC(((this.a|v)&0x08)!==0); this.a&=v; this.setCarry(false); this.setSZP(this.a); };
CPU.prototype.xra=function(v){ this.a^=v; this.setCarry(false); this.setAC(false); this.setSZP(this.a); };
CPU.prototype.ora=function(v){ this.a|=v; this.setCarry(false); this.setAC(false); this.setSZP(this.a); };
CPU.prototype.daa=function(){
  let a=this.a, c=this.getCarry(), corr=0;
  if(this.getAC() || (a&0xF)>9) corr+=0x06;
  if(c || (a>>4)>9 || ((a>>4)===9 && (a&0xF)>9)){ corr+=0x60; c=true; }
  this.setAC(((a&0xF)+(corr&0xF))>0xF);
  const r=a+corr;
  this.a=r&0xFF;
  this.setCarry(c || r>0xFF);
  this.setSZP(this.a);
};
// Liefert einen Hardware-Interrupt aus (RST-Vektor n*8). Der 8080 sperrt dabei
// automatisch weitere Interrupts (IFF=0), bis der ROM-Code erneut EI ausfuehrt.
CPU.prototype.interrupt=function(vector){
  this.halted=false;
  this.iff=false;
  this.push16(this.pc);
  this.pc=vector;
};

CPU.prototype.step=function(){
  if(this.halted) return;
  const op=this.fetch8();
  switch(op){
    case 0x00: break;
    case 0x01: this.setBC(this.fetch16()); break;
    case 0x02: this.wr(this.getBC(), this.a); break;
    case 0x03: this.setBC((this.getBC()+1)&0xFFFF); break;
    case 0x04: this.b=this.inr(this.b); break;
    case 0x05: this.b=this.dcr(this.b); break;
    case 0x06: this.b=this.fetch8(); break;
    case 0x07:{const cy=(this.a&0x80)?1:0; this.a=((this.a<<1)|cy)&0xFF; this.setCarry(cy===1); break;}
    case 0x08: break;
    case 0x09: this.dad(this.getBC()); break;
    case 0x0A: this.a=this.rd(this.getBC()); break;
    case 0x0B: this.setBC((this.getBC()-1)&0xFFFF); break;
    case 0x0C: this.c=this.inr(this.c); break;
    case 0x0D: this.c=this.dcr(this.c); break;
    case 0x0E: this.c=this.fetch8(); break;
    case 0x0F:{const cy=this.a&1; this.a=((this.a>>1)|(cy<<7))&0xFF; this.setCarry(cy===1); break;}
    case 0x10: break;
    case 0x11: this.setDE(this.fetch16()); break;
    case 0x12: this.wr(this.getDE(), this.a); break;
    case 0x13: this.setDE((this.getDE()+1)&0xFFFF); break;
    case 0x14: this.d=this.inr(this.d); break;
    case 0x15: this.d=this.dcr(this.d); break;
    case 0x16: this.d=this.fetch8(); break;
    case 0x17:{const cin=this.getCarry()?1:0, cy=(this.a&0x80)?1:0; this.a=((this.a<<1)|cin)&0xFF; this.setCarry(cy===1); break;}
    case 0x18: break;
    case 0x19: this.dad(this.getDE()); break;
    case 0x1A: this.a=this.rd(this.getDE()); break;
    case 0x1B: this.setDE((this.getDE()-1)&0xFFFF); break;
    case 0x1C: this.e=this.inr(this.e); break;
    case 0x1D: this.e=this.dcr(this.e); break;
    case 0x1E: this.e=this.fetch8(); break;
    case 0x1F:{const cin=this.getCarry()?1:0, cy=this.a&1; this.a=((this.a>>1)|(cin<<7))&0xFF; this.setCarry(cy===1); break;}
    case 0x20: break;
    case 0x21: this.setHL(this.fetch16()); break;
    case 0x22:{const addr=this.fetch16(); this.wr(addr,this.l); this.wr(addr+1,this.h); break;}
    case 0x23: this.setHL((this.getHL()+1)&0xFFFF); break;
    case 0x24: this.h=this.inr(this.h); break;
    case 0x25: this.h=this.dcr(this.h); break;
    case 0x26: this.h=this.fetch8(); break;
    case 0x27: this.daa(); break;
    case 0x28: break;
    case 0x29: this.dad(this.getHL()); break;
    case 0x2A:{const addr=this.fetch16(); this.l=this.rd(addr); this.h=this.rd(addr+1); break;}
    case 0x2B: this.setHL((this.getHL()-1)&0xFFFF); break;
    case 0x2C: this.l=this.inr(this.l); break;
    case 0x2D: this.l=this.dcr(this.l); break;
    case 0x2E: this.l=this.fetch8(); break;
    case 0x2F: this.a=(~this.a)&0xFF; break;
    case 0x30: break;
    case 0x31: this.sp=this.fetch16(); break;
    case 0x32: this.wr(this.fetch16(), this.a); break;
    case 0x33: this.sp=(this.sp+1)&0xFFFF; break;
    case 0x34:{const ad=this.getHL(); this.wr(ad,this.inr(this.rd(ad))); break;}
    case 0x35:{const ad=this.getHL(); this.wr(ad,this.dcr(this.rd(ad))); break;}
    case 0x36:{const ad=this.getHL(); this.wr(ad,this.fetch8()); break;}
    case 0x37: this.setCarry(true); break;
    case 0x38: break;
    case 0x39: this.dad(this.sp); break;
    case 0x3A: this.a=this.rd(this.fetch16()); break;
    case 0x3B: this.sp=(this.sp-1)&0xFFFF; break;
    case 0x3C: this.a=this.inr(this.a); break;
    case 0x3D: this.a=this.dcr(this.a); break;
    case 0x3E: this.a=this.fetch8(); break;
    case 0x3F: this.setCarry(!this.getCarry()); break;
    default:
      if(op>=0x40 && op<=0x7F){
        if(op===0x76){ this.halted=true; return; }
        this.setReg((op>>3)&7, this.getReg(op&7));
        return;
      }
      if(op>=0x80 && op<=0x87){ this.add(this.getReg(op&7),0); return; }
      if(op>=0x88 && op<=0x8F){ this.add(this.getReg(op&7), this.getCarry()?1:0); return; }
      if(op>=0x90 && op<=0x97){ this.a=this.sub(this.getReg(op&7),0); return; }
      if(op>=0x98 && op<=0x9F){ this.a=this.sub(this.getReg(op&7), this.getCarry()?1:0); return; }
      if(op>=0xA0 && op<=0xA7){ this.ana(this.getReg(op&7)); return; }
      if(op>=0xA8 && op<=0xAF){ this.xra(this.getReg(op&7)); return; }
      if(op>=0xB0 && op<=0xB7){ this.ora(this.getReg(op&7)); return; }
      if(op>=0xB8 && op<=0xBF){ this.sub(this.getReg(op&7),0); return; }
      switch(op){
        case 0xC0: if(!this.getZ()) this.pc=this.pop16(); break;
        case 0xC1: this.setBC(this.pop16()); break;
        case 0xC2:{const a=this.fetch16(); if(!this.getZ()) this.pc=a; break;}
        case 0xC3: this.pc=this.fetch16(); break;
        case 0xC4:{const a=this.fetch16(); if(!this.getZ()){this.push16(this.pc); this.pc=a;} break;}
        case 0xC5: this.push16(this.getBC()); break;
        case 0xC6: this.add(this.fetch8(),0); break;
        case 0xC7: this.push16(this.pc); this.pc=0x00; break;
        case 0xC8: if(this.getZ()) this.pc=this.pop16(); break;
        case 0xC9: this.pc=this.pop16(); break;
        case 0xCA:{const a=this.fetch16(); if(this.getZ()) this.pc=a; break;}
        case 0xCB: this.pc=this.fetch16(); break;
        case 0xCC:{const a=this.fetch16(); if(this.getZ()){this.push16(this.pc); this.pc=a;} break;}
        case 0xCD:{const a=this.fetch16(); this.push16(this.pc); this.pc=a; break;}
        case 0xCE: this.add(this.fetch8(), this.getCarry()?1:0); break;
        case 0xCF: this.push16(this.pc); this.pc=0x08; break;
        case 0xD0: if(!this.getCarry()) this.pc=this.pop16(); break;
        case 0xD1: this.setDE(this.pop16()); break;
        case 0xD2:{const a=this.fetch16(); if(!this.getCarry()) this.pc=a; break;}
        case 0xD3:{const p=this.fetch8(); this.ports[p]=this.a; if(this.onOut) this.onOut(p,this.a); break;}
        case 0xD4:{const a=this.fetch16(); if(!this.getCarry()){this.push16(this.pc); this.pc=a;} break;}
        case 0xD5: this.push16(this.getDE()); break;
        case 0xD6: this.a=this.sub(this.fetch8(),0); break;
        case 0xD7: this.push16(this.pc); this.pc=0x10; break;
        case 0xD8: if(this.getCarry()) this.pc=this.pop16(); break;
        case 0xD9: this.pc=this.pop16(); break;
        case 0xDA:{const a=this.fetch16(); if(this.getCarry()) this.pc=a; break;}
        case 0xDB:{const p=this.fetch8(); this.a=this.onIn ? this.onIn(p) : this.ports[p]; break;}
        case 0xDC:{const a=this.fetch16(); if(this.getCarry()){this.push16(this.pc); this.pc=a;} break;}
        case 0xDD:{const a=this.fetch16(); this.push16(this.pc); this.pc=a; break;}
        case 0xDE: this.a=this.sub(this.fetch8(), this.getCarry()?1:0); break;
        case 0xDF: this.push16(this.pc); this.pc=0x18; break;
        case 0xE0: if(!this.getP()) this.pc=this.pop16(); break;
        case 0xE1: this.setHL(this.pop16()); break;
        case 0xE2:{const a=this.fetch16(); if(!this.getP()) this.pc=a; break;}
        case 0xE3:{const lo=this.rd(this.sp), hi=this.rd(this.sp+1); this.wr(this.sp,this.l); this.wr(this.sp+1,this.h); this.l=lo; this.h=hi; break;}
        case 0xE4:{const a=this.fetch16(); if(!this.getP()){this.push16(this.pc); this.pc=a;} break;}
        case 0xE5: this.push16(this.getHL()); break;
        case 0xE6: this.ana(this.fetch8()); break;
        case 0xE7: this.push16(this.pc); this.pc=0x20; break;
        case 0xE8: if(this.getP()) this.pc=this.pop16(); break;
        case 0xE9: this.pc=this.getHL(); break;
        case 0xEA:{const a=this.fetch16(); if(this.getP()) this.pc=a; break;}
        case 0xEB:{const h=this.h,l=this.l; this.h=this.d; this.l=this.e; this.d=h; this.e=l; break;}
        case 0xEC:{const a=this.fetch16(); if(this.getP()){this.push16(this.pc); this.pc=a;} break;}
        case 0xED:{const a=this.fetch16(); this.push16(this.pc); this.pc=a; break;}
        case 0xEE: this.xra(this.fetch8()); break;
        case 0xEF: this.push16(this.pc); this.pc=0x28; break;
        case 0xF0: if(!this.getS()) this.pc=this.pop16(); break;
        case 0xF1:{const psw=this.pop16(); this.a=(psw>>8)&0xFF; this.f=(psw&0xD7)|0x02; break;}
        case 0xF2:{const a=this.fetch16(); if(!this.getS()) this.pc=a; break;}
        case 0xF3: this.iff=false; break;
        case 0xF4:{const a=this.fetch16(); if(!this.getS()){this.push16(this.pc); this.pc=a;} break;}
        case 0xF5: this.push16((this.a<<8)|this.f); break;
        case 0xF6: this.ora(this.fetch8()); break;
        case 0xF7: this.push16(this.pc); this.pc=0x30; break;
        case 0xF8: if(this.getS()) this.pc=this.pop16(); break;
        case 0xF9: this.sp=this.getHL(); break;
        case 0xFA:{const a=this.fetch16(); if(this.getS()) this.pc=a; break;}
        case 0xFB: this.iff=true; break;
        case 0xFC:{const a=this.fetch16(); if(this.getS()){this.push16(this.pc); this.pc=a;} break;}
        case 0xFD:{const a=this.fetch16(); this.push16(this.pc); this.pc=a; break;}
        case 0xFE: this.sub(this.fetch8(),0); break;
        case 0xFF: this.push16(this.pc); this.pc=0x38; break;
      }
  }
};
