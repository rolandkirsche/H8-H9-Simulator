// Dekodiert die eingebetteten Original-Binaerabbilder (ROM, Kassettenband).
export function decodeBase64(b64){
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return arr;
}
