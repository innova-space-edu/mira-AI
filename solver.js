// solver.js — Motor universal con pasos + OCR + gráficos + fallback LLM
// Requiere: mathjs (window.math), nerdamer (global), ChartHelper (charts.js) y tus endpoints OCR/LLM.

const OCR_ENDPOINTS = ["/api/ocrspace", "/.netlify/functions/ocrspace"];
const CHAT_ENDPOINTS = ["/api/chat", "/.netlify/functions/chat"]; // tu proxy a Groq/OpenRouter

// ---------- Utilidades ----------
const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-12 ? String(Math.round(v)) : String(+Number(v).toFixed(6)));
const mdList = (arr)=>arr.map(s=>`- ${s}`).join("\n");
const clean = (t)=>String(t||"").replace(/[−–—]/g,"-").replace(/\s+/g," ").trim();

async function ocrJoin(files){
  if(!files?.length) return "";
  let text = "";
  for(const file of files){
    for(const url of OCR_ENDPOINTS){
      try{
        const fd = new FormData(); fd.append("file", file);
        const r = await fetch(url, {method:"POST", body:fd});
        if(r.ok){ const j=await r.json();
          const t = j?.text ?? j?.ParsedResults?.[0]?.ParsedText ?? "";
          if(t?.trim()){ text += "\n"+t; break; }
        }
      }catch{}
    }
  }
  return text.trim();
}

async function llmJSON(system, user){
  for(const url of CHAT_ENDPOINTS){
    try{
      const r = await fetch(url, {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0.2,
          response_format: { type:"json_object" },
          messages: [
            {role:"system", content: system},
            {role:"user", content: user}
          ]
        })
      });
      if(r.ok){
        const data = await r.json();
        const txt = data?.choices?.[0]?.message?.content ?? "{}";
        return JSON.parse(txt);
      }
    }catch{}
  }
  return null;
}

// ---------- Clasificador simple ----------
function classify(raw){
  const t = clean(raw).toLowerCase();

  if (/(gr[áa]fic[ao]|plot|diagrama|barras|histograma|pastel|circular|torta|dispersi[oó]n|scatter|regresi[oó]n)/i.test(t))
    return {type:"chart"};

  const hasEq = t.includes("=") || /resolver|soluciona/.test(t);
  if(/sistema/.test(t) && hasEq) return {type:"system"};
  if(/derivada|d\/dx|derivative/.test(t)) return {type:"derivative"};
  if(/integral|∫/.test(t)) return {type:"integral"};
  if(/l[ií]mite|limit/.test(t)) return {type:"limit"};
  if(/dominio|rango|as[ií]ntota|cortes? con/.test(t)) return {type:"function_analysis"};
  if(/media|promedio|varianza|desviaci[oó]n/.test(t)) return {type:"stats"};
  if(/regresi[oó]n/.test(t)) return {type:"regression"};
  if(/f[ií]sica|velocidad|aceleraci[oó]n|fuerza|trabajo|energ[ií]a|presi[oó]n|densidad|ohm|v=|p=|f=|i=/.test(t)) return {type:"physics"};
  if(hasEq) return {type:"equation"};
  return {type:"unknown"};
}

// ---------- Parsers ----------
// ecuaciones multilinea "lhs=rhs"
function parseEquations(raw){
  const lines = raw.split(/\n+/).map(s=>s.trim()).filter(s=>/=/.test(s));
  const eqs = [];
  const vars = new Set();
  for(const L0 of lines){
    const [lhs, rhs] = L0.split("=").map(s=>s.replace(/\s+/g,""));
    if(!lhs||rhs===undefined) continue;
    for(const m of lhs.matchAll(/[a-zA-Z]+/g)) vars.add(m[0]);
    for(const m of rhs.matchAll(/[a-zA-Z]+/g)) vars.add(m[0]);
    eqs.push([lhs, rhs]);
  }
  return {eqs, vars: Array.from(vars)};
}

// ---------- Solvers con pasos ----------
function solveEquationGeneric(text){
  const m = text.match(/(.+?)=(.+)/);
  if(!m) return null;
  let [_, L, R] = m; L=L.trim(); R=R.trim();

  const vars = (L+R).match(/[a-zA-Z]+/g) || ["x"];
  const variable = vars.sort((a,b)=> (L+R).split(a).length - (L+R).split(b).length ).pop();

  try{
    const sol = nerdamer(`solve((${L})-(${R}), ${variable})`).evaluate();
    const sols = sol.toString().replace(/^\[|\]$/g,"").split(",").map(s=>s.trim()).filter(Boolean);
    const steps = [
      "Lleva todo al mismo lado: \( "+L+"-"+R+"=0 \).",
      "Identifica el tipo de ecuación (lineal, cuadrática, factorable, etc.).",
      "Aplica el método correspondiente (aislamiento, factorización, fórmula general o numérico).",
      "Verifica sustituyendo la(s) solución(es) en la ecuación original."
    ];
    const res = sols.map((s,i)=>`- ${variable}_${i+1} = \\( ${s.replace(/\*/g,"\\cdot ")} \\)`).join("\n");
    return `### Ecuación\n${mdList(steps)}\n\n**Solución(es):**\n${res}`;
  }catch{
    return null;
  }
}

function parseLinearSystemToAb(eqPairs, varsHint=[]){
  const vars = varsHint.length? varsHint : Array.from(new Set((eqPairs.flat().join("")).match(/[a-zA-Z]+/g)||["x","y"]));
  const A=[], b=[];
  for(const [L,R] of eqPairs){
    const row = vars.map(v=>{
      // suma coeficientes de v en L
      let s=0;
      const re = new RegExp(`([+\\-]?\\d*(?:\\.\\d+)?)(?=${v})(?:${v})`, "g");
      for(const m of L.replace(/\s+/g,"").matchAll(re)){
        let c = m[1]; if(c===""||c==="+") c="1"; if(c==="-" ) c="-1"; s += parseFloat(c);
      }
      return s;
    });
    const Br = math.evaluate(R); // eval num si procede
    A.push(row); b.push(Br);
  }
  return {A,b,vars};
}

function solveByElimination(Ain, bin){
  const A = Ain.map(r=>r.slice()), b=bin.slice();
  const n=A.length, m=A[0].length;
  if(n!==m) return {ok:false, reason:"Sistema no cuadrado"};
  const steps=[];
  for(let col=0,row=0; col<m && row<n; col++,row++){
    let piv=row;
    for(let r=row+1;r<n;r++) if(Math.abs(A[r][col])>Math.abs(A[piv][col])) piv=r;
    if(Math.abs(A[piv][col])<1e-12) return {ok:false,reason:"Pivote cero (indeterminado)"};
    if(piv!==row){ [A[row],A[piv]]=[A[piv],A[row]]; [b[row],b[piv]]=[b[piv],b[row]]; steps.push(`Intercambio R${row+1} ↔ R${piv+1}`); }
    const p=A[row][col]; for(let c=col;c<m;c++) A[row][c]/=p; b[row]/=p; steps.push(`R${row+1} := R${row+1} / ${fmt(p)}`);
    for(let r=0;r<n;r++) if(r!==row){
      const f=A[r][col]; if(Math.abs(f)>1e-12){
        for(let c=col;c<m;c++) A[r][c]-=f*A[row][c]; b[r]-=f*b[row]; steps.push(`R${r+1} := R${r+1} − (${fmt(f)})·R${row+1}`);
      }
    }
  }
  const x=b.map(fmt);
  return {ok:true, x, steps};
}

function solveSystem(raw){
  const {eqs, vars} = parseEquations(raw);
  if(eqs.length<2) return null;
  const {A,b,vars:V} = parseLinearSystemToAb(eqs, vars);
  const sol = solveByElimination(A,b);
  if(!sol.ok) return null;
  const lines = sol.steps;
  lines.push("", "**Resultado:**");
  V.forEach((v,i)=>lines.push(`- ${v} = ${sol.x[i]}`));
  return `### Sistema por **reducción (Gauss)**\n${lines.join("\n")}`;
}

function solveDerivative(raw){
  const m = raw.match(/d\/d([a-z])\s*\((.+)\)|derivada\s+de\s+(.+?)\s+respecto\s+a\s+([a-z])/i);
  let variable="x", expr=null;
  if(m){
    if(m[1] && m[2]){ variable=m[1]; expr=m[2]; }
    else if(m[3] && m[4]){ expr=m[3]; variable=m[4]; }
  }else{
    const mm = raw.match(/derivada.*?de\s+(.+)/i); if(mm) expr=mm[1];
  }
  if(!expr) return null;
  try{
    const d = nerdamer.diff(expr, variable).toTeX();
    const rules = [];
    if(/\*/.test(expr)) rules.push("Producto");
    if(/\//.test(expr)) rules.push("Cociente");
    if(/\^/.test(expr)) rules.push("Potencia");
    if(/sin|cos|tan|ln|log|exp/.test(expr)) rules.push("Funciones elementales");
    if(/\(([^)]+)\)/.test(expr)) rules.push("Regla de la cadena (si corresponde)");
    const steps = [
      `Identifica reglas: ${rules.length?rules.join(", "):"linealidad / potencia"}.`,
      "Aplica las reglas término a término.",
      "Simplifica el resultado final."
    ];
    return `### Derivada\n${mdList(steps)}\n\n**Resultado:**\n\\[ \\frac{d}{d${variable}}\\left(${expr}\\right)= ${d} \\]`;
  }catch{ return null; }
}

function solveIntegral(raw){
  const m = raw.match(/∫\s*(.+)\s*d([a-z])|integral\s+de\s+(.+?)\s+d([a-z])/i);
  if(!m) return null;
  const expr = (m[1]??m[3]).trim(), variable=(m[2]??m[4]??"x").trim();
  try{
    const I = nerdamer(`integrate(${expr}, ${variable})`).toTeX();
    const steps = [
      "Identifica el tipo de integrando (polinomio, potencia, trigonométrica, etc.).",
      "Aplica reglas básicas (potencia, linealidad) o sustitución simple si procede.",
      "Añade la constante de integración \\(C\\)."
    ];
    return `### Integral indefinida\n${mdList(steps)}\n\n**Resultado:**\n\\[ \\int ${expr}\\, d${variable} = ${I} + C \\]`;
  }catch{ return null; }
}

function solveLimit(raw){
  const m = raw.match(/lim\s*_{?\s*([a-z])\s*->\s*([^\s}]+)\s*}?[\s,;:]*\(?(.+)\)?/i) || raw.match(/l[ií]mite.*?([a-z])\s*→\s*([^\s]+).*?:\s*(.+)/i);
  if(!m) return null;
  const variable=m[1], point=m[2], expr=m[3];
  try{
    const L = nerdamer(`limit(${expr}, ${variable}, ${point})`).toTeX();
    const steps=[
      "Evalúa sustituyendo el punto objetivo.",
      "Si hay indeterminación, factoriza/racionaliza o usa L’Hôpital (si aplica).",
      "Simplifica y vuelve a evaluar."
    ];
    return `### Límite\n${mdList(steps)}\n\n**Resultado:**\n\\[ \\lim_{${variable}\\to ${point}} ${expr} = ${L} \\]`;
  }catch{ return null; }
}

function solveFunctionAnalysis(raw){
  const m = raw.match(/f\(\s*([a-z])\s*\)\s*=\s*(.+)/i);
  if(!m) return null;
  const variable=m[1], fexpr=m[2];
  try{
    const f = nerdamer(fexpr);
    const denom = nerdamer(`denominator(${fexpr})`).toString();
    let dominio = "Todos los reales";
    if(denom!=="1"){
      const roots = nerdamer(`solve(${denom}=0, ${variable})`).toString().replace(/^\[|\]$/g,"");
      dominio = `Reales excepto donde ${denom}=0 → ${roots||"sin solución cerrada"}`;
    }
    const y0 = nerdamer(fexpr,{[variable]:0}).toTeX();
    const roots = nerdamer(`solve(${fexpr}=0, ${variable})`).toString().replace(/^\[|\]$/g,"");
    const dfx = nerdamer.diff(fexpr, variable).toTeX();
    return `### Análisis de función\n- **Dominio:** ${dominio}\n- **Corte con eje y:** \\(f(0)=${y0}\\)\n- **Raíces:** ${roots||"no halladas en cerrado"}\n- **Derivada:** \\(f'(${variable})=${dfx}\\)\n`;
  }catch{ return null; }
}

function solveStats(raw){
  const m = raw.match(/(\-?\d+(?:\.\d+)?(?:\s*,\s*\-?\d+(?:\.\d+)?)+)/);
  if(!m) return null;
  const arr = m[1].split(",").map(s=>+s.trim());
  const n=arr.length, sum=arr.reduce((a,b)=>a+b,0), mean=sum/n;
  const sq=arr.map(x=>(x-mean)**2), varp=sq.reduce((a,b)=>a+b,0)/n, sd=Math.sqrt(varp);
  const steps=[
    `Cuenta de datos: n=${n}`,
    `Suma: ${fmt(sum)}`,
    `Media: \\(\\bar{x}= ${fmt(sum)}/${n} = ${fmt(mean)}\\)`,
    `Varianza poblacional: \\(\\sigma^2=\\frac{\\sum (x_i-\\bar{x})^2}{n}=${fmt(varp)}\\)`,
    `Desviación estándar: \\(\\sigma=${fmt(sd)}\\)`
  ];
  return `### Estadística descriptiva\n${mdList(steps)}`;
}

function solveRegression(raw){
  const pairs = [...raw.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map(m=>[+m[1],+m[2]]);
  if(pairs.length<2) return null;
  const n=pairs.length, sx=pairs.reduce((a,[x])=>a+x,0), sy=pairs.reduce((a,[,y])=>a+y,0);
  const sxx=pairs.reduce((a,[x])=>a+x*x,0), sxy=pairs.reduce((a,[x,y])=>a+x*y,0);
  const num = n*sxy - sx*sy, den = n*sxx - sx*sx;
  const b1 = num/den, b0 = (sy - b1*sx)/n;
  const steps=[
    `n=${n},  Σx=${fmt(sx)},  Σy=${fmt(sy)},  Σx²=${fmt(sxx)},  Σxy=${fmt(sxy)}`,
    `Pendiente: \\(b_1=\\frac{n\\,Σxy-Σx\\,Σy}{n\\,Σx^2-(Σx)^2}=${fmt(b1)}\\)`,
    `Intercepto: \\(b_0=\\bar{y}-b_1\\bar{x}=${fmt(b0)}\\)`,
  ];
  return `### Regresión lineal (MCO)\n${mdList(steps)}\n\n**Recta estimada:** \\( \\hat{y}=${fmt(b0)}+${fmt(b1)}x \\)`;
}

function solvePhysics(raw){
  const known = Object.fromEntries([...raw.matchAll(/([a-zA-Z])\s*=\s*([0-9.]+)\s*([a-zA-Z/^\-0-9]*)/g)].map(m=>[m[1], `${m[2]} ${m[3]}`.trim()]));
  const ask = (raw.match(/encontra[rd]\s+([a-zA-Z])/i)||[])[1] || (raw.match(/\b([vaitpmdPF])\?\b/i)||[])[1];
  const formula = (raw.match(/v\s*=\s*[^,\n;]+|a\s*=\s*[^,\n;]+|f\s*=\s*[^,\n;]+|p\s*=\s*[^,\n;]+/i)||[])[0];
  if(!ask || !formula) return null;
  try{
    const varAsk = ask;
    const fEq = formula.replace(/\s+/g,"");
    const [lhs,rhs] = fEq.split("=");
    const sol = nerdamer(`solve(${lhs}-(${rhs}), ${varAsk})`).toString().replace(/^\[|\]$/g,"");
    let expr = sol; Object.entries(known).forEach(([k, val])=>{ expr = expr.replaceAll(new RegExp(`\\b${k}\\b`,"g"), `(${val})`); });
    const value = math.evaluate(expr); // mathjs maneja unidades
    const steps=[
      `Fórmula: \\(${lhs}=${rhs}\\)`,
      `Despeje de ${varAsk}: \\(${varAsk}=${nerdamer(sol).toTeX()}\\)`,
      `Sustitución de valores con unidades.`,
      `Cálculo numérico y verificación dimensional.`
    ];
    return `### Problema de física (análisis dimensional)\n${mdList(steps)}\n\n**Resultado:** ${value.toString()}`;
  }catch{ return null; }
}

// ---------- Gráficos ----------
function solveChart(raw, addAssistantMessage){
  const isBar   = /(barra|histograma)/i.test(raw);
  const isPie   = /(pastel|circular|torta|pie)/i.test(raw);
  const isLine  = /\bl[ií]nea(s)?\b|series?/i.test(raw);
  const isScatt = /(dispersi[oó]n|scatter)/i.test(raw);
  const wantsReg= /regresi[oó]n/i.test(raw);

  let oneD = window.ChartHelper?.parse1D(raw);
  const pairs = window.ChartHelper?.parsePairs(raw);

  if (pairs && (isScatt || wantsReg || !oneD)) {
    const {explanation} = window.ChartHelper.scatterChart(pairs, "Dispersión", wantsReg);
    addAssistantMessage(`### Dispersión ${wantsReg?"+ Regresión":""}\n${explanation}`);
    return true;
  }

  if (oneD){
    let out;
    if (isPie)       out = window.ChartHelper.pieChart(oneD, "Distribución");
    else if (isLine) out = window.ChartHelper.lineChart(oneD, "Serie temporal");
    else             out = window.ChartHelper.barChart(oneD, "Comparación");
    addAssistantMessage(`### Análisis del gráfico\n${out.explanation}`);
    return true;
  }
  return false;
}

// ---------- Orquestador principal ----------
async function trySolveUniversal({userText="", files=[]}, addAssistantMessage){
  let raw = userText;
  if(files?.length){
    const fromImg = await ocrJoin(files);
    if(fromImg) raw += "\n"+fromImg;
  }
  raw = clean(raw);

  const kind = classify(raw).type;

  if (kind === "chart") {
    const ok = solveChart(raw, addAssistantMessage);
    if (ok) return true;
  }

  const handlers = {
    equation: ()=>solveEquationGeneric(raw),
    system:   ()=>solveSystem(raw),
    derivative:()=>solveDerivative(raw),
    integral: ()=>solveIntegral(raw),
    limit:    ()=>solveLimit(raw),
    function_analysis:()=>solveFunctionAnalysis(raw),
    stats:    ()=>solveStats(raw),
    regression:()=>solveRegression(raw),
    physics:  ()=>solvePhysics(raw),
  };
  if(handlers[kind]){
    const md = handlers[kind]();
    if(md){ addAssistantMessage(md); return true; }
  }

  // Fallback LLM estructurado a JSON con pasos
  const system = `
Eres un solucionador paso a paso. DEVUELVE JSON con:
{ "tipo": "equacion|sistema|derivada|integral|limite|funcion|estadistica|regresion|fisica|historia|lenguaje|arte|otro",
  "enunciado_limpio": "...",
  "pasos": ["...","...","..."],
  "resultado_latex": "..." }
Da pasos claros y correctos; usa LaTeX en "resultado_latex" si aplica.`;
  const j = await llmJSON(system, raw);
  if(j?.pasos?.length){
    const md = `### ${j.tipo?.toUpperCase()||"PROBLEMA"}\n${mdList(j.pasos)}\n\n**Resultado:**\n${j.resultado_latex||"—"}`;
    addAssistantMessage(md);
    return true;
  }

  return false;
}

// Exponer en window
window.ProblemSolver = { trySolveUniversal };
