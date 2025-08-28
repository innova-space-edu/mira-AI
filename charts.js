// charts.js — Renderizador de gráficos con explicación
// Requiere: window.Chart (Chart.js) y chartjs-plugin-datalabels

(function(){
  if (window.Chart && window.Chart.register && window.ChartDataLabels) {
    window.Chart.register(window.ChartDataLabels);
  }

  const PALETTE = [
    "#60a5fa","#a78bfa","#34d399","#fbbf24",
    "#f87171","#22d3ee","#f472b6","#4ade80",
    "#fb7185","#93c5fd","#f59e0b","#06b6d4"
  ];

  const fmt = (v) => (Math.abs(v-Math.round(v))<1e-12 ? String(Math.round(v)) : String(+Number(v).toFixed(4)));

  // --- helpers de parseo ---
  function parse1D(text){
    // A:10, B=20; C 30 | filas "A - 10"
    const pairs = [...text.matchAll(/([A-Za-zÁÉÍÓÚÜÑ0-9_.\- ]+)\s*[:=\-]\s*(-?\d+(?:\.\d+)?)/g)]
      .map(m=>[m[1].trim(), +m[2]]);
    if (pairs.length) return { labels:pairs.map(p=>p[0]), values:pairs.map(p=>p[1]) };

    // alternativa "A 10, B 20"
    const parts = text.split(/[,;]\s*/).filter(Boolean);
    const labels=[], values=[];
    for(const part of parts){
      const m = part.match(/(.+?)\s+(-?\d+(?:\.\d+)?)/);
      if(m){ labels.push(m[1].trim()); values.push(+m[2]); }
    }
    return labels.length? {labels, values} : null;
  }

  function parsePairs(text){
    // pares (x,y)
    const pts = [...text.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)]
      .map(m=>({x:+m[1], y:+m[2]}));
    return pts.length? pts : null;
  }

  // regresión lineal simple
  function linearRegression(points){
    const n = points.length;
    let sx=0, sy=0, sxx=0, sxy=0;
    for(const {x,y} of points){ sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; }
    const den = n*sxx - sx*sx;
    const b1 = den===0 ? 0 : (n*sxy - sx*sy)/den;
    const b0 = sy/n - b1*(sx/n);
    // R^2
    const ybar = sy/n;
    let ssTot=0, ssRes=0;
    for(const {x,y} of points){
      const yhat = b0 + b1*x;
      ssTot += (y - ybar)**2;
      ssRes += (y - yhat)**2;
    }
    const r2 = ssTot===0 ? 1 : 1 - ssRes/ssTot;
    return {b0, b1, r2};
  }

  // crea un canvas dentro de un "bubble"
  function createCanvasBubble(){
    const wrap = document.createElement("div");
    wrap.className = "bubble assistant chart-bubble";
    const canvas = document.createElement("canvas");
    canvas.style.maxHeight = "420px";
    canvas.style.width = "100%";
    canvas.style.aspectRatio = "16/9";
    wrap.appendChild(canvas);
    const container = document.querySelector("#messages") || document.body;
    container.appendChild(wrap);
    return canvas.getContext("2d");
  }

  // opciones comunes
  function baseOptions({showPct=false, isScatter=false}={}){
    const opt = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { usePointStyle:true } },
        tooltip: {
          callbacks: showPct ? {
            label: (ctx)=>{
              const total = ctx.dataset.data.reduce((a,b)=>a+ (b||0),0);
              const val = ctx.parsed || 0;
              const pct = total? (100*val/total) : 0;
              return `${ctx.label}: ${fmt(val)} (${fmt(pct)}%)`;
            }
          } : {}
        },
        datalabels: {
          anchor: "end", align: "top",
          formatter: (v,ctx)=>{
            if (showPct) {
              const total = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
              return total? `${fmt(100*v/total)}%` : "";
            }
            if (isScatter) return "";
            return fmt(v);
          }
        }
      },
      scales: isScatter ? {
        x: { grid:{ color:"rgba(255,255,255,.08)" } },
        y: { grid:{ color:"rgba(255,255,255,.08)" } }
      } : {
        x: { grid:{ display:false } },
        y: { grid:{ color:"rgba(255,255,255,.08)" }, beginAtZero:true }
      }
    };
    return opt;
  }

  // renderizadores
  function barChart({labels, values}, title="Gráfico de barras"){
    const ctx = createCanvasBubble();
    const chart = new Chart(ctx, {
      type:"bar",
      data:{
        labels,
        datasets:[{
          label:title,
          data: values,
          backgroundColor: labels.map((_,i)=> PALETTE[i%PALETTE.length]),
          borderRadius: 10
        }]
      },
      options: baseOptions()
    });
    const total = values.reduce((a,b)=>a+b,0);
    const maxI = values.indexOf(Math.max(...values));
    const minI = values.indexOf(Math.min(...values));
    const expl = [
      `Total: **${fmt(total)}**.`,
      `Máximo en **${labels[maxI]}** con **${fmt(values[maxI])}**.`,
      `Mínimo en **${labels[minI]}** con **${fmt(values[minI])}**.`,
      `Rango: **${fmt(Math.max(...values)-Math.min(...values))}**.`
    ].join("\n");
    return {chart, explanation: expl};
  }

  function pieChart({labels, values}, title="Gráfico circular"){
    const ctx = createCanvasBubble();
    const chart = new Chart(ctx, {
      type:"pie",
      data:{
        labels,
        datasets:[{
          label:title,
          data: values,
          backgroundColor: labels.map((_,i)=> PALETTE[i%PALETTE.length])
        }]
      },
      options: baseOptions({showPct:true})
    });
    const total = values.reduce((a,b)=>a+b,0);
    const expl = [
      `Suma total: **${fmt(total)}**.`,
      `El tamaño de cada porción indica su **porcentaje** sobre el total.`,
      `Las porciones mayores representan **mayor contribución relativa**.`
    ].join("\n");
    return {chart, explanation: expl};
  }

  function lineChart({labels, values}, title="Gráfico de líneas"){
    const ctx = createCanvasBubble();
    const chart = new Chart(ctx, {
      type:"line",
      data:{
        labels,
        datasets:[{
          label:title,
          data: values,
          pointRadius: 4,
          fill:false,
          tension: .25,
          borderColor: "#60a5fa",
          backgroundColor: "#60a5fa"
        }]
      },
      options: baseOptions()
    });
    const trend = values.length>1 ? fmt(values[values.length-1]-values[0]) : "—";
    const expl = [
      `Se observa la **tendencia** a lo largo del eje x.`,
      `Variación neta entre primer y último punto: **${trend}**.`
    ].join("\n");
    return {chart, explanation: expl};
  }

  function scatterChart(points, title="Diagrama de dispersión", withRegression=false){
    const ctx = createCanvasBubble();
    const datasets=[{
      type:"scatter",
      label:"Datos",
      data: points,
      backgroundColor: "#a78bfa"
    }];
    let expl = [`Cada punto representa un par \\((x,y)\\).`];

    if (withRegression && points.length>=2){
      const {b0,b1,r2} = linearRegression(points);
      const xs = points.map(p=>p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const linePts = [
        {x:xMin, y:b0+b1*xMin},
        {x:xMax, y:b0+b1*xMax}
      ];
      datasets.push({
        type:"line",
        label:`Regresión: y = ${fmt(b0)} + ${fmt(b1)}x`,
        data: linePts,
        borderColor: "#34d399",
        borderDash: [6,3],
        fill:false,
        pointRadius: 0
      });
      expl.push(`Recta estimada: \\(\\hat{y}=${fmt(b0)}+${fmt(b1)}x\\).`);
      expl.push(`Coeficiente de determinación: **R²=${fmt(r2)}**.`);
    }

    const chart = new Chart(ctx, {
      data: { datasets },
      options: baseOptions({isScatter:true})
    });

    return {chart, explanation: expl.join("\n")};
  }

  // API pública
  window.ChartHelper = {
    parse1D, parsePairs,
    barChart, pieChart, lineChart, scatterChart
  };
})();
