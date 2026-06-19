/* =========================================================================
   CANAL DIGITAL · LAB
   Código de línea + Detección de errores (VRC/LRC/CRC/Checksum) + Hamming
   Vanilla JS, sin dependencias.
   ========================================================================= */

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs){
  const el = document.createElementNS(NS, tag);
  for(const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function cleanBits(str){
  return (str || "").replace(/[^01]/g, "");
}

function validateBits(str, minLen, helpEl, fallback){
  const clean = cleanBits(str);
  if(clean.length === 0){
    helpEl.textContent = `Escribe solo 0 y 1. Usando ejemplo por defecto.`;
    helpEl.className = "help warn";
    return fallback;
  }
  if(clean.length < minLen){
    helpEl.textContent = `Mínimo ${minLen} bits requeridos por la consigna — se repitió el patrón para completar.`;
    helpEl.className = "help warn";
    let padded = clean;
    while(padded.length < minLen) padded += clean;
    return padded.slice(0, Math.max(minLen, clean.length));
  }
  helpEl.textContent = `${clean.length} bits cargados.`;
  helpEl.className = "help";
  return clean;
}

function flipBit(bits, pos){
  // pos is 1-indexed from the left
  const arr = bits.split("");
  const i = pos - 1;
  arr[i] = arr[i] === "1" ? "0" : "1";
  return arr.join("");
}

function xorParity(bits){
  // returns '1' if odd number of 1s, '0' if even (even parity bit needed = same as count mod 2)
  let count = 0;
  for(const b of bits) if(b === "1") count++;
  return (count % 2).toString();
}

/* ================= CÓDIGOS DE LÍNEA ================= */

const LINE_THEORY = {
  NRZL: `<strong style="color:var(--ink);">NRZ-L</strong> (Non Return to Zero – Level): el bit se traduce directamente
    a un nivel de voltaje. 1 → +V, 0 → −V. No hay transición obligatoria; niveles iguales seguidos producen una línea plana.`,
  NRZI: `<strong style="color:var(--ink);">NRZI</strong> (Non Return to Zero Inverted): lo que importa es el cambio, no el nivel.
    1 → hay transición (el nivel se invierte respecto al bit anterior). 0 → no hay transición (se mantiene el nivel).`,
  AMI: `<strong style="color:var(--ink);">AMI</strong> (Alternate Mark Inversion): 0 → 0V. 1 → se alterna entre +V y −V cada vez
    que aparece un 1, manteniendo balance de continua.`,
  MLT3: `<strong style="color:var(--ink);">MLT-3</strong> (Multi-Level Transmit 3): usa tres niveles (+V, 0V, −V) en un ciclo
    fijo +V→0→−V→0→+V… 1 → avanza un paso en el ciclo. 0 → se mantiene en el nivel actual.`,
  MANCH: `<strong style="color:var(--ink);">Manchester</strong>: cada bit se divide en dos mitades con transición obligatoria
    al centro. 1 → bajo→alto. 0 → alto→bajo. Autosincronizante, usado en Ethernet 10BASE-T.`,
  MANCHD: `<strong style="color:var(--ink);">Manchester Diferencial</strong>: siempre hay transición al centro del bit (como
    Manchester), pero el valor del bit se codifica en si hay o no transición al INICIO del intervalo.
    1 → no hay transición al inicio. 0 → hay transición al inicio.`
};

const LINE_RULES = {
  NRZL: "1: +V · 0: −V",
  NRZI: "1: traslación · 0: sin traslación",
  AMI: "1: ±V alternado · 0: 0V",
  MLT3: "1: avanza nivel · 0: mantiene nivel",
  MANCH: "1: bajo→alto · 0: alto→bajo",
  MANCHD: "1: sin transición inicial · 0: con transición inicial"
};

// Each encoder returns an array of {level, transitionAtStart} samples,
// where we will render as a step function. We work with 3 levels: -1, 0, 1.
// For schemes with sub-bit transitions (Manchester), we return 2 samples per bit.

function encodeNRZL(bits){
  const samples = [];
  for(const b of bits){
    const lvl = b === "1" ? 1 : -1;
    samples.push({lvl, bit:b});
  }
  return samples; // 1 sample per bit
}

function encodeNRZI(bits){
  const samples = [];
  let lvl = -1; // start low
  for(const b of bits){
    if(b === "1") lvl = lvl === 1 ? -1 : 1; // translate
    samples.push({lvl, bit:b});
  }
  return samples;
}

function encodeAMI(bits){
  const samples = [];
  let lastMark = -1; // last polarity used for a '1', so next 1 alternates
  for(const b of bits){
    let lvl;
    if(b === "0"){ lvl = 0; }
    else{ lastMark = lastMark === 1 ? -1 : 1; lvl = lastMark; }
    samples.push({lvl, bit:b});
  }
  return samples;
}

function encodeMLT3(bits){
  // cycle: +1 -> 0 -> -1 -> 0 -> +1 ...
  const cycle = [1, 0, -1, 0];
  let idx = 0; // start at level 0 (per textbook diagrams, first bit 0 keeps at 0 baseline then 1 advances)
  let lvl = 0;
  const samples = [];
  for(const b of bits){
    if(b === "1"){
      idx = (idx + 1) % cycle.length;
      lvl = cycle[idx];
    }
    samples.push({lvl, bit:b});
  }
  return samples;
}

function encodeManchester(bits){
  // returns 2 half-samples per bit: [firstHalf, secondHalf]
  const samples = [];
  for(const b of bits){
    if(b === "1"){
      samples.push({lvl:-1, bit:b, half:0});
      samples.push({lvl:1, bit:b, half:1});
    } else {
      samples.push({lvl:1, bit:b, half:0});
      samples.push({lvl:-1, bit:b, half:1});
    }
  }
  return samples;
}

function encodeManchesterDiff(bits){
  // Differential Manchester: always a transition at mid-bit.
  // 1 -> no transition at start of bit (continues previous level into first half)
  // 0 -> transition at start of bit (flips before first half)
  const samples = [];
  let lvl = -1; // level at end of previous bit
  for(const b of bits){
    if(b === "0") lvl = lvl === 1 ? -1 : 1; // transition at start
    // first half = lvl (post start-transition decision)
    samples.push({lvl, bit:b, half:0});
    lvl = lvl === 1 ? -1 : 1; // mandatory mid-bit transition
    samples.push({lvl, bit:b, half:1});
  }
  return samples;
}

const ENCODERS = {
  NRZL: encodeNRZL,
  NRZI: encodeNRZI,
  AMI: encodeAMI,
  MLT3: encodeMLT3,
  MANCH: encodeManchester,
  MANCHD: encodeManchesterDiff
};

const HALF_SAMPLE_SCHEMES = new Set(["MANCH", "MANCHD"]);

function countTransitions(samples){
  let t = 0;
  for(let i=1;i<samples.length;i++){
    if(samples[i].lvl !== samples[i-1].lvl) t++;
  }
  return t;
}

/**
 * Renders a step waveform into an svg element.
 * bits: string of 0/1
 * samples: array of {lvl, bit, half?}
 * isHalfStep: whether each sample is half a bit-cell wide
 */
function renderWaveform(svg, bits, samples, isHalfStep, opts){
  opts = opts || {};
  svg.innerHTML = "";
  const W = 1000, H = opts.height || 220;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const marginTop = 36, marginBottom = 30;
  const plotH = H - marginTop - marginBottom;
  const nBits = bits.length;
  const cellW = W / nBits;

  const yFor = (lvl) => {
    // lvl in {-1, 0, 1} mapped to plot area; for 2-level schemes, 0-> bottom, 1->top
    if(lvl === 1) return marginTop;
    if(lvl === -1) return marginTop + plotH;
    return marginTop + plotH/2; // 0 level (AMI / MLT-3)
  };

  // background grid: cell separators (dashed) + bit labels
  for(let i=0;i<=nBits;i++){
    const x = i*cellW;
    svg.appendChild(svgEl("line", {
      x1:x, x2:x, y1:marginTop-10, y2:H-marginBottom+8,
      stroke:"var(--line)", "stroke-width":1, "stroke-dasharray":"4,4"
    }));
  }
  for(let i=0;i<nBits;i++){
    const x = i*cellW + cellW/2;
    const t = svgEl("text", {
      x, y: marginTop - 16, "text-anchor":"middle",
      fill:"var(--ink-dim)", "font-family":"var(--mono)", "font-size":"13"
    });
    t.textContent = bits[i];
    svg.appendChild(t);
  }

  // reference level lines
  const levels = isHalfStep || ["NRZL","NRZI"].includes(opts.scheme) ? [1,-1] : [1,0,-1];
  const labelFor = {1:"+V", 0:opts.scheme==='AMI'?"0V":"0", "-1":"−V"};
  levels.forEach(l=>{
    const y = yFor(l);
    svg.appendChild(svgEl("line", {
      x1:0, x2:W, y1:y, y2:y, stroke:"#1f2e26", "stroke-width":1
    }));
    const t = svgEl("text", {x:6, y:y-6, fill:"var(--ink-dim)", "font-family":"var(--mono)", "font-size":"11"});
    t.textContent = labelFor[l];
    svg.appendChild(t);
  });

  // step path
  let d = "";
  const step = isHalfStep ? cellW/2 : cellW;
  samples.forEach((s, i)=>{
    const x0 = i*step;
    const x1 = (i+1)*step;
    const y = yFor(s.lvl);
    if(i === 0){
      d += `M ${x0} ${y} L ${x1} ${y} `;
    } else {
      const yPrev = yFor(samples[i-1].lvl);
      d += `L ${x0} ${yPrev} L ${x0} ${y} L ${x1} ${y} `;
    }
  });

  const path = svgEl("path", {
    d, fill:"none", stroke:"var(--phosphor)", "stroke-width":2.6,
    "stroke-linecap":"square", filter:"url(#glow)"
  });

  // glow filter (defined once globally, but ensure present)
  if(!document.getElementById("waveGlowDefs")){
    const defs = svgEl("defs", {id:"waveGlowDefs"});
    const filter = svgEl("filter", {id:"glow", x:"-20%", y:"-20%", width:"140%", height:"140%"});
    const blur = svgEl("feGaussianBlur", {stdDeviation:"2.2", result:"blur"});
    const merge = svgEl("feMerge", {});
    merge.appendChild(svgEl("feMergeNode", {in:"blur"}));
    merge.appendChild(svgEl("feMergeNode", {in:"SourceGraphic"}));
    filter.appendChild(blur);
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);
  }

  svg.appendChild(path);
}

/* ---- decorative hero waveform (rotates schemes) ---- */
function renderHeroWave(){
  const svg = document.getElementById("heroWaveSvg");
  const bitsEl = document.getElementById("heroWaveBits");
  const demoBits = "01011010";
  const schemes = ["NRZL","AMI","MANCH"];
  let idx = 0;

  function draw(){
    const scheme = schemes[idx % schemes.length];
    const samples = ENCODERS[scheme](demoBits);
    const isHalf = HALF_SAMPLE_SCHEMES.has(scheme);
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 1000 120");
    const W=1000, H=120, marginTop=18, marginBottom=18;
    const plotH = H - marginTop - marginBottom;
    const yFor = (lvl) => lvl===1?marginTop: lvl===-1?marginTop+plotH: marginTop+plotH/2;
    const nBits = demoBits.length;
    const cellW = W/nBits;
    const step = isHalf ? cellW/2 : cellW;
    let d = "";
    samples.forEach((s,i)=>{
      const x0=i*step, x1=(i+1)*step, y=yFor(s.lvl);
      if(i===0) d += `M ${x0} ${y} L ${x1} ${y} `;
      else { const yp = yFor(samples[i-1].lvl); d += `L ${x0} ${yp} L ${x0} ${y} L ${x1} ${y} `; }
    });
    const path = svgEl("path", {d, fill:"none", stroke:"var(--phosphor-dim)", "stroke-width":2});
    svg.appendChild(path);
    bitsEl.textContent = `${demoBits}  ·  ${scheme}`;
    idx++;
  }
  draw();
  setInterval(draw, 2600);
}

/* ================= DETECCIÓN DE ERRORES ================= */

const DET_THEORY = {
  VRC: `<strong style="color:var(--ink);">VRC</strong> (Vertical Redundancy Check / bit de paridad): se cuenta el número
    de "1" en los datos y se añade un bit extra para que el total sea par (paridad par). Detecta cualquier
    error en un solo bit, pero falla si el número total de bits invertidos es par.`,
  LRC: `<strong style="color:var(--ink);">LRC</strong> (Longitudinal Redundancy Check): los datos se organizan en filas;
    se calcula una fila adicional de paridad columna por columna (XOR vertical de cada columna). Detecta ráfagas
    que no afecten la misma posición de columna en un número par de filas.`,
  CRC: `<strong style="color:var(--ink);">CRC</strong> (Cyclic Redundancy Check): los datos, vistos como un polinomio
    binario, se dividen (módulo 2) por un polinomio generador. El resto de esa división es el CRC. El receptor
    repite la división sobre datos+CRC: si el resto es 0, acepta.`,
  CHK: `<strong style="color:var(--ink);">Suma de comprobación</strong> (Checksum): los datos se dividen en secciones
    de n bits, se suman con aritmética de complemento a uno, y el complemento de esa suma es la suma de
    comprobación. El receptor repite la suma; si el complemento del resultado es 0, acepta.`
};

/* ---- VRC ---- */
function computeVRC(bits){
  const parityBit = xorParity(bits); // bit added to make total parity even
  return { codeword: bits + parityBit, parityBit };
}
function checkVRC(received){
  const ones = received.split("").filter(b=>b==="1").length;
  return ones % 2 === 0; // true = accepted (even parity holds)
}

/* ---- LRC ---- */
function splitIntoRows(bits, rows){
  const rowLen = Math.ceil(bits.length / rows);
  const padded = bits.padEnd(rowLen*rows, "0");
  const out = [];
  for(let i=0;i<rows;i++) out.push(padded.slice(i*rowLen, (i+1)*rowLen));
  return out;
}
function computeLRCRow(rowsArr){
  const rowLen = rowsArr[0].length;
  let lrc = "";
  for(let col=0; col<rowLen; col++){
    let ones = 0;
    for(const row of rowsArr) if(row[col]==="1") ones++;
    lrc += (ones % 2).toString(); // even parity per column
  }
  return lrc;
}
function checkLRC(rowsArr, lrcRow){
  const recomputed = computeLRCRow(rowsArr);
  return recomputed === lrcRow;
}

/* ---- CRC (binary polynomial division, mod-2) ---- */
function xorStrings(a, b){
  let out = "";
  for(let i=0;i<a.length;i++) out += (a[i]===b[i]) ? "0" : "1";
  return out;
}
function crcDivide(dataPadded, divisor){
  // dataPadded already has (divisor.length-1) zero bits appended
  const dlen = divisor.length;
  let work = dataPadded.split("");
  for(let i=0; i <= work.length - dlen; i++){
    if(work[i] === "1"){
      for(let j=0;j<dlen;j++){
        work[i+j] = (work[i+j] === divisor[j]) ? "0" : "1";
      }
    }
  }
  return work.join("").slice(work.length - (dlen-1));
}
function computeCRC(bits, divisor){
  const n = divisor.length - 1;
  const padded = bits + "0".repeat(n);
  const remainder = crcDivide(padded, divisor);
  return { remainder, codeword: bits + remainder };
}
function checkCRC(received, divisor){
  const remainder = crcDivide(received, divisor);
  return remainder.split("").every(b=>b==="0");
}

/* ---- Checksum (one's complement arithmetic) ---- */
function onesComplementAdd(a, b){
  // a, b same length binary strings
  const n = a.length;
  let carry = 0;
  let result = new Array(n).fill("0");
  for(let i=n-1;i>=0;i--){
    const sum = parseInt(a[i],10) + parseInt(b[i],10) + carry;
    result[i] = (sum % 2).toString();
    carry = sum >= 2 ? 1 : 0;
  }
  let res = result.join("");
  if(carry === 1){
    // end-around carry: add 1 to result
    res = onesComplementAddCarryOnly(res);
  }
  return res;
}
function onesComplementAddCarryOnly(bits){
  // adds binary 1 to bits string, with wraparound (end-around) if it overflows
  let arr = bits.split("");
  let carry = 1;
  for(let i=arr.length-1; i>=0 && carry; i--){
    const sum = parseInt(arr[i],10) + carry;
    arr[i] = (sum % 2).toString();
    carry = sum >= 2 ? 1 : 0;
  }
  return arr.join("");
}
function onesComplement(bits){
  return bits.split("").map(b => b==="1" ? "0":"1").join("");
}
function sumSections(sections){
  let acc = sections[0];
  for(let i=1;i<sections.length;i++){
    acc = onesComplementAdd(acc, sections[i]);
  }
  return acc;
}
function computeChecksum(bits, n){
  const padded = bits.length % n === 0 ? bits : bits.padEnd(Math.ceil(bits.length/n)*n, "0");
  const sections = [];
  for(let i=0;i<padded.length;i+=n) sections.push(padded.slice(i,i+n));
  const sum = sumSections(sections);
  const checksum = onesComplement(sum);
  return { sections, sum, checksum, codeword: padded + checksum };
}
function checkChecksum(received, n){
  const sections = [];
  for(let i=0;i<received.length;i+=n) sections.push(received.slice(i,i+n));
  const sum = sumSections(sections);
  const comp = onesComplement(sum);
  return comp.split("").every(b=>b==="0");
}

/* ---- error injection helper: flips a short burst of bits ---- */
function injectBurstError(bits, burstLen){
  if(bits.length < 2) return bits;
  const start = Math.floor(Math.random() * Math.max(1, bits.length - 1));
  const len = Math.min(burstLen, bits.length - start, bits.length);
  let arr = bits.split("");
  const flippedPositions = [];
  for(let i=0;i<len;i++){
    // flip roughly half the bits in the burst window, at least 1
    if(Math.random() < 0.6 || i===0){
      const idx = start+i;
      arr[idx] = arr[idx]==="1" ? "0" : "1";
      flippedPositions.push(idx);
    }
  }
  return { result: arr.join(""), flippedPositions };
}

function renderBitstring(container, bits, flippedSet){
  container.innerHTML = "";
  const span = document.createElement("span");
  span.className = "bitstring";
  bits.split("").forEach((b, i)=>{
    const c = document.createElement("span");
    c.textContent = b;
    if(flippedSet && flippedSet.has(i)) c.className = "flip";
    span.appendChild(c);
  });
  container.appendChild(span);
}

/* ================= CORRECCIÓN DE ERRORES: HAMMING ================= */

function isPowerOfTwo(n){ return (n & (n-1)) === 0; }

function hammingTotalBits(m){
  // smallest r such that 2^r >= m + r + 1
  let r = 0;
  while(Math.pow(2,r) < m + r + 1) r++;
  return m + r;
}

function hammingRedundancyInfo(m){
  // Igual que hammingTotalBits, pero devuelve también r por separado
  // para poder mostrar la fórmula 2^r >= m + r + 1 con sus valores reales.
  let r = 0;
  while(Math.pow(2,r) < m + r + 1) r++;
  return { m, r, total: m + r };
}

function buildHammingFrame(dataBits){
  const m = dataBits.length;
  const total = hammingTotalBits(m);
  // positions are 1-indexed; redundancy positions are powers of two
  const frame = new Array(total+1).fill(null); // index 0 unused
  for(let pos=1; pos<=total; pos++){
    if(isPowerOfTwo(pos)) frame[pos] = { type:"r", value: null };
  }
  // Data bits are placed starting from the HIGHEST data position down to
  // the lowest (matches the textbook convention: position 11 gets the
  // first data bit, then 10, 9, 7, 6, 5, 3, ...).
  const dataPositions = [];
  for(let pos=total; pos>=1; pos--) if(!isPowerOfTwo(pos)) dataPositions.push(pos);
  dataPositions.forEach((pos, i) => {
    frame[pos] = { type:"d", value: dataBits[i] };
  });
  // compute each r bit: even parity over positions whose AND with r's position bit != 0, including itself
  const rPositions = [];
  for(let p=1;p<=total;p++) if(isPowerOfTwo(p)) rPositions.push(p);

  rPositions.forEach(rPos=>{
    let ones = 0;
    const covered = [];
    for(let pos=1; pos<=total; pos++){
      if(pos === rPos) continue; // r bit itself starts at 0, not counted yet
      if((pos & rPos) !== 0){
        covered.push(pos);
        if(frame[pos].value === "1") ones++;
      }
    }
    frame[rPos].value = (ones % 2).toString(); // even parity
    frame[rPos].covered = covered;
  });

  return { frame, total, rPositions };
}

function frameToString(frame, total){
  // Rendered left-to-right as in the textbook: highest position first.
  let s = "";
  for(let i=total;i>=1;i--) s += frame[i].value;
  return s;
}

function dataOnlyString(frame, total){
  // Reconstruye solo los bits de datos (sin los bits de redundancia r),
  // en el mismo orden de lectura izquierda→derecha (posición alta a baja).
  let s = "";
  for(let i=total;i>=1;i--){
    if(frame[i].type === "d") s += frame[i].value;
  }
  return s;
}

function hammingCheck(receivedFrame, total){
  // receivedFrame: array indexed 1..total of '0'/'1'
  const rPositions = [];
  for(let p=1;p<=total;p++) if(isPowerOfTwo(p)) rPositions.push(p);
  // recompute parity for each rPos INCLUDING the r bit itself this time -> should be 0 if no error
  const checkBits = []; // ordered from most significant power down for syndrome assembly
  rPositions.forEach(rPos=>{
    let ones = 0;
    for(let pos=1; pos<=total; pos++){
      if((pos & rPos) !== 0){
        if(receivedFrame[pos] === "1") ones++;
      }
    }
    checkBits.push({ rPos, fail: (ones % 2) }); // 1 = mismatch contributes
  });
  // syndrome = sum of rPos where fail=1
  let syndrome = 0;
  checkBits.forEach(cb => { if(cb.fail) syndrome += cb.rPos; });
  return { syndrome, checkBits };
}

/* =========================================================================
   UI WIRING
   ========================================================================= */

document.addEventListener("DOMContentLoaded", () => {
  renderHeroWave();
  wireLineSection();
  wireDetSection();
  wireHamSection();
});

/* ---------- Section 1: Line codes ---------- */
function wireLineSection(){
  const bitsInput = document.getElementById("lineBits");
  const helpEl = document.getElementById("lineBitsHelp");
  const pills = document.querySelectorAll("#lineSchemePills .pill");
  const runBtn = document.getElementById("lineRunBtn");
  const svg = document.getElementById("lineSvg");
  const scopeLabel = document.getElementById("lineScopeLabel");
  const outBits = document.getElementById("lineOutBits");
  const outTrans = document.getElementById("lineOutTransitions");
  const outRule = document.getElementById("lineOutRule");
  const theoryBody = document.getElementById("lineTheoryBody");

  let currentScheme = "NRZL";

  pills.forEach(p=>{
    p.addEventListener("click", ()=>{
      pills.forEach(x=>x.classList.remove("active"));
      p.classList.add("active");
      currentScheme = p.dataset.scheme;
      run();
    });
  });

  function run(){
    const bits = validateBits(bitsInput.value, 14, helpEl, "01001101100101");
    const encoder = ENCODERS[currentScheme];
    const samples = encoder(bits);
    const isHalf = HALF_SAMPLE_SCHEMES.has(currentScheme);
    renderWaveform(svg, bits, samples, isHalf, { scheme: currentScheme, height: 220 });

    const labelMap = {NRZL:"NRZ-L", NRZI:"NRZI", AMI:"AMI", MLT3:"MLT-3", MANCH:"Manchester", MANCHD:"Manchester Diferencial"};
    scopeLabel.textContent = labelMap[currentScheme];
    outBits.textContent = bits;
    outTrans.textContent = countTransitions(samples) + (isHalf ? " (incluye medios bits)" : "");
    outRule.textContent = LINE_RULES[currentScheme];
    theoryBody.innerHTML = LINE_THEORY[currentScheme];
  }

  runBtn.addEventListener("click", run);
  bitsInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") run(); });

  run();
}

/* ---------- Section 2: Error detection ---------- */
function wireDetSection(){
  const bitsInput = document.getElementById("detBits");
  const helpEl = document.getElementById("detBitsHelp");
  const pills = document.querySelectorAll("#detSchemePills .pill");
  const runBtn = document.getElementById("detRunBtn");
  const traceEl = document.getElementById("detTrace");
  const readoutEl = document.getElementById("detReadout");
  const theoryBody = document.getElementById("detTheoryBody");
  const injectCheckbox = document.getElementById("detInjectError");

  const lrcRowsField = document.getElementById("lrcRowsField");
  const crcPolyField = document.getElementById("crcPolyField");
  const chkSizeField = document.getElementById("chkSizeField");
  const lrcRowsSel = document.getElementById("lrcRows");
  const crcPolySel = document.getElementById("crcPoly");
  const chkSizeSel = document.getElementById("chkSize");

  let currentScheme = "VRC";

  function syncFieldVisibility(){
    lrcRowsField.style.display = currentScheme === "LRC" ? "" : "none";
    crcPolyField.style.display = currentScheme === "CRC" ? "" : "none";
    chkSizeField.style.display = currentScheme === "CHK" ? "" : "none";
  }

  pills.forEach(p=>{
    p.addEventListener("click", ()=>{
      pills.forEach(x=>x.classList.remove("active"));
      p.classList.add("active");
      currentScheme = p.dataset.scheme;
      syncFieldVisibility();
      run();
    });
  });
  [lrcRowsSel, crcPolySel, chkSizeSel, injectCheckbox].forEach(el=>{
    el.addEventListener("change", run);
  });

  function traceRow(label, contentHtml){
    const row = document.createElement("div");
    row.style.marginBottom = "14px";
    row.innerHTML = `<div style="font-size:10.5px; letter-spacing:1px; text-transform:uppercase; color:var(--ink-dim); margin-bottom:6px;">${label}</div>${contentHtml}`;
    return row;
  }
  function bitHtml(bits, flippedSet){
    let html = `<span class="bitstring" style="font-size:16px;">`;
    bits.split("").forEach((b,i)=>{
      const cls = (flippedSet && flippedSet.has(i)) ? "flip" : "";
      html += `<span class="${cls}">${b}</span>`;
    });
    html += `</span>`;
    return html;
  }

  function run(){
    const bits = validateBits(bitsInput.value, 14, helpEl, "1100001110100101");
    traceEl.innerHTML = "";
    readoutEl.innerHTML = "";
    theoryBody.innerHTML = DET_THEORY[currentScheme];

    if(currentScheme === "VRC"){
      const { codeword, parityBit } = computeVRC(bits);
      traceEl.appendChild(traceRow("Emisor — Datos", bitHtml(bits)));
      traceEl.appendChild(traceRow("Emisor — Trama enviada (datos + bit VRC)", bitHtml(codeword)));

      let received = codeword;
      let flipped = new Set();
      if(injectCheckbox.checked){
        const r = injectBurstError(codeword, 1);
        received = r.result; flipped = new Set(r.flippedPositions);
      }
      traceEl.appendChild(traceRow("Canal — Trama recibida", bitHtml(received, flipped)));

      const accepted = checkVRC(received);
      readoutEl.innerHTML = `
        <div><div class="k">Bit de paridad (par) generado</div><div class="v good">${parityBit}</div></div>
        <div><div class="k">Decisión del receptor</div><div class="v ${accepted?'good':'bad'}">${accepted ? "ACEPTAR ✓" : "RECHAZAR ✕"}</div></div>
        <div><div class="k">Nota</div><div class="v" style="font-size:12px; color:var(--ink-dim);">VRC solo garantiza detección si el total de bits invertidos es impar.</div></div>
      `;
    }

    if(currentScheme === "LRC"){
      const rows = parseInt(lrcRowsSel.value, 10);
      const rowsArr = splitIntoRows(bits, rows);
      const lrcRow = computeLRCRow(rowsArr);
      traceEl.appendChild(traceRow("Emisor — Bloque dividido en filas", rowsArr.map(r=>bitHtml(r)).join("<br>")));
      traceEl.appendChild(traceRow("Emisor — Fila LRC añadida (XOR por columna)", bitHtml(lrcRow)));

      let recvRows = rowsArr.slice();
      let recvLrc = lrcRow;
      let flippedInfo = [];
      if(injectCheckbox.checked){
        const flatLen = rowsArr.join("").length;
        const r = injectBurstError(rowsArr.join(""), 2);
        const flat = r.result;
        recvRows = [];
        const rowLen = rowsArr[0].length;
        for(let i=0;i<rows;i++) recvRows.push(flat.slice(i*rowLen, (i+1)*rowLen));
        flippedInfo = r.flippedPositions;
      }
      traceEl.appendChild(traceRow("Canal — Filas recibidas", recvRows.map((r,ri)=>{
        const rowLen = r.length;
        const fset = new Set(flippedInfo.filter(p => Math.floor(p/rowLen)===ri).map(p => p % rowLen));
        return bitHtml(r, fset);
      }).join("<br>")));

      const accepted = checkLRC(recvRows, recvLrc);
      readoutEl.innerHTML = `
        <div><div class="k">LRC calculado (emisor)</div><div class="v good">${lrcRow}</div></div>
        <div><div class="k">LRC recalculado (receptor)</div><div class="v">${computeLRCRow(recvRows)}</div></div>
        <div><div class="k">Decisión del receptor</div><div class="v ${accepted?'good':'bad'}">${accepted ? "ACEPTAR ✓" : "RECHAZAR — se descarta el bloque ✕"}</div></div>
      `;
    }

    if(currentScheme === "CRC"){
      const divisor = crcPolySel.value;
      const { remainder, codeword } = computeCRC(bits, divisor);
      traceEl.appendChild(traceRow("Emisor — Datos + ceros (N bits, N=len(divisor)-1)", bitHtml(bits + "0".repeat(divisor.length-1))));
      traceEl.appendChild(traceRow(`Divisor (${divisor.length} bits)`, `<span class="bitstring" style="color:var(--amber);">${divisor}</span>`));
      traceEl.appendChild(traceRow("Resto = CRC", bitHtml(remainder)));
      traceEl.appendChild(traceRow("Emisor — Trama enviada (datos + CRC)", bitHtml(codeword)));

      let received = codeword;
      let flipped = new Set();
      if(injectCheckbox.checked){
        const r = injectBurstError(codeword, 2);
        received = r.result; flipped = new Set(r.flippedPositions);
      }
      traceEl.appendChild(traceRow("Canal — Trama recibida", bitHtml(received, flipped)));

      const accepted = checkCRC(received, divisor);
      const recvRemainder = crcDivide(received, divisor);
      readoutEl.innerHTML = `
        <div><div class="k">CRC generado</div><div class="v good">${remainder}</div></div>
        <div><div class="k">Resto al verificar en receptor</div><div class="v">${recvRemainder}</div></div>
        <div><div class="k">Decisión del receptor</div><div class="v ${accepted?'good':'bad'}">${accepted ? "ACEPTAR ✓ (resto = 0)" : "RECHAZAR ✕ (resto ≠ 0)"}</div></div>
      `;
    }

    if(currentScheme === "CHK"){
      const n = parseInt(chkSizeSel.value, 10);
      const { sections, sum, checksum, codeword } = computeChecksum(bits, n);
      traceEl.appendChild(traceRow(`Emisor — Secciones de ${n} bits`, sections.map(s=>bitHtml(s)).join(" &nbsp; ")));
      traceEl.appendChild(traceRow("Suma (complemento a uno)", bitHtml(sum)));
      traceEl.appendChild(traceRow("Suma de comprobación (complemento de la suma)", bitHtml(checksum)));
      traceEl.appendChild(traceRow("Emisor — Trama enviada (datos + checksum)", bitHtml(codeword)));

      let received = codeword;
      let flipped = new Set();
      if(injectCheckbox.checked){
        const r = injectBurstError(codeword, 2);
        received = r.result; flipped = new Set(r.flippedPositions);
      }
      traceEl.appendChild(traceRow("Canal — Trama recibida", bitHtml(received, flipped)));

      const accepted = checkChecksum(received, n);
      readoutEl.innerHTML = `
        <div><div class="k">Checksum generado</div><div class="v good">${checksum}</div></div>
        <div><div class="k">Decisión del receptor</div><div class="v ${accepted?'good':'bad'}">${accepted ? "ACEPTAR ✓ (complemento = 0)" : "RECHAZAR ✕ (complemento ≠ 0)"}</div></div>
      `;
    }
  }

  runBtn.addEventListener("click", run);
  bitsInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") run(); });

  syncFieldVisibility();
  run();
}

/* ---------- Section 3: Hamming correction ---------- */
function wireHamSection(){
  const bitsInput = document.getElementById("hamBits");
  const helpEl = document.getElementById("hamBitsHelp");
  const flipSelect = document.getElementById("hamFlip");
  const runBtn = document.getElementById("hamRunBtn");
  const frameEl = document.getElementById("hamFrame");
  const readoutEl = document.getElementById("hamReadout");

  const modePills = document.querySelectorAll("#hamModePills .pill");
  const manualField = document.getElementById("hamManualField");
  const randomField = document.getElementById("hamRandomField");
  const randomBtn = document.getElementById("hamRandomBtn");
  const randomHelp = document.getElementById("hamRandomHelp");

  let mode = "manual"; // "manual" | "random"
  let randomFlipPos = 0; // 0 = sin error, recalculado por el botón de dados

  function syncModeVisibility(){
    manualField.style.display = mode === "manual" ? "" : "none";
    randomField.style.display = mode === "random" ? "" : "none";
  }

  modePills.forEach(p=>{
    p.addEventListener("click", ()=>{
      modePills.forEach(x=>x.classList.remove("active"));
      p.classList.add("active");
      mode = p.dataset.mode;
      syncModeVisibility();
      if(mode === "random"){
        rollRandomError(); // genera un error apenas se entra al modo
      } else {
        run();
      }
    });
  });

  function populateFlipOptions(total){
    flipSelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "0"; noneOpt.textContent = "Ninguno (transmisión sin error)";
    flipSelect.appendChild(noneOpt);
    for(let i=1;i<=total;i++){
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Bit ${i}`;
      flipSelect.appendChild(opt);
    }
  }

  function frameRowHtml(frame, total, highlightPositions){
    let html = `<table class="bittable"><tr>`;
    for(let p=total;p>=1;p--) html += `<th>${p}</th>`;
    html += `</tr><tr>`;
    for(let p=total;p>=1;p--){
      const cell = frame[p];
      let cls = cell.type === "r" ? "r-bit" : "d-bit";
      if(highlightPositions && highlightPositions.has(p)) cls += " changed";
      html += `<td class="${cls}">${cell.value}</td>`;
    }
    html += `</tr></table>`;
    return html;
  }

  function currentTotalBits(){
    const bits = validateBits(bitsInput.value, 14, helpEl, "10011010110010");
    return buildHammingFrame(bits).total;
  }

  function rollRandomError(){
    const total = currentTotalBits();
    // Posiciones posibles: 0 (sin error) hasta total. Se sortea entre 1..total
    // para que casi siempre haya un error que corregir, que es lo interesante
    // de probar; "0" sigue siendo seleccionable a mano si se quiere ver el caso limpio.
    randomFlipPos = Math.floor(Math.random() * total) + 1;
    randomHelp.innerHTML = `Último sorteo: <span style="color:var(--phosphor-soft);">bit ${randomFlipPos}</span> invertido. Vuelve a pulsar para sortear otra posición.`;
    run();
  }

  function run(){
    const bits = validateBits(bitsInput.value, 14, helpEl, "10011010110010");
    const m = bits.length;
    const { r, total } = hammingRedundancyInfo(m);
    const { frame, rPositions } = buildHammingFrame(bits);

    if(mode === "manual"){
      populateFlipOptions(total);
    } else {
      // si cambia la longitud de datos, el sorteo previo puede quedar fuera de rango
      if(randomFlipPos > total) randomFlipPos = total;
    }

    // ---- Bloque de fórmula: 2^r >= m + r + 1 ----
    const cumple = Math.pow(2, r) >= m + r + 1;
    frameEl.innerHTML = `
      <div style="margin-bottom:16px; padding:12px 14px; border:1px solid var(--line); background:var(--bg);">
        <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--phosphor-dim); margin-bottom:8px;">Cálculo de bits de redundancia</div>
        <div style="font-family:var(--mono); font-size:15px; color:var(--ink);">
          2<sup>r</sup> ≥ m + r + 1
        </div>
        <div style="font-family:var(--mono); font-size:15px; margin-top:6px; color:var(--phosphor-soft);">
          2<sup>${r}</sup> ≥ ${m} + ${r} + 1 &nbsp;→&nbsp; ${Math.pow(2,r)} ≥ ${m + r + 1} &nbsp;
          <span style="color:${cumple ? 'var(--phosphor)' : 'var(--red)'};">${cumple ? '✓ se cumple' : '✕ no se cumple'}</span>
        </div>
        <div style="font-size:12px; color:var(--ink-dim); margin-top:8px;">
          m = ${m} bits de datos &nbsp;|&nbsp; r = ${r} bits de redundancia &nbsp;|&nbsp; total = m + r = <strong style="color:var(--ink);">${total} bits</strong>
        </div>
      </div>
    `;

    frameEl.innerHTML += `<div style="margin-bottom:8px; font-size:11.5px; color:var(--ink-dim);">d = bit de dato &nbsp;|&nbsp; <span style="color:var(--amber);">r = bit de redundancia (paridad par)</span></div>`;
    frameEl.innerHTML += frameRowHtml(frame, total);

    const sentFrame = {};
    for(let p=1;p<=total;p++) sentFrame[p] = frame[p].value;

    const flipPos = mode === "manual"
      ? parseInt(flipSelect.value || "0", 10)
      : randomFlipPos;

    const receivedFrame = Object.assign({}, sentFrame);
    if(flipPos > 0){
      receivedFrame[flipPos] = receivedFrame[flipPos] === "1" ? "0" : "1";
    }

    if(flipPos > 0){
      const recvDisplayFrame = {};
      for(let p=1;p<=total;p++) recvDisplayFrame[p] = { value: receivedFrame[p], type: frame[p].type };
      const origenTxt = mode === "random" ? "error aleatorio" : "error manual";
      frameEl.innerHTML += `<div style="margin:14px 0 6px; font-size:11.5px; color:var(--red);">Trama recibida (${origenTxt} — bit ${flipPos} dañado, resaltado en rojo):</div>`;
      frameEl.innerHTML += frameRowHtml(recvDisplayFrame, total, new Set([flipPos]));
    }

    const { syndrome, checkBits } = hammingCheck(receivedFrame, total);

    let correctedFrame = Object.assign({}, receivedFrame);
    if(syndrome > 0){
      correctedFrame[syndrome] = correctedFrame[syndrome] === "1" ? "0" : "1";
      const corrDisplayFrame = {};
      for(let p=1;p<=total;p++) corrDisplayFrame[p] = { value: correctedFrame[p], type: frame[p].type };
      frameEl.innerHTML += `<div style="margin:14px 0 6px; font-size:11.5px; color:var(--phosphor-dim);">Trama corregida (bit ${syndrome} invertido de vuelta, resaltado):</div>`;
      frameEl.innerHTML += frameRowHtml(corrDisplayFrame, total, new Set([syndrome]));
    }

    const syndromeBin = syndrome.toString(2).padStart(Math.ceil(Math.log2(total+1)), "0");
    const dataMatches = Object.keys(correctedFrame).every(p => correctedFrame[p] === sentFrame[p]);

    // ---- Trama enviada SOLO con los datos (sin bits de redundancia) ----
    const soloDatos = dataOnlyString(frame, total);
    const errorEnDato = flipPos > 0 && frame[flipPos].type === "d";

    readoutEl.innerHTML = `
      <div><div class="k">m + r → total transmitido</div><div class="v">${m} + ${r} = ${total} bits</div></div>
      <div><div class="k">Trama enviada (solo datos, sin redundancia)</div><div class="v good">${soloDatos}</div></div>
      <div><div class="k">Bits de redundancia (posiciones)</div><div class="v">${rPositions.join(", ")}</div></div>
      <div><div class="k">Origen del error</div><div class="v ${flipPos>0?'bad':''}">${flipPos===0 ? "ninguno" : `${mode === "random" ? "aleatorio" : "manual"} — bit ${flipPos}${errorEnDato ? " (dato)" : " (redundancia)"}`}</div></div>
      <div><div class="k">Síndrome (posición señalada)</div><div class="v ${syndrome>0?'bad':'good'}">${syndrome === 0 ? "0 — sin error" : `${syndrome} → binario ${syndromeBin}`}</div></div>
      <div><div class="k">Resultado</div><div class="v ${dataMatches?'good':'bad'}">${syndrome===0 ? "Trama íntegra ✓" : (dataMatches ? "Error localizado y corregido ✓" : "Revisar — no coincide ✕")}</div></div>
    `;
  }

  runBtn.addEventListener("click", run);
  flipSelect.addEventListener("change", run);
  randomBtn.addEventListener("click", rollRandomError);
  bitsInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") run(); });
  bitsInput.addEventListener("change", ()=>{ if(mode === "random") rollRandomError(); });

  // initial population requires a first pass before listeners on select exist meaningfully
  const initialBits = validateBits(bitsInput.value, 14, helpEl, "10011010110010");
  const initial = buildHammingFrame(initialBits);
  populateFlipOptions(initial.total);
  syncModeVisibility();
  run();
}
