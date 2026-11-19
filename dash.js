(function(){
const LOGK='btcusd_sniper_log_v1';
let log=[],timer=null,alerts=false;
try{log=JSON.parse(localStorage.getItem(LOGK)||'[]')}catch(e){}
const save=()=>{try{localStorage.setItem(LOGK,JSON.stringify(log.slice(-100)))}catch(e){}};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function settle(L){
  const b=L.m5,sp=L.spread||0;
  log.forEach(s=>{
    if(s.res&&s.res!=='open')return;
    const i=b.findIndex(x=>x.t===s.at);if(i<0||i+1>=b.length)return;
    const long=s.dir==='long',e=b[i+1].o+(long?1:-1)*sp/2,risk=Math.abs(e-s.stop);if(risk<=0)return;
    s.entry=e;s.target=long?e+1.5*risk:e-1.5*risk;s.res='open';
    for(let j=i+1;j<b.length&&j<=i+30;j++){const q=b[j];
      if(long?q.l<=s.stop:q.h>=s.stop){s.res='stop';s.R=-1;break}
      if(long?q.h>=s.target:q.l<=s.target){s.res='target';s.R=1.5;break}}
    if(s.res==='open'&&i+30<b.length){const c=b[i+30].c;s.R=Math.max(-1,Math.min(1.5,(long?c-e:e-c)/risk));s.res='timeout'}
  });
}
function renderLog(){
  const done=log.filter(s=>s.R!=null&&s.res!=='open');
  const tot=done.reduce((a,s)=>a+s.R,0);
  $('logsum').textContent=log.length?`${log.length} logged, ${done.length} settled, total ${tot.toFixed(1)}R. Too few to say anything about accuracy.`:'No paper signals logged yet. They are saved in this browser only.';
  $('logtbl').innerHTML=log.length?'<table><tr><th>Time (UTC)</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th></tr>'+log.slice().reverse().slice(0,20).map(s=>`<tr><td>${hm(s.at)}</td><td class="${s.dir=='long'?'up':'dn'}">${s.dir}</td><td>${s.entry?f(s.entry):'pending'}</td><td>${f(s.stop)}</td><td>${s.target?f(s.target):'-'}</td><td>${s.res||'pending'}${s.R!=null?' '+s.R.toFixed(1)+'R':''}</td></tr>`).join('')+'</table>':'';
}
function chart(L){
  const c=$('chart'),dpr=window.devicePixelRatio||1,w=c.clientWidth,h=260;
  c.width=w*dpr;c.height=h*dpr;const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);
  const b=L.m5.slice(-80);let hi=Math.max(...b.map(q=>q.h)),lo=Math.min(...b.map(q=>q.l));
  if(L.dir&&L.stop){hi=Math.max(hi,L.stop);lo=Math.min(lo,L.stop)}
  const pd=(hi-lo)*.06;hi+=pd;lo-=pd;
  const pw=58,Y=p=>(hi-p)/(hi-lo)*(h-16)+8,cw=(w-pw)/b.length;g.font='11px system-ui,sans-serif';
  const line=(p,col,dash,t)=>{if(p>hi||p<lo)return;g.strokeStyle=col;g.setLineDash(dash);g.beginPath();g.moveTo(0,Y(p));g.lineTo(w-pw,Y(p));g.stroke();g.setLineDash([]);g.fillStyle=col;g.fillText(t,w-pw+4,Y(p)+4)};
  L.sup.forEach(l=>line(l.p,css('--up'),[4,4],f(l.p)));L.res.forEach(l=>line(l.p,css('--dn'),[4,4],f(l.p)));
  b.forEach((q,i)=>{const x=i*cw+cw/2,up=q.c>=q.o;g.strokeStyle=g.fillStyle=up?css('--up'):css('--dn');g.beginPath();g.moveTo(x,Y(q.h));g.lineTo(x,Y(q.l));g.stroke();const y1=Y(Math.max(q.o,q.c)),y2=Y(Math.min(q.o,q.c));g.fillRect(x-cw*.35,y1,cw*.7,Math.max(1,y2-y1))});
  if(L.dir&&L.stop)line(L.stop,css('--wait'),[2,3],'stop '+f(L.stop));
}
function show(L){
  const cand=L.vc!=='w',el=$('sig');
  el.className='sigcard '+L.vc;
  $('sigdir').textContent=cand?L.dir.toUpperCase():'WAIT';
  $('sigpx').textContent=L.px?'BTC '+f(L.px):'';
  $('sigtxt').textContent=cand?'Paper candidate: M5 setup, M1 confirmation, M15 context and spread all agree.':'WAIT — NO CONFIRMED SETUP. '+(L.why.slice(0,2).join(' ')||'');
  const m=[];
  if(L.spread!=null)m.push('Spread <b>'+f(L.spread)+'</b>');
  m.push('M15 trend <b>'+L.trend+'</b>');
  if(cand&&L.stop){const r=Math.abs(L.px-L.stop);m.push('Stop <b>'+f(L.stop)+'</b>');m.push('1.5R target <b>'+f(L.dir=='long'?L.px+1.5*r:L.px-1.5*r)+'</b>')}
  $('sigmeta').innerHTML=m.join('');
  document.title=(cand?L.dir.toUpperCase():'WAIT')+' · BTCUSD Sniper';
}
document.addEventListener('analysed',()=>{
  const L=window.LAST;if(!L||!L.m5)return;
  if(L.vc!=='w'&&L.at&&!log.some(s=>s.at===L.at&&s.dir===L.dir)){
    log.push({at:L.at,dir:L.dir,stop:L.stop,px:L.px});
    if(alerts&&'Notification' in window&&Notification.permission==='granted')new Notification('BTCUSD paper signal: '+L.dir.toUpperCase(),{body:'Price '+f(L.px)+', stop '+f(L.stop)});
  }
  settle(L);save();show(L);renderLog();chart(L);
});
window.addEventListener('resize',()=>{if(window.LAST&&window.LAST.m5)chart(window.LAST)});
$('auto').onclick=()=>{
  if(timer){clearInterval(timer);timer=null;$('auto').textContent='Auto-refresh: off'}
  else{timer=setInterval(live,60000);$('auto').textContent='Auto-refresh: 60s';live()}
};
$('notif').onclick=async()=>{
  if(alerts){alerts=false;$('notif').textContent='Alerts: off';return}
  if(!('Notification' in window)){$('err').textContent='This browser does not support notifications.';return}
  const p=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  alerts=p==='granted';$('notif').textContent='Alerts: '+(alerts?'on':'off');
  if(!alerts)$('err').textContent='Notification permission was not granted. Alerts only work while this page is open.';
};
renderLog();live();
})();
