// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Clint Beharry
/* ---------------------------------------------------------------------------
   The five-step sequence, as a function of one question.

   It used to read a `G` baked into the page, which is why it only ever ran
   for one question. G is now whatever `play()` is handed: a recorded capture
   for the suggested questions, or something derived from the model in this
   tab for anything typed. The two are the same shape, so nothing below can
   tell them apart.
--------------------------------------------------------------------------- */
let G=null, NQ=0;
const $=id=>document.getElementById(id);
const FONT='ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
const MONO='ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const CLAY=0xd97757, GREY=0x6e6e6e, WIRE=0xa96c55;
const CLAYC="#d97757", INKC="#d4d4d4";

/* ------------------------------------------------------------------ stage */
const gl=$("gl"), ov=$("ov"), stageEl=$("stage"), ctx=ov.getContext("2d");
const renderer=new THREE.WebGLRenderer({canvas:gl,antialias:true,alpha:false});
renderer.setClearColor(0x191919,1);   /* the thread background, not a frame */
const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(38,16/9,1,6000);
let DPR=Math.min(2,window.devicePixelRatio||1), VW=1000, VH=540;
/* The sequence is laid out in world units that come out about one-to-one with
   pixels on a 1000px stage, which is what it was built against. Positions
   scale with the stage automatically, because they project to normalised
   coordinates and get multiplied by the width. Anything measured in pixels
   does not, so on a narrower stage the type stayed put while the layout
   closed up around it and the words collided. PXS carries that scale to
   everything drawn in pixel space. */
let PXS=1;
function resize(){
  VW=stageEl.clientWidth||1000; VH=stageEl.clientHeight||Math.round(VW*.54);
  /* Type cannot scale all the way down with the stage or a phone gets four
     pixel words. Below about 600px it holds a floor and the layout, which
     does scale, simply carries fewer things per inch. */
  PXS=cl(VW/1000,.95,1.25);
  renderer.setPixelRatio(DPR); renderer.setSize(VW,VH,false);
  ov.width=Math.round(VW*DPR); ov.height=Math.round(VH*DPR);
  ov.style.width=VW+"px"; ov.style.height=VH+"px";
  cam.aspect=VW/VH; cam.updateProjectionMatrix();
}
addEventListener("resize",resize);

const MAXE=3600;
const egeo=new THREE.BufferGeometry();
egeo.setAttribute("position",new THREE.BufferAttribute(new Float32Array(MAXE*6),3));
egeo.setAttribute("color",new THREE.BufferAttribute(new Float32Array(MAXE*8),4));
const lineMat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,
  blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false});
const lines=new THREE.LineSegments(egeo,lineMat);
lines.frustumCulled=false; scene.add(lines);

/* ------------------------------------------------------------------ model */
let NODES=[], EDGES=[], HITS=[], LATE=null;
let CAMR=565, CAMY=0, CAMA=0, CAMB=0, LOOK=new THREE.Vector3(0,0,0);
let BOXR=[400,150,190];
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
const cl=(v,a,b)=>Math.max(a===undefined?0:a,Math.min(b===undefined?1:b,v));
const io=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
const out=k=>1-Math.pow(1-k,3);
const seg=(t,a,b)=>cl((t-a)/(b-a));
const lerp=(a,b,k)=>a+(b-a)*k;
const rotY=(v,a)=>V3(v.x*Math.cos(a)-v.z*Math.sin(a),v.y,v.x*Math.sin(a)+v.z*Math.cos(a));

function mkNode(w,x,y,z,o){
  const n={w,p:V3(x,y,z),h:V3(x,y,z),op:(o===undefined?1:o),clay:false,size:1,dr:0,
    am:7+Math.random()*9,sp:.00030+Math.random()*.00045,
    ph:[Math.random()*6.283,Math.random()*6.283,Math.random()*6.283]};
  NODES.push(n); return n;
}
function mkEdge(a,b,col,o,w){
  const e={a,b,col:new THREE.Color(col===undefined?GREY:col),
           op:(o===undefined?1:o),w:(w===undefined?.5:w)};
  EDGES.push(e); return e;
}
function hash3(w){
  let h=2166136261>>>0;
  for(let i=0;i<w.length;i++){h^=w.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return [((h)&1023)/1023-.5,((h>>>10)&1023)/1023-.5,((h>>>20)&1023)/1023-.5];
}
const rel1=xy=>Math.max(.1,1-Math.hypot(xy[0],xy[1]));
function faceHit(p,R){
  const d=p.clone();
  if(d.length()<1e-3) d.set(1,0,0);
  d.normalize();
  let t=1e9;
  for(let i=0;i<3;i++){ const v=[d.x,d.y,d.z][i];
    if(Math.abs(v)>1e-6) t=Math.min(t,R[i]/Math.abs(v)); }
  return d.multiplyScalar(t);
}

function sync(){
  const P=egeo.attributes.position.array, C=egeo.attributes.color.array;
  const n=Math.min(EDGES.length,MAXE);
  for(let i=0;i<n;i++){
    /* GL lines are one pixel wide whatever you ask for, so an edge's weight
       has to arrive as brightness. The range was narrow enough that a strong
       link and a weak one looked alike; it is wide now, and starts higher, so
       the mesh holds up on a small screen. */
    const e=EDGES[i], A=e.a.p, B=e.b.p, k=i*6, c=i*8, g=e.op*(.15+e.w*.44);
    P[k]=A.x;P[k+1]=A.y;P[k+2]=A.z;P[k+3]=B.x;P[k+4]=B.y;P[k+5]=B.z;
    /* strength in the alpha channel, colour left at full value: folding it
       into rgb draws an opaque dark line the moment blending is not additive */
    C[c]=C[c+4]=e.col.r; C[c+1]=C[c+5]=e.col.g; C[c+2]=C[c+6]=e.col.b;
    C[c+3]=C[c+7]=g;
  }
  egeo.setDrawRange(0,n*2);
  egeo.attributes.position.needsUpdate=true;
  egeo.attributes.color.needsUpdate=true;
}

const HX=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
const CLAYV=HX(CLAYC), INKV=HX(INKC), MONOV=HX("#9b9b9b");
/* Each set of axes gets its own accent, so a change of colour says the words
   are being associated a different way. Picked at a similar lightness to the
   clay so nothing jumps in weight when the hue turns, and the last set comes
   home to clay so the fold into the cursor opens in the house colour. */
const VIEWC=[[CLAY,CLAYC],[0x5f9fd9,"#5f9fd9"],
             [0x6cbf8f,"#6cbf8f"],[CLAY,CLAYC]];
let ACC=CLAY, ACCV=CLAYV.slice(), ACCC=CLAYC;
const mixv=(a,b,k)=>a.map((v,i)=>Math.round(v+(b[i]-v)*k));
function setAcc(hex,css){ ACC=hex; ACCC=css; ACCV=HX(css); }
function blendAcc(c1,c2,k){
  ACCV=mixv(HX(c1[1]),HX(c2[1]),k);
  ACCC="rgb("+ACCV.join(",")+")";
  ACC=(ACCV[0]<<16)|(ACCV[1]<<8)|ACCV[2];
}
const mixc=(a,b,k)=>"rgb("+a.map((v,i)=>Math.round(v+(b[i]-v)*k)).join(",")+")";
const REF=760;
function labels(){
  ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0,0,VW,VH);
  const list=[];
  for(const n of NODES){
    if(n.op<=.02||!n.w) continue;
    const v=n.p.clone().project(cam);
    if(v.z<-1||v.z>1) continue;
    const d=cam.position.distanceTo(n.p);
    /* the far end of the range bottomed out at .3, which on a phone stage is
       four pixels of type. Depth still reads, it just reads over a narrower
       range than it used to. */
    list.push({n,x:(v.x*.5+.5)*VW,y:(-v.y*.5+.5)*VH,s:cl(REF/d,.60,2.1),z:v.z});
  }
  list.sort((a,b)=>b.z-a.z);
  ctx.textAlign="center";
  for(const it of list){
    const fs=it.n.size*12.5*it.s*PXS;
    if(fs<4.2*PXS) continue;
    /* words on the reply line share a baseline, the way type in a chat thread
       does, so a size still easing cannot ride them up or down */
    ctx.textBaseline=it.n.baseline?"alphabetic":"middle";
    /* Weight belongs to what a word IS, not to whether it happens to be lit.
       Tying bold to the clay flag meant words changed weight the moment the
       wiring front touched them, and left the cloud in mixed weights at every
       hand-off. The question's own words are bold throughout and nothing else
       ever changes weight. */
    ctx.font=(it.n.bold?"600 ":"")+fs.toFixed(1)+"px "+(it.n.mono?MONO:FONT);
    ctx.globalAlpha=cl(it.n.op*cl((it.s-.34)/.34,.14,1));
    ctx.fillStyle = it.n.warm!==undefined
      ? mixc(it.n.mono?MONOV:INKV,it.n.fixed?CLAYV:ACCV,cl(it.n.warm))
      : (it.n.clay?ACCC:(it.n.mono?"#9b9b9b":INKC));
    ctx.fillText(it.n.w,it.x,it.y);
  }
  ctx.globalAlpha=1;
  drawHits();
  if(LATE) LATE();
}
function drawHits(){
  for(const h of HITS){
    const e=h.e, o=e?e.op:1;
    if(o<=.04) continue;
    const p=h.n.p;
    let best=0;
    for(let i=0;i<3;i++) best=Math.max(best,Math.abs([p.x,p.y,p.z][i])/(BOXR[i]||1));
    if(best<.62) continue;
    const v=p.clone().project(cam);
    if(v.z<-1||v.z>1) continue;
    ctx.globalAlpha=cl(o*.8*cl((best-.62)/.3));
    ctx.fillStyle=(e?e.col:new THREE.Color(CLAY)).getStyle();
    ctx.beginPath();
    ctx.arc((v.x*.5+.5)*VW,(-v.y*.5+.5)*VH,.7*PXS,0,6.2832);
    ctx.fill();
  }
  ctx.globalAlpha=1;
}
/* The caret is a 21-unit bar standing in the world, so the collapsing stack
   can land on exactly its size and place rather than near them. */
const CH=21;
function caret(world,alpha,T){
  const v=world.clone().project(cam);
  const a=world.clone().add(V3(0,CH/2,0)).project(cam);
  const b=world.clone().add(V3(0,-CH/2,0)).project(cam);
  const y1=(-a.y*.5+.5)*VH, y2=(-b.y*.5+.5)*VH;
  ctx.globalAlpha=alpha*((Math.floor(T/330)%2)?.12:1);
  ctx.fillStyle=CLAYC;
  ctx.fillRect((v.x*.5+.5)*VW-1.5*PXS,y1,3*PXS,y2-y1);
  ctx.globalAlpha=1;
}
/* a point on the z=0 plane that projects to these screen pixels */
function s2w(px,py){
  const v=V3((px/VW)*2-1,-(py/VH)*2+1,.5).unproject(cam);
  const d=v.sub(cam.position).normalize();
  return cam.position.clone().add(d.multiplyScalar(-cam.position.z/d.z));
}

/* ------------------------------------------------------------------ clock */
let run=0, paused=false, drifting=true, GT=0;
function clock(ms,onTick){
  const me=run;
  return new Promise(res=>{
    let el=0,last=performance.now();
    (function step(t){
      if(me!==run) return res();
      const dt=t-last; last=t; if(!paused) el+=dt;
      onTick(Math.min(1,el/ms),el);
      el>=ms?res():requestAnimationFrame(step);
    })(last);
  });
}
const sleep=ms=>clock(ms,()=>{});
function frame(now){
  requestAnimationFrame(frame);
  if(!paused) GT=now;
  for(const n of NODES){
    n.p.set(n.h.x,n.h.y,n.h.z);
    if(drifting&&n.dr){
      n.p.x+=Math.sin(now*n.sp+n.ph[0])*n.am*n.dr;
      n.p.y+=Math.sin(now*n.sp*1.17+n.ph[1])*n.am*.7*n.dr;
      n.p.z+=Math.sin(now*n.sp*0.83+n.ph[2])*n.am*1.4*n.dr;
    }
  }
  const a=Math.sin(now*.00017)*CAMA;
  cam.position.set(Math.sin(a)*CAMR,CAMY+Math.sin(now*.00011)*CAMB,Math.cos(a)*CAMR);
  cam.lookAt(LOOK);
  sync(); renderer.render(scene,cam); labels();
}

/* ------------------------------------------------------------ the pieces */
/* The question's words sit on a line, GAP apart. Fixed at 100 that line runs
   off the stage the moment a question has more than about seven words, so it
   closes up for longer ones instead. */
let GAP=118;
/* The box used to be a fixed wide slab, which is right on a desktop stage and
   wrong on a phone, where the space available is tall and narrow. Its shape
   and the camera distances now come from the stage's own proportions, so the
   same sequence fills whichever it is given. */
let RX=400, RY=150, RZ=190;
let CAM2=620, CAM3=900, ENDR=640;
const ORBIT=.16;            /* how far the box turns while it is read */
let COLS=1;                 /* question words per row in steps one and two */
let ROWG=168;               /* and how far apart those rows sit */
/* How far a neighbourhood reaches from its word. A tall stage has room above
   and below that it does not have beside, but only a little of it: stretched
   to fill the height, the top row's neighbours climbed out of the frame and a
   word's network read as a column rather than a neighbourhood. */
const KID_R=66, KID_DEPTH=110;
const kidUp=()=>lerp(1.3,1.5,cl((1.5-VW/VH)/.9));
const kidReach=()=>KID_R*kidUp()+26;
/* where the i-th question word sits while its neighbourhood is around it */
function seat(i){
  const r=Math.floor(i/COLS), c=i%COLS, rows=Math.ceil(NQ/COLS);
  const wide=Math.min(COLS, NQ-r*COLS);        /* a short last row centres */
  return { x:(c-(wide-1)/2)*GAP, y:-(r-(rows-1)/2)*ROWG };
}
const TANH=()=>Math.tan(cam.fov*Math.PI/360);
/* The distance at which something of these half-extents fits the frame.
   mz is its half-depth, and leaving it out is what cropped the box: the near
   face sits mz CLOSER than the centre, so its corners project as though the
   thing were d/(d-mz) times wider. Standing the camera off by the depth as
   well as the width is the whole correction. */
function fitCam(mx,my,pad,mz){
  const t=TANH(), A=VW/VH;
  return (mz||0) + Math.max(my*pad/t, mx*pad/(t*A));
}
/* and for the box, which also turns while it is being looked at: at orbit
   angle a it presents a wider face and a deeper one than its own half-extents */
function fitBox(rx,ry,rz,orbit,bob,pad){
  const c=Math.abs(Math.cos(orbit)), si=Math.abs(Math.sin(orbit));
  return fitCam(rx*c+rz*si, ry+bob, pad, rx*si+rz*c);
}
function fitStage(){
  const A=VW/VH;
  const wide=cl((A-.70)/(1.85-.70));      /* 0 on a tall phone, 1 on a desktop */
  RX=lerp(205,400,wide); RY=lerp(315,180,wide); RZ=lerp(128,146,wide);
  /* shallower than it was, because depth costs camera distance twice over:
     once to clear the near face and again to hold the turn */
  /* a little more air than the box strictly needs: the labels are drawn
     centred on their nodes, so the outermost ones reach past the faces */
  CAM3=fitBox(RX,RY,RZ,ORBIT,32,1.12);
  ENDR=fitCam(RX*.58,RY*.58,1.12,RZ*.58);
}
const LINE_Y=104, SCALE=1.05, PER=1600;
const pct=p=> p>=.995 ? (Math.floor(p*1000)/10).toFixed(1)+"%"
            : p>=.1    ? (p*100).toFixed(0)+"%"
            : p>=.001  ? (p*100).toFixed(1)+"%"
            : p>=.00005? (p*100).toFixed(2)+"%" : "<0.01%";
/* Where the network folds down to. This used to be derived from the reply's
   first word, back when the reply was drawn here as a line of 3D words: the
   caret sat just left of it. The reply is written in the thread now, and the
   line it was measured from grew from six words to the whole answer, which
   pushed that measurement clean off the side of the stage. Nothing in the
   canvas depends on the reply any more, so the fold lands in the middle. */
let CARET=V3(0,LINE_Y,0);

/* One line, outside the stage, next to the thinking mark. It used to be two
   lines inside the frame narrating the animation; what belongs beside a
   loading indicator is what the machine is doing, not what the picture is
   doing. */
function hud(main){
  const h=$("hud"); if(!h) return;
  h.textContent=main||"";
}

/* =================================================================== build */
let recs, nodes, lay, cube, cubeHome, pins, stubs, words, kids, concepts, vis;
function buildCloud(){
  /* A hundred and thirty words at a legible size do not fit a phone. Type
     that shrinks to fit is not a fix, it is the same problem written smaller,
     so the cloud thins out instead and what is left can be read. */
  const DENSE=cl((VW-330)/(880-330));
  /* Every neighbour that was recorded, at every size. Thinning them on a
     narrow screen was meant to keep the labels apart and instead made the
     step look like the model had found a handful of associations rather than
     a neighbourhood. They are drawn with transparency and they read through
     each other, so a crowd is the better failure. */
  const POOL=Math.round(lerp(22,48,DENSE)), KIDS=99;
  recs=[];
  G.q.forEach((d,i)=>recs.push({w:d.w,role:0,parent:i,xy:null,rel:1,h3:hash3(d.w)}));
  /* A recorded neighbourhood is one word per direction, listed in order
     around the circle, so taking the first few takes an ARC rather than a
     sample. On a narrow screen, where fewer of them fit, every neighbour was
     coming out of the same lower quadrant: the word had a tail hanging off it
     instead of a neighbourhood around it. Taken evenly instead, so whatever
     number fits still arrives from all the way round. */
  const around=(a,n)=>a.length<=n?a
    :Array.from({length:n},(_,i)=>a[Math.round(i*a.length/n)%a.length]);
  G.q.forEach((d,i)=>around(d.assoc,KIDS).forEach((a,k)=>
    recs.push({w:a.w,role:1,parent:i,k,xy:a.xy,rel:rel1(a.xy),h3:hash3(a.w)})));
  const best=new Map();
  G.reply.forEach(r=>r.cands.forEach(cd=>{const k=(cd.w||"").trim();
    if(k) best.set(k,Math.max(best.get(k)||0,cd.p));}));
  const seen=new Set(recs.map(r=>r.w.toLowerCase())), pool=[];
  const take=w=>{const k=(w||"").toLowerCase();
    if(/^[A-Za-z][A-Za-z'-]{1,}$/.test(w)&&!seen.has(k)){seen.add(k);pool.push(w);}};
  G.emerge.forEach(take); G.reply.forEach(r=>r.cands.forEach(cd=>take((cd.w||"").trim())));
  pool.slice(0,POOL).forEach(w=>recs.push({w,role:2,parent:-1,h3:hash3(w),
    rel:cl(Math.pow(best.get(w)||.003,.18))}));
  const cnt=[0,0,0];
  recs.forEach(r=>r.ord=cnt[r.role]++);
  recs.forEach(r=>r.ordN=cnt[r.role]);
  /* a word belongs to a view only where that view can say something true
     about it: the reply's own concepts have no source word and no measured
     direction, so they sit out those two */
  recs.forEach(r=>r.vis=[r.role!==2,true,r.role!==2,true]);

  const ang=r=>r.xy?Math.atan2(r.xy[1],r.xy[0]):r.h3[0]*6.283;
  const fib=(i,n,rad)=>{const u=(i+.5)/n,ph=Math.acos(1-2*u),th=i*2.39996;
    return V3(Math.sin(ph)*Math.cos(th)*rad*RX,Math.cos(ph)*rad*RY,
              Math.sin(ph)*Math.sin(th)*rad*RZ);};
  /* Four readings, not one reading drawn four ways.
     The recording used to carry a single two-dimensional projection, and
     these four functions rearranged it under four different rules while the
     captions called them dimensions 1-3, 4-6, 7-9 and 10-12. The views
     differed; the numbers behind them did not, which made the caption the one
     thing on the page that was not true.
     capture-axes.py now decomposes the whole cloud once and writes each
     word's position on principal components 1 through 12, so each view reads
     three components nobody has read yet. Where a word sits, and what it sits
     near, changes with the slice, because that is what a slice is.
     The fallbacks below are for a question typed in the browser, where the
     embedding matrix is out of reach and there is nothing to project. */
  const AX=G.axes||null;
  const onAxes=t=>r=>{ const a=AX&&AX[r.w]; return a
    ? V3(a[t*3]*RX, a[t*3+1]*RY, a[t*3+2]*RZ) : null; };
  const GUESS=[
    r=>{ if(r.role===2) return fib(r.ord,r.ordN,.99);
      const c=fib(r.parent,NQ,.52);
      if(r.role===0) return c;
      const R=22+(1-r.rel)*38, th=ang(r);
      return V3(c.x+Math.cos(th)*R*.75,c.y+Math.sin(th)*R*.95,c.z+r.h3[2]*2.6*R); },
    r=>{ const rad=(r.role===0?.34:(1-r.rel))*.97, th=ang(r);
      const ph=Math.acos(cl(r.h3[2]*2,-1,1));
      return V3(Math.sin(ph)*Math.cos(th)*rad*RX,Math.cos(ph)*rad*RY,
                Math.sin(ph)*Math.sin(th)*rad*RZ); },
    r=>{ const th=ang(r), rad=r.role===0?.36:.93;
      return V3(Math.cos(th)*rad*RX,
                (r.role===0?(r.parent-(NQ-1)/2)*.5:r.h3[1]*2.1)*RY*.42,
                Math.sin(th)*rad*RZ); },
    r=>fib(r.ord,r.ordN,[.24,.64,.98][r.role])
  ];
  const LAYOUTS=GUESS.map((g,t)=>{ const real=onAxes(t);
    return r=>real(r)||g(r); });
  const K=LAYOUTS.length;
  lay=recs.map(r=>LAYOUTS.map(f=>f(r)));
  const pc=(a,q)=>{const b=a.slice().sort((x,y)=>x-y);
    return b[Math.min(b.length-1,Math.floor(b.length*q))]||1;};
  for(let k=0;k<K;k++){
    const live=lay.filter((L,j)=>recs[j].vis[k]).map(L=>L[k]);
    /* Inside the faces, not on them. A word's label is drawn centred on its
       node, so a node sitting exactly on the bottom face has half its label
       hanging below the box and off the frame. Real projections have longer
       tails than the old hand-made arrangements did, which is what made this
       show up. */
    const f=[RX*.90/pc(live.map(v=>Math.abs(v.x)),.88),
             RY*.86/pc(live.map(v=>Math.abs(v.y)),.88),
             RZ*.90/pc(live.map(v=>Math.abs(v.z)),.88)];
    lay.forEach(L=>L[k].set(cl(L[k].x*f[0],-RX*.97,RX*.97),
                            cl(L[k].y*f[1],-RY*.93,RY*.93),
                            cl(L[k].z*f[2],-RZ*.97,RZ*.97)));
  }
  /* step-2 home: each word in its seat, its neighbourhood around it in depth */
  recs.forEach(r=>{
    if(r.role===0){ const t=seat(r.parent); r.p2=V3(t.x,t.y,0); return; }
    if(r.role===2){ r.p2=null; return; }
    const a=seat(r.parent);
    const up=kidUp();
    const R=36+(1-r.rel)*30, th=ang(r);
    r.p2=V3(a.x+Math.cos(th)*R, a.y+Math.sin(th)*R*up, (r.rel-.45)*200);
  });
  nodes=recs.map((r,j)=>{
    const st=r.p2||lay[j][0];
    const n=mkNode(r.w,st.x,st.y,st.z,0);
    n.size=r.role===0?1.46:(r.role===1?1.0:.96);
    n.bold=r.role===0;
    n.base3=[1,.68,.60][r.role];
    n.rec=r; r.n=n; return n;
  });
  words=recs.filter(r=>r.role===0).map(r=>r.n);
  kids=recs.filter(r=>r.role===1);
  concepts=recs.filter(r=>r.role===2);
  return K;
}

/* =================================================================== play */
async function play(data){
  if(data) G=data;
  if(!G) return;
  NQ=G.q.length;
  note();
  const me=++run;
  paused=false; $("pause").textContent="Pause";
  NODES.length=0; EDGES.length=0; HITS.length=0; LATE=null;
  lineMat.blending=THREE.AdditiveBlending; lineMat.needsUpdate=true;
  fitStage();
  /* Steps one and two seat the question's words with room around each for
     its neighbourhood. Six of those will not fit across a phone at a size
     anyone can read, so the line wraps, the way the question itself wraps in
     the bubble above. The camera is then backed off to hold whatever shape
     that came out as, which is what makes it fill the stage rather than
     float small in the middle of it. */
  COLS = (VW/VH) >= 1.45 ? NQ
       : Math.max(2, Math.min(NQ, Math.round(Math.sqrt(NQ*(VW/VH)*1.6))));
  const rows = Math.ceil(NQ/COLS);
  /* the width decides how far back the camera stands, and the rows then open
     out to use whatever height that leaves, rather than huddling in a band
     across the middle of a tall stage */
  /* the neighbourhoods carry ±110 of depth, which counts the same way */
  CAM2 = fitCam((COLS-1)/2*GAP + 95, 0, 1.08, KID_DEPTH);
  /* What is left for the rows is the half-height at the NEAR face, not at the
     centre: a neighbour sitting KID_DEPTH closer projects as if the frame were
     that much smaller, and the ones that cropped were the near ones. */
  const room = TANH()*(CAM2 - KID_DEPTH) - kidReach();
  ROWG = rows > 1 ? cl(room*2/(rows-1), 130, 300) : 168;
  CAMR=CAM2; CAMA=0; CAMB=0; CAMY=0; LOOK=V3(0,0,0); BOXR=[RX,RY,RZ];
  resize();
  /* Where the answer begins. The fold has to end on the spot the first word
     will occupy, or the cursor appears in one place and the writing starts in
     another. Derived from the seat the camera finishes the fold in, so it
     stays put whatever the stage is sized to. */
  {
    const hH=ENDR*Math.tan(cam.fov*Math.PI/360), hW=hH*(VW/VH);
    CARET=V3(-hW+22, 22+hH-34, 0);
  }
  const K=buildCloud();

  /* the question, as it was typed */
  const qel=$("q"); qel.innerHTML=""; qel.style.opacity=0;
  const marks=G.prompt.split(/(?=\s)/).map(w=>{
    const b=document.createElement("b"); b.textContent=w; qel.appendChild(b); return b;});
  await sleep(120); if(me!==run) return;
  qel.style.opacity=1;
  await sleep(760); if(me!==run) return;

  /* ---------- 1 · the words come across ---------- */
  $("step").textContent="1 / 6";
  hud("tokenizing the prompt");
  const sr=stageEl.getBoundingClientRect();
  words.forEach((n,i)=>{
    const mk=marks.find(b=>b.textContent.trim()===recs[i].w)||marks[i];
    const r=mk.getBoundingClientRect();
    const st=s2w(r.left+r.width/2-sr.left,r.top+r.height/2-sr.top);
    n.h.copy(st); n.from=st.clone(); n.to=recs[i].p2.clone();
    setTimeout(()=>mk.classList.add("sent"),i*110+60);
  });
  await clock(NQ*110+620,(_,el)=>{
    words.forEach((n,i)=>{
      const k=out(cl((el-i*110)/560));
      n.h.lerpVectors(n.from,n.to,k); n.op=k;
    });
  });
  if(me!==run) return;
  marks.forEach(b=>b.classList.add("sent"));

  /* ---------- 2 · each word inside its neighbourhood ---------- */
  $("step").textContent="2 / 6";
  hud("looking up each token's embedding");
  /* The whole neighbourhood, not the ten closest. This was the second cap on
     the same thing: the recorded set was being thinned to fit a narrow screen
     and then thinned again here, so a phone was showing six of thirteen. A
     neighbourhood with its far side cut off is a direction, not a
     neighbourhood. */
  const shown=new Map();
  G.q.forEach((d,i)=>{
    kids.filter(r=>r.parent===i).forEach(r=>{ shown.set(r,1);
      const e=mkEdge(words[i],r.n,GREY,0,r.rel); r.e2=e; });
  });
  const STEP=230;
  await clock((NQ-1)*STEP+900,(_,el)=>{
    G.q.forEach((d,i)=>{
      const t0=i*STEP, k=io(seg(el,t0,t0+620));
      words[i].warm=io(seg(el,t0+120,t0+520));
      kids.filter(r=>r.parent===i&&shown.has(r)).forEach(r=>{
        r.n.op=k*(.17+r.rel*.55);
        r.n.dr=.40; r.n.am=6.5;
        r.n.size=.88+r.rel*.34;
        if(r.e2) r.e2.op=k*(.25+r.rel*.6);
      });
    });
  });
  if(me!==run) return;
  await sleep(900); if(me!==run) return;

  /* ---------- into the box ---------- */
  hud("960 dimensions, projected down to 3");
  /* the rest of the structure, built now and revealed by the move */
  const live=recs.map((r,j)=>j);
  for(let k=0;k<K;k++){
    const inK=live.filter(j=>recs[j].vis[k]);
    const made=new Set();
    const join=(i,j,w)=>{
      const key=Math.min(i,j)+":"+Math.max(i,j);
      if(made.has(key)) return; made.add(key);
      const e=mkEdge(nodes[i],nodes[j],GREY,0,w); e.layer=k;
      e.rad=(lay[i][k].length()+lay[j][k].length())*.5;
    };
    inK.forEach(i=>{
      inK.map(j=>j===i?null:{j,d:lay[i][k].distanceTo(lay[j][k])}).filter(Boolean)
        /* nearer neighbours bind harder, and now look it */
        .sort((p,q)=>p.d-q.d).slice(0,4).forEach((o,k)=>join(i,o.j,.62-k*.11));
    });
    for(let n=0;n<Math.round(inK.length*.3);n++){
      const i=inK[(Math.random()*inK.length)|0];
      const far=inK.filter(j=>j!==i&&lay[i][k].distanceTo(lay[j][k])>RX*.55);
      if(far.length) join(i,far[(Math.random()*far.length)|0],.16);
    }
  }
  /* contact with the wall: one stub per outer word, landing on a face */
  stubs=[];
  recs.map((r,j)=>({j,d:lay[j][0].length()})).filter(o=>recs[o.j].role>0)
    .sort((a,b)=>b.d-a.d).slice(0,46).forEach(o=>{
      const pin=mkNode("",0,0,0,0); pin.base3=0; pin.dr=0;
      lay.push(lay[o.j].map(v=>faceHit(v,[RX,RY,RZ])));
      nodes.push(pin); recs.push({role:3,vis:recs[o.j].vis,n:pin});
      const e=mkEdge(nodes[o.j],pin,GREY,0,.4); e.stub=1; e.ph=Math.random(); e.own=o.j;
      stubs.push(e); HITS.push({n:pin,e});
    });
  cube=[];
  for(const sx of[-1,1])for(const sy of[-1,1])for(const sz of[-1,1]){
    const n=mkNode("",sx*RX,sy*RY,sz*RZ,0); n.base3=0; cube.push(n);
  }
  [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]]
    .forEach(([a,b])=>{const e=mkEdge(cube[a],cube[b],WIRE,0,.22); e.frame=1;});
  cubeHome=cube.map(n=>n.h.clone());
  /* pins and cube start where the first layout puts them */
  nodes.forEach((n,j)=>{ if(recs[j].role===3) n.h.copy(lay[j][0]); });

  const from=nodes.map((n,j)=>recs[j].role===3?lay[j][0].clone()
              :(recs[j].p2?recs[j].p2.clone():lay[j][0].clone()));
  const op0=nodes.map(n=>n.op);
  await clock(1700,(_,el)=>{
    const k=io(seg(el,0,1500));
    CAMR=lerp(CAM2,CAM3,k); CAMA=lerp(0,ORBIT,k); CAMB=lerp(0,30,k);
    nodes.forEach((n,j)=>{
      const r=recs[j];
      n.h.lerpVectors(from[j],lay[j][0],k);
      if(r.role===3) return;
      n.op=lerp(op0[j],r.vis[0]?n.base3:0,k);
      n.dr=0;
      if(r.role===1) n.size=lerp(n.size,1.0,k);
      if(r.role===0) n.warm=1;
    });
    EDGES.forEach(e=>{ if(e.frame) e.op=k*.62;
                       else if(!e.layer&&e.layer!==0) e.op=(1-k)*(e.op||0); });
  });
  if(me!==run) return;
  recs.forEach(r=>{ if(r.e2) r.e2.op=0; });

  /* ---------- 3 · the same space, along different axes ---------- */
  $("step").textContent="3 / 6";
  /* What the pass is doing, in the fewest words that are still true. */
  /* These are not four pictures of the same thing. Each reads a different
     slice of the space the words are held in, and what falls near what
     changes with the slice. That is the whole method: meaning is a position
     in a space with far more directions than a screen has. */
  /* The share each view carries is measured, not asserted: the first three
     components hold several times what the next three do, and by the tenth
     there is almost nothing left to tell words apart by. Saying so is what
     makes the fourth view worth watching rather than a repeat. */
  const pct=v=>(v*100).toFixed(v<.1?1:0)+"%";
  const VAR=G.var||null;
  const NAMES=(VAR?[
    "principal components 1 to 3 of 960, holding "+pct(VAR[0])+" of the difference",
    "components 4 to 6, another "+pct(VAR[1])+": other words fall together",
    "components 7 to 9, "+pct(VAR[2])+": finer distinctions",
    "components 10 to 12, "+pct(VAR[3])+": the last with any signal",
  ]:[
    "associating across the model's 960 dimensions",
    "another slice: other words fall together",
    "finer distinctions",
    "the last directions with signal",
  ]);
  const MOVE=950, WIRE_T=1500, REST=340;
  /* How long one connection takes to flare and settle. It has to be short
     next to the spread of start times below, or the band of lit edges is as
     wide as the cloud and the wiring reads as the whole thing blinking on
     rather than as something travelling outward from the middle. */
  const PULSE=260;
  /* Fired in a random order the cloud read as noise rather than as something
     spreading, so each edge now takes its turn from how far out it sits. A
     fifth of the timing stays random: pure radius order wires in visible
     concentric shells, which reads as mechanical. */
  for(let k=0;k<K;k++){
    const ly=EDGES.filter(e=>e.layer===k);
    const mx=Math.max(1,...ly.map(e=>e.rad));
    ly.forEach(e=>{ const f=cl(e.rad/mx);
      e.t0=MOVE*.55+WIRE_T*(.05+.72*(.82*f+.18*Math.random()));
      /* Not every connection flares. All of them lighting up read as noise,
         and the ones worth seeing are the short ones: a word reaching its own
         neighbours rather than across the whole cloud. */
      e.lit=Math.random() < .30+.34*(1-f); });
  }
  /* The first pass wires the layout the words have just arrived in. Treating
     it as a morph meant the move was skipped but its DESTINATION was not, so
     the cloud jumped straight to the second layout the instant step three
     began. That was the snap. */
  const CYCS=[[0,0,true]];
  for(let c=0;c<K-1;c++) CYCS.push([c,c+1,false]);
  const CLAYPAIR=[CLAY,CLAYC];
  const allN=nodes.concat(cube), base=allN.map(n=>n.h.clone());
  const c0=[CAMR,CAMA,CAMB];
  for(let ci=0;ci<CYCS.length;ci++){
    const [i,nx,still]=CYCS[ci], LASTC=ci===CYCS.length-1;
    const DUR=still?WIRE_T+REST:MOVE+WIRE_T+REST;
    nodes.forEach((n,j)=>{ if(recs[j].role) n.clay=false; });
    if(LASTC){
      /* Nothing settles here. The camera carries on orbiting straight into the
         fold, and the mesh stays the grey it happens to be: the warm to clay
         belongs to the fold, which opens on a grey cloud and colours it while
         it closes. Only the blending has to change in advance, because the
         moment every line lands on one path additive would sum past clay. */
      lineMat.blending=THREE.NormalBlending; lineMat.needsUpdate=true;
    }
    await clock(DUR,(_,el)=>{
      const tm=still?el+MOVE:el;
      const k=io(seg(tm,0,MOVE));
      /* the accent crosses over with the shape */
      const from=still?CLAYPAIR:VIEWC[i], to=VIEWC[nx];
      blendAcc(from,to,k);
      const sc=1;
      nodes.forEach((n,j)=>{
        const r=recs[j];
        n.h.lerpVectors(lay[j][i],lay[j][nx],k).multiplyScalar(sc);
        if(r.role===3) return;
        n.op=n.base3*((r.vis[i]?1-k:0)+(r.vis[nx]?k:0));
      });
      /* The still first pass reads the same schedule the morphing passes do,
         but it begins at tm=MOVE, by which point the earliest edges were
         already part-way through their pulse: two fifths of the first cloud
         lit on frame one, which is what made it look jerky. Shifting the
         schedule by the amount the still pass skips starts it at zero. */
      const tw=tm-(still?MOVE*.45:0);
      const dir=(i%2)?1:-1;
      cube.forEach((n,j)=>n.h.copy(rotY(cubeHome[j],dir*(tm/DUR-.5)*.10)).multiplyScalar(sc));
      const wired=cl((tw-MOVE*.5)/(WIRE_T*.8));
      EDGES.forEach((e,ei)=>{
        if(e.frame) return;
        if(e.stub){
          const ow=recs[e.own];
          const vz=(ow.vis[i]?1-k:0)+(ow.vis[nx]?k:0);
          const len=e.a.p.distanceTo(e.b.p);
          /* the wall contacts are the outermost thing there is, so they
             arrive with the last and furthest of the words */
          const tf=MOVE*.55+WIRE_T*(.05+.72*(.90+.12*e.ph));
          const kk=seg(tw,tf,tf+PULSE);
          const amp=kk>0&&kk<1?Math.sin(kk*Math.PI):0;
          e.op=wired*.85*vz*cl((len-16)/26);
          e.col.setHex(amp>.25?ACC:GREY); e.w=.3+amp*.5;
        }else if(e.layer===i&&tm<MOVE*.8){
          e.op=(1-seg(tm,0,MOVE*.8))*.8; e.col.setHex(GREY); e.w=.32;
        }else if(e.layer!==nx){ e.op=0; }
        else{
          const kk=seg(tw,e.t0,e.t0+PULSE);
          const amp=kk>0&&kk<1?Math.sin(kk*Math.PI):0;
          const hot=e.lit&&amp>.22;
          e.op=kk*.84; e.col.setHex(hot?ACC:GREY); e.w=.32+amp*(e.lit?.52:.16);
          if(hot){ e.a.clay=true; e.b.clay=true; }
        }
      });
      const f=seg(tm,MOVE*.55,MOVE*1.08);
      const nm=NAMES[f>.5?nx:i];
      hud(nm);
    });
    if(me!==run) return;
  }

  /* ---------- 4 · what the thirty-two layers are looking at ----------
     The one beat here that is a measurement of the mechanism rather than of
     the result. The attention in this export is fused into a single op per
     layer, so there is no softmax tensor to read, but the op takes its
     post-rotary Q as a named tensor and hands its K back as part of the KV
     cache. capture-attn.py adds the Q tensors as graph outputs and does the
     matmul and the softmax itself, so these are the model's real attention
     weights and not a stand-in for them.

     They are also not what anybody expects, which is why they are worth
     showing. Most of the mass in the later layers lands on the very first
     token and on the line breaks of the chat template nobody sees. That is
     the attention sink: a head with nothing to contribute still has to put
     its softmax somewhere. Only in the middle of the stack does the question
     itself get read. A tidy heatmap over the content words would have been a
     story rather than a measurement. */
  if(G.attn&&G.attn.at&&G.attn.at.length){
    $("step").textContent="4 / 6";
    const A=G.attn, T=A.toks.length;
    const keepN=NODES.slice(), keepE=EDGES.slice();
    const cam0=[CAMR,CAMA,CAMB,CAMY], look0=LOOK.clone(), box0=BOXR;
    NODES.length=0; EDGES.length=0; BOXR=[1e9,1e9,1e9];
    setAcc(CLAY,CLAYC);

    const show=t=>t==="\n"?"\u23ce":t;
    /* the prompt as the model receives it, in reading order, wrapped the way
       it has to be to fit: the scaffolding included, because half of what
       follows lands on it */
    const PER=Math.max(6,Math.min(T,Math.round(Math.sqrt(T*(VW/VH)*2.4))));
    const ROWS=Math.ceil(T/PER);
    const SPX=Math.min(2*RX*.94/PER,112), SPY=Math.min(54,RY*.5/Math.max(1,ROWS-1)+30);
    const TOPY=(ROWS-1)*SPY*.5+RY*.22;
    const tn=A.toks.map((t,i)=>{
      const r=Math.floor(i/PER), c=i%PER, wide=Math.min(PER,T-r*PER);
      const n=mkNode(show(t),(c-(wide-1)/2)*SPX,TOPY-r*SPY,0,0);
      n.size=.80; n.dr=0; n.am=0;
      /* the question's own tokens in ink, the template in mono, so where
         your words sit inside the scaffolding is visible at a glance */
      n.mono=!(i>=A.ask[0]&&i<A.ask[1]);
      return n;
    });
    /* the position the next word is about to come from: every layer reads
       back to here, and only backwards, which is the whole of causality */
    const BOT=TOPY-(ROWS-1)*SPY-Math.max(64,RY*.34);
    const now=mkNode("\u2502",0,BOT,0,0);
    now.size=1.15; now.dr=0; now.am=0; now.fixed=1; now.warm=1; now.mono=1;
    const beams=tn.map(n=>mkEdge(now,n,GREY,0,.3));

    /* framed on what is actually there, top label to convergence, rather
       than on the box that is not being drawn */
    CAMA=0; CAMB=0; CAMY=(TOPY+BOT)/2;
    LOOK=V3(0,CAMY,0);
    CAMR=fitCam((PER-1)*SPX*.5+96,(TOPY-BOT)/2+30,1.07,0);
    const NAME=L=>{
      const top=L.a.map((v,i)=>[v,i]).sort((x,y)=>y[0]-x[0]).slice(0,3);
      return "layer "+(L.l+1)+" of 32 looks at "
        +top.map(([v,i])=>show(A.toks[i]).trim()+" "+(v*100).toFixed(0)+"%").join(", ");
    };
    const IN=640, HOLD=1250;
    for(let k=0;k<A.at.length;k++){
      const L=A.at[k], pv=k?A.at[k-1]:null, mx=Math.max.apply(null,L.a);
      hud(NAME(L));
      await clock(IN+HOLD+(k?0:260),(_,t)=>{
        const f=io(seg(t,0,IN)), on=io(seg(t,0,340));
        tn.forEach((n,i)=>{
          const g=Math.sqrt(lerp(pv?pv.a[i]:0,L.a[i],f)/mx);
          n.op=on*(.20+g*.80); n.warm=g*g; n.size=.76+g*.44;
        });
        beams.forEach((e,i)=>{
          const g=Math.sqrt(lerp(pv?pv.a[i]:0,L.a[i],f)/mx);
          e.op=on*(.06+g*.88); e.w=.20+g*1.55;
          e.col.setHex(g>.52?CLAY:GREY);
        });
        now.op=on;
      });
      if(me!==run) return;
    }
    const was=NODES.map(n=>n.op), wase=EDGES.map(e=>e.op);
    await clock(400,(_,t)=>{ const f=1-seg(t,0,400);
      NODES.forEach((n,i)=>n.op=was[i]*f);
      EDGES.forEach((e,i)=>e.op=wase[i]*f); });
    if(me!==run) return;
    NODES.length=0; EDGES.length=0; BOXR=box0;
    keepN.forEach(n=>NODES.push(n)); keepE.forEach(e=>EDGES.push(e));
    CAMR=cam0[0]; CAMA=cam0[1]; CAMB=cam0[2]; CAMY=cam0[3]; LOOK=look0;
  }

  /* ---------- 5 · compressed into the cursor ---------- */
  $("step").textContent="5 / 6";
  hud("32 layers, one forward pass");
  const R4=nodes.concat(cube);   /* the frame folds away with its contents */
  const xs=R4.map(n=>n.h.x), lo=Math.min.apply(null,xs), hi=Math.max.apply(null,xs);
  const ys=R4.map(n=>n.h.y), ylo=Math.min.apply(null,ys), yhi=Math.max.apply(null,ys);
  /* The bundle's width is derived, not guessed. The caret is drawn 3px wide
     and a line renders about 1px, so the outermost line CENTRES need to span
     2px, converted to world units at the caret's distance. Measured from the
     camera's FINAL seat, not its current one: the camera is still moving
     while this is being set up. */
  const ENDCAM=V3(0,0,ENDR);
  const pxw=VH/(2*ENDCAM.distanceTo(CARET)*Math.tan(cam.fov*Math.PI/360));
  const CW=2/pxw, TOP=CARET.y+9;
  const cam0=[CAMR,CAMA,CAMB,LOOK.y];
  R4.forEach((n,i)=>{ n.home=n.h.clone(); n.op0=n.op; n.size0=n.size; n.i4=i;
    n.rank=(n.home.x-lo)/((hi-lo)||1);
    n.v=(n.home.y-ylo)/((yhi-ylo)||1);
    n.sx=CARET.x+((i%7)/6-.5)*CW; });
  EDGES.forEach(e=>e.op0=e.op);
  /* what the fold inherits: a grey mesh, and words lit or not as step three
     left them. Held so the colour can be driven from it rather than replacing
     it, which is what let the stage open already clay. */
  const col0=EDGES.map(e=>e.col.clone());
  const warm0=R4.map(n=>n.warm===undefined?(n.clay?1:0):n.warm);
  const CC=new THREE.Color(CLAY);
  let said=0;
  /* Once the stack is a cursor there is nothing left to watch, so the hold
     between the squeeze finishing and the cloud clearing is dead time. The
     fade now starts almost on the beat the squeeze lands. */
  await clock(2820,(_,t)=>{
    const close=io(seg(t,1600,2460));
    const packed=io(seg(t,760,2050));
    const gone=seg(t,2500,2700), bye=seg(t,120,620);
    /* The fold starts from wherever the camera happens to be, orbiting and
       off centre, and the camera finds its way head-on while the fold runs.
       Nothing waits for the shot. The cloud scales with the dolly so its
       apparent size holds until the fold itself takes it. */
    const warm=io(seg(t,800,2180));
    const ck=io(seg(t,0,1760)), sc=lerp(1,ENDR/CAM3,ck);
    CAMR=lerp(cam0[0],ENDR,ck); CAMA=lerp(cam0[1],0,ck); CAMB=lerp(cam0[2],0,ck);
    LOOK=V3(0,lerp(cam0[3],22,ck),0);
    BOXR=[RX*sc,RY*sc,RZ*sc];
    R4.forEach(n=>{
      /* One ramp, not two. The pull to the centre line and the ride up the
         box used to be separate windows 250ms apart, which read as the cloud
         squeezing flat and then, as a second move, rising. A word now travels
         diagonally: it goes in and up at once, and only the final squeeze into
         the caret's own 21px band is left as a beat of its own. */
      const k=io(cl((t-600-n.rank*570)/880)), g=k;
      const hx=n.home.x*sc, hy=n.home.y*sc, hz=n.home.z*sc;
      /* The staging band used to be 170px deep, which left three quarters of
         the climb to the final squeeze and so split the fold in two: in, then
         up. Shallow, the per-node ramp carries most of the rise itself and the
         squeeze is only a tightening. The top of the band stays on the caret's
         top edge, so nothing ever travels above it. */
      const yl=TOP-(1-n.v)*72, ry=hy+(yl-hy)*g;
      const yc=CARET.y+(n.v-.5)*CH;
      n.h.set(hx+(n.sx-hx)*k, ry+(yc-ry)*close, hz*(1-k));
      n.size=n.size0*(1-close*.94);
      n.warm=lerp(warm0[n.i4],1,warm);
      n.op=n.op0*(1-gone)*(1-.35*packed);
    });
    EDGES.forEach((e,ei)=>{
      e.col.copy(col0[ei]).lerp(CC,warm);
      e.op=e.op0*(1-gone)*(1-.45*packed)*(e.stub?1-bye:1);
    });
    /* The moment the cursor exists, the page stops saying it is thinking:
       the thinking mark hands over to the cursor, because from here it is
       answering rather than working out what to answer. */
    if(t>2180 && !said){ said=1; if(window.onCursor) window.onCursor(); }
    LATE=()=>{ if(t>2180) caret(CARET,seg(t,2180,2420),t); };
  });
  if(me!==run) return;
  NODES.length=0; EDGES.length=0; HITS.length=0;
  lineMat.blending=THREE.AdditiveBlending; lineMat.needsUpdate=true;
  /* One blink, not two. A cursor blinking on an empty line is a wait, and
     the wait was longer than anything it was waiting for. */
  await clock(700,(_,el)=>{ LATE=()=>caret(CARET,1,el); });
  if(me!==run) return;

  /* ---------- and out ----------
     The reply used to be drawn here, in the canvas, as 3D words on a line.
     It is written into the thread itself now: real text, wrapping over real
     lines, in the message where an answer belongs. A reply is not a thing to
     watch inside a frame, it is a thing to read.

     So the sequence ends on the blinking cursor it folded into, and the page
     takes over from there. What it hands back is where that cursor is, in
     page coordinates, so the writing can begin from exactly the spot the
     network became. */
  $("step").textContent="writing";
  hud("sampling from 49,152 candidates");
  const v=CARET.clone().project(cam);
  const r=stageEl.getBoundingClientRect();
  return { x:r.left+(v.x*.5+.5)*r.width, y:r.top+(-v.y*.5+.5)*r.height };
}

window.playRun=play;
window.stopRun=()=>{ run++; LATE=null; NODES.length=0; EDGES.length=0; HITS.length=0;
  ctx.clearRect(0,0,ov.width,ov.height); renderer.render(scene,cam); };
window.isPaused=()=>paused;
window.setPaused=v=>{paused=v;};
/* The provenance line has to change with the question, because the two kinds
   of run are honest about different things. A recorded question carries a real
   MDS projection of the embedding matrix. A typed one cannot: that table is
   not on this page. What it carries instead is measured rather than invented,
   and the wording says which is which rather than claiming the stronger one
   both times. */
function note(){
  const real = G && G.live
    ? "Your question was run through the model in this tab. Every candidate and "
      +"every share in step five is its own next-token distribution. The "
      +"neighbourhoods are measured too, but differently: a word sits where it "
      +"does because of how strongly each of your words predicts it, read off "
      +"the same forward pass. Direction therefore means words your question "
      +"predicts alike, not words near each other in the embedding matrix."
    : "The neighbourhoods are a real MDS projection of the model's embedding "
      +"matrix, sampled one per direction from each word's 45 nearest. The "
      +"candidates and their shares in step five are the model's actual "
      +"next-token distributions.";
  $("note").innerHTML="<b>What is real here.</b> "+real
   +" The box, the collapse and the spreading front are staging. The four sets "
   +"of axes in step three are named for what switching dimensions does, but the "
   +"data carries a two-dimensional projection, so those four views re-arrange "
   +"the same two numbers rather than reading new ones.";
}
window.setNote=note;
resize(); requestAnimationFrame(frame);
