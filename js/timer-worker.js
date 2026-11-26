// Časovač ve workeru: Chrome stránku v okně na pozadí (zakrytou, minimalizovanou, záložku) brzdí a její časovače
// po pár minutách spouští jen jednou za minutu. Časovače ve workeru takhle brzděné nejsou – stt.js přes něj čeká
// mezi dotazy na program Bangor, aby hromadný přepis běžel plnou rychlostí, i když se pracuje v jiném okně.
self.onmessage = e => {
  const { id, ms } = e.data || {};
  setTimeout(() => self.postMessage(id), Math.max(0, +ms || 0));
};
