import{a as h,b as n}from"./chunk-FO7DU3ZN.js";import{a as u,b}from"./chunk-34CTSXCL.js";import"./chunk-JVHWUGXG.js";u.workerSrc=new URL("./pdf.worker.min.mjs",import.meta.url).href;var c={blob:null,pdf:null,task:null},l=1;async function $(p,m,d,f){let e=document.getElementById("pageview");if(e.innerHTML=`
    <header class="bar">
      <button class="icon-btn" data-pv="close" aria-label="Close">${n("close")}</button>
      <h1>${h(f)}</h1>
      <button class="icon-btn" data-pv="zoom" aria-label="Zoom">${n("zoom")}</button>
    </header>
    <div class="canvas-wrap"><canvas></canvas></div>
    <footer class="player"><div class="row">
      <button class="icon-btn" data-pv="prev" aria-label="Previous page">${n("back")}</button>
      <span class="where" style="margin:0 12px" id="pvWhere"></span>
      <button class="icon-btn" data-pv="next" aria-label="Next page" style="transform:scaleX(-1)">${n("back")}</button>
    </div></footer>`,e.hidden=!1,c.blob!==p){c.task?.destroy();let t=b({data:new Uint8Array(await p.arrayBuffer()),isEvalSupported:!1});c={blob:p,task:t,pdf:await t.promise}}let o=m,r=async()=>{e.querySelector("#pvWhere").textContent=`Page ${o} of ${d}`;let t=await c.pdf.getPage(o),s=e.querySelector(".canvas-wrap"),g=t.getViewport({scale:1}),w=(s.clientWidth-16)*l,y=w/g.width,v=Math.min(3,window.devicePixelRatio||1),i=t.getViewport({scale:y*v}),a=e.querySelector("canvas");a.width=i.width,a.height=i.height,a.style.width=w+"px",a.style.height=i.height/v+"px",a.style.margin="8px auto",await t.render({canvas:a,canvasContext:a.getContext("2d"),viewport:i}).promise};e.onclick=async t=>{let s=t.target.closest("[data-pv]")?.dataset.pv;s==="close"?(e.hidden=!0,e.innerHTML=""):s==="prev"&&o>1?(o--,await r()):s==="next"&&o<d?(o++,await r()):s==="zoom"&&(l=l===1?2:l===2?3:1,await r())},await r()}export{$ as showPage};
