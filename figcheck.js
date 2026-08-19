#!/usr/bin/env node
/*
  figcheck.js — 翊の生物 插圖幾何檢查（規則 F 等）
  用法：node tools/figcheck.js [figures.json] [index.html]
  預設讀同目錄的 figures.json 與 index.html。

  它檢查三件 check.py 不管的事：
    OVERFLOW   文字超出 viewBox
    TEXT-TEXT  兩段文字互相重疊
    RULE-F     文字被線條／輪廓穿過（排除「底下有底色」與「引線接自己標籤」）

  同一個要點的圖會放在同一頁渲染，和線上一致。
*/
const fs=require('fs'), path=require('path'), os=require('os');
const PW='/home/claude/.npm-global/lib/node_modules/playwright';
const CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require(PW);

const figFile=process.argv[2]||'figures.json';
const htmlFile=process.argv[3]||'index.html';
const figs=JSON.parse(fs.readFileSync(figFile,'utf8'));
const html=fs.readFileSync(htmlFile,'utf8');
const a=html.indexOf('<style'), b=html.indexOf('</style>',a);
const css=html.slice(html.indexOf('>',a)+1,b);

const byPoint={};
figs.forEach((f,i)=>{ (byPoint[f.point]=byPoint[f.point]||[]).push(i); });

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'figcheck-'));
const pages=[];
for(const pt of Object.keys(byPoint)){
  for(const dark of [false,true]){
    let h='<!doctype html><html lang="zh-Hant"'+(dark?' data-theme="dark"':'')+'><meta charset="utf-8"><style>'+css+'</style>'+
      '<style>.wrap{max-width:920px;margin:0 auto;padding:22px 18px 72px}#lessonBody{padding-left:32px}body{background:var(--page)}</style>'+
      '<body><div class="wrap"><article id="lessonBody">';
    for(const i of byPoint[pt]) h+=`<figure class="lfig" data-i="${i}"><div class="svgwrap">${figs[i].svg}</div></figure>`;
    h+='</article></div></body></html>';
    const fn=path.join(tmp,`${pt}-${dark?'dark':'light'}.html`);
    fs.writeFileSync(fn,h); pages.push([pt,dark?'暗':'亮',fn]);
  }
}

(async()=>{
  const br=await chromium.launch({executablePath:CHROME});
  const p=await br.newPage({viewport:{width:1000,height:1400},deviceScaleFactor:1});
  let total=0;
  for(const [pt,theme,fn] of pages){
    await p.goto('file://'+fn); await p.waitForTimeout(300);
    const out=await p.evaluate(()=>{
      const res=[];
      document.querySelectorAll('figure.lfig').forEach(fig=>{
        const svg=fig.querySelector('svg'); const vb=svg.viewBox.baseVal;
        const fr=svg.getBoundingClientRect(); const k=fr.width/vb.width;
        const U=r=>({x:(r.left-fr.left)/k,y:(r.top-fr.top)/k,w:r.width/k,h:r.height/k});
        const all=[...svg.querySelectorAll('*')]; const ord=new Map(all.map((e,i)=>[e,i]));
        const shapes=all.filter(e=>/^(path|rect|circle|ellipse|polygon|polyline|line)$/.test(e.tagName))
          .filter(e=>{const cs=getComputedStyle(e);return cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity||1)>0.05;});
        const texts=[...svg.querySelectorAll('text')].filter(t=>t.getBoundingClientRect().width>0.5);
        const probs=[];
        texts.forEach(t=>{const r=U(t.getBoundingClientRect());
          if(r.x<-1||r.y<-1||r.x+r.w>vb.width+1||r.y+r.h>vb.height+1)
            probs.push(`OVERFLOW  "${t.textContent.trim().slice(0,22)}" x${r.x.toFixed(0)}..${(r.x+r.w).toFixed(0)} y${r.y.toFixed(0)}..${(r.y+r.h).toFixed(0)}  viewBox ${vb.width}x${vb.height}`);});
        for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
          const A=U(texts[i].getBoundingClientRect()),B=U(texts[j].getBoundingClientRect());
          const ix=Math.max(0,Math.min(A.x+A.w,B.x+B.w)-Math.max(A.x,B.x)), iy=Math.max(0,Math.min(A.y+A.h,B.y+B.h)-Math.max(A.y,B.y));
          const ar=ix*iy;
          if(ar>Math.min(A.w*A.h,B.w*B.h)*0.12&&ar>6)
            probs.push(`TEXT-TEXT "${texts[i].textContent.trim().slice(0,18)}" ✕ "${texts[j].textContent.trim().slice(0,18)}"  面積 ${ar.toFixed(0)}`);
        }
        texts.forEach(t=>{
          const rr=t.getBoundingClientRect(); const to=ord.get(t);
          const x0=rr.left+1.5,x1=rr.right-1.5,y0=rr.top+rr.height*0.16,y1=rr.bottom-rr.height*0.16;
          if(x1<=x0) return;
          const NX=Math.max(6,Math.round((x1-x0)/3)),NY=4,pts=[];
          for(let i=0;i<=NX;i++)for(let j=0;j<=NY;j++)pts.push([x0+(x1-x0)*i/NX,y0+(y1-y0)*j/NY]);
          const n=pts.length; const hits=[]; let badge=-1;
          shapes.forEach(s=>{let m;try{m=s.getScreenCTM().inverse();}catch(e){return;}
            const cs=getComputedStyle(s);
            const hf=cs.fill&&cs.fill!=='none', hs=cs.stroke&&cs.stroke!=='none'&&parseFloat(cs.strokeWidth)>0;
            let f=0,st=0;
            for(const [px,py] of pts){const q=new DOMPoint(px,py).matrixTransform(m);
              if(hf&&s.isPointInFill(q))f++; if(hs&&s.isPointInStroke(q))st++;}
            const so=ord.get(s);
            if(hf&&f>=n*0.98&&so<to) badge=Math.max(badge,so);
            if(st>0) hits.push({k:'STROKE',c:s.getAttribute('class')||s.tagName,f:st/n,so});
            else if(hf&&f>0&&f<n*0.98) hits.push({k:'FILL-EDGE',c:s.getAttribute('class')||s.tagName,f:f/n,so});
          });
          const seen={};
          hits.filter(h=>h.so>badge).forEach(h=>{const key=h.k+h.c; if(!seen[key]||seen[key].f<h.f)seen[key]=h;});
          Object.values(seen).forEach(h=>probs.push(`RULE-F ${h.k.padEnd(9)} "${t.textContent.trim().slice(0,22)}" 壓到 .${h.c}  ${(h.f*100).toFixed(0)}%`));
        });
        if(probs.length) res.push({i:fig.dataset.i,probs});
      });
      return res;
    });
    if(out.length){
      console.log(`\n### ${pt}（${theme}）`);
      out.forEach(f=>{ console.log(`  第 ${f.i} 張`); f.probs.forEach(x=>{console.log('     '+x); total++;}); });
    }
  }
  await br.close();
  console.log(`\n合計 ${total} 項。（1–2% 的擦邊多半是引線接到自己的標籤，可略；6% 以上通常看得出來。）`);
  process.exit(total?1:0);
})();
