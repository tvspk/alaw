// Dočasná kopie nahrávky pro přepis řeči: mono, 16 kHz, 16bit WAV (Whisper i Gemini zvuk stejně takhle zpracují).
// Uložená nahrávka se nemění – rozhodnutí zadavatele „zvuk se nezmenšuje“ platí dál.
export async function toSpeechWav(blob, rate = 16000) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.OfflineAudioContext) throw new Error('Prohlížeč neumí zpracovat zvuk.');
  const ac = new AC();
  let audio;
  try { audio = await ac.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('Nahrávku se nepodařilo přečíst.'); }
  finally { try { ac.close(); } catch { /* nic */ } }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination); // jeden kanál: stereo se smíchá
  src.start();
  return encodeWav((await off.startRendering()).getChannelData(0), rate);
}

export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
