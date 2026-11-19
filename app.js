const $=id=>document.getElementById(id);
const f=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const hm=t=>new Date(t).toISOString().slice(11,16)+'Z';
const li=a=>a.length?'<ul>'+a.map(x=>'<li>'+x+'</li>').join('')+'</ul>':'<p class="sub">None observed.</p>';

function parse(txt,name){
  txt=(txt||'').trim(); if(!txt) return null;
  let j; try{j=JSON.parse(txt)}catch(e){throw new Error(name+': not valid JSON.')}
  let b;
  if(j&&Array.isArray(j.values)) b=j.values.map(r=>({t:Date.parse(String(r.datetime).replace(' ','T')+'Z'),o:+r.open,h:+r.high,l:+r.low,c:+r.close,v:r.volume!=null?+r.volume:null})).sort((a,c)=>a.t-c.t);
  else if(Array.isArray(j)&&Array.isArray(j[0])) b=j.map(r=>({t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]}));
  else throw new Error(name+': format not recognised. Use Twelve Data time_series JSON or Binance klines.');
  b=b.filter(x=>[x.o,x.h,x.l,x.c].every(Number.isFinite));
  if(b.length<30) throw new Error(name+': needs at least 30 candles, got '+b.length+'.');
  return b;
}
function atr(b,end,n=14){let s=0,k=0;for(let i=Math.max(1,end-n+1);i<=end;i++){s+=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));k++}return k?s/k:0}
function swings(b,end,k=2,look=60){const r=[];for(let i=Math.max(k,end-look);i<=end-k;i++){let H=true,L=true;for(let j=1;j<=k;j++){if(b[i].h<=b[i-j].h||b[i].h<=b[i+j].h)H=false;if(b[i].l>=b[i-j].l||b[i].l>=b[i+j].l)L=false}if(H)r.push({i,p:b[i].h,t:'H'});if(L)r.push({i,p:b[i].l,t:'L'})}return r}
function levels(b,a){const s=swings(b,b.length-1,2,300).map(x=>x.p).sort((x,y)=>x-y);const cl=[];for(const p of s){const c=cl[cl.length-1];if(c&&p-c.max<=.35*a){c.max=p;c.sum+=p;c.n++}else cl.push({max:p,sum:p,n:1})}return cl.map(c=>({p:c.sum/c.n,n:c.n}))}

/* M5 detector: needs a structure event plus at least 3 independent confirmations in total */
function detect(b,i){
  if(i<25) return null; const a=atr(b,i); if(!a) return null;
  const x=b[i],p=b[i-1],w=b.slice(i-20,i),w2=b.slice(i-21,i-1);
  const hi=Math.max(...w.map(q=>q.h)),lo=Math.min(...w.map(q=>q.l));
  const hi2=Math.max(...w2.map(q=>q.h)),lo2=Math.min(...w2.map(q=>q.l));
  const bu=[],be=[];let sb=0,se=0;
  if(x.l<lo&&x.c>lo){bu.push('Liquidity sweep below '+f(lo)+', closed back above');sb++}
  if(x.h>hi&&x.c<hi){be.push('Liquidity sweep above '+f(hi)+', closed back below');se++}
  if(p.c>hi2&&x.c<hi2){be.push('Failed breakout above '+f(hi2));se++}
  if(p.c<lo2&&x.c>lo2){bu.push('Failed breakdown below '+f(lo2));sb++}
  const sw=swings(b,i,2,60),sh=sw.filter(s=>s.t=='H').pop(),sl=sw.filter(s=>s.t=='L').pop();
  if(sh&&x.c>sh.p&&p.c<=sh.p){bu.push('Break of structure above swing high '+f(sh.p));sb++}
  if(sl&&x.c<sl.p&&p.c>=sl.p){be.push('Break of structure below swing low '+f(sl.p));se++}
  const net=x.c-b[i-3].c;
  if(net>.8*a)bu.push('Upward momentum over 3 candles');if(net<-.8*a)be.push('Downward momentum over 3 candles');
  if(x.v!=null){const av=w.reduce((s,q)=>s+q.v,0)/w.length;if(av>0&&x.v>1.5*av){(x.c>=x.o?bu:be).push('Volume '+(x.v/av).toFixed(1)+'× the 20-candle average')}}
  const body=Math.abs(x.c-x.o),rg=x.h-x.l||1,uw=x.h-Math.max(x.o,x.c),lw=Math.min(x.o,x.c)-x.l;
  if(p.c<p.o&&x.c>x.o&&x.c>=p.o&&x.o<=p.c)bu.push('Bullish engulfing candle');
  if(p.c>p.o&&x.c<x.o&&x.c<=p.o&&x.o>=p.c)be.push('Bearish engulfing candle');
  if(lw>2*body&&lw>.5*rg&&x.c>x.l+.66*rg)bu.push('Long lower wick rejection');
  if(uw>2*body&&uw>.5*rg&&x.c<x.h-.66*rg)be.push('Long upper wick rejection');
  let dir=null;
  if(bu.length>=3&&sb>=1&&bu.length>be.length)dir='long';
  else if(be.length>=3&&se>=1&&be.length>bu.length)dir='short';
  const l3=b.slice(i-2,i+1);
  return{dir,bu,be,a,stop:dir=='long'?Math.min(...l3.map(q=>q.l))-.1*a:Math.max(...l3.map(q=>q.h))+.1*a};
}

function backtest(b,spread){
  const tr=[],sig=new Set();let last=-99;
  for(let i=30;i<b.length-31;i++){
    const d=detect(b,i);if(!d||!d.dir)continue;sig.add(i);
    if(i-last<6)continue;last=i;
    const L=d.dir=='long',entry=b[i+1].o+(L?1:-1)*spread/2,risk=Math.abs(entry-d.stop);
    if(risk<=spread*1.5||risk<=0)continue;
    let R=null;
    for(let j=i+1;j<=i+30&&R===null;j++){
      const q=b[j];
      if(L?q.l<=d.stop:q.h>=d.stop)R=-1;
      else if(L?q.h>=entry+1.5*risk:q.l<=entry-1.5*risk)R=1.5;
    }
    let hit=R===1.5;
    if(R===null){const c=b[i+30].c;R=Math.max(-1,Math.min(1.5,(L?c-entry:entry-c)/risk))}
    const seg=b.slice(i-40,i+1);let sa=0;for(let k=1;k<seg.length;k++)sa+=Math.abs(seg[k].c-seg[k-1].c);
    const er=sa?Math.abs(seg[40].c-seg[0].c)/sa:0,vr=atr(b,i,14)/(atr(b,i,60)||1);
    tr.push({i,R,hit,reg:er>.25?'Trending':'Ranging',vol:vr>1?'High volatility':'Low volatility'});
  }
  let miss=0,chk=0;
  for(let i=30;i<b.length-21;i+=3){
    let near=false;for(let k=i-3;k<=i;k++)if(sig.has(k))near=true;if(near)continue;chk++;
    const a=atr(b,i),e=b[i].c;let up=null,dn=null;
    for(let j=i+1;j<=i+20;j++){if(up===null){if(b[j].l<=e-a)up=false;else if(b[j].h>=e+2*a)up=true}if(dn===null){if(b[j].h>=e+a)dn=false;else if(b[j].l<=e-2*a)dn=true}}
    if(up||dn)miss++;
  }
  return{tr,miss,chk};
}
function stats(t){
  const n=t.length;if(!n)return{n:0};
  let cum=0,pk=0,dd=0;t.forEach(x=>{cum+=x.R;pk=Math.max(pk,cum);dd=Math.max(dd,pk-cum)});
  const w=t.filter(x=>x.hit).length;
  return{n,w,fp:n-w,wr:w/n,avg:t.reduce((s,x)=>s+x.R,0)/n,dd};
}
const row=(l,s)=>s.n?`<tr><td>${l}</td><td>${s.n}</td><td>${(s.wr*100).toFixed(0)}%</td><td>${s.fp}</td><td>${s.avg.toFixed(2)}R</td><td>${s.dd.toFixed(1)}R</td></tr>`:`<tr><td>${l}</td><td>0</td><td colspan="4">no trades</td></tr>`;

function run(){
  $('err').textContent='';$('out').innerHTML='';
  try{
    const m15=parse($('m15').value,'M15'),m5=parse($('m5').value,'M5'),m1=parse($('m1').value,'M1');
    let spread=null,bid=null,ask=null;
    const bt=$('bk').value.trim();
    if(bt){try{const j=JSON.parse(bt);bid=+j.bidPrice;ask=+j.askPrice;if(!(ask>=bid))throw 0;spread=ask-bid}catch(e){throw new Error('Book ticker: expected Binance bookTicker JSON with bidPrice and askPrice.')}}
    render(m15,m5,m1,spread,bid,ask);
  }catch(e){$('err').textContent=e.message}
}

function render(m15,m5,m1,spread,bid,ask){
  const miss=[];
  if(!m15)miss.push('M15 candles');if(!m5)miss.push('M5 candles');if(!m1)miss.push('M1 candles');if(spread===null)miss.push('bid/ask (spread)');
  let h='';
  const px=(m1||m5||m15||[{c:null}]).slice(-1)[0].c;
  /* M15 */
  let ctx=[],sup=[],res=[],trend='unknown',a15=0;
  if(m15){
    const n=m15.length-1;a15=atr(m15,n);
    const sw=swings(m15,n,2,300),H=sw.filter(s=>s.t=='H').slice(-2),Lw=sw.filter(s=>s.t=='L').slice(-2);
    if(H.length==2&&Lw.length==2){
      if(H[1].p>H[0].p&&Lw[1].p>Lw[0].p)trend='up';else if(H[1].p<H[0].p&&Lw[1].p<Lw[0].p)trend='down';else trend='range';
      ctx.push('Structure: '+({up:'higher highs and higher lows (uptrend)',down:'lower highs and lower lows (downtrend)',range:'mixed swings (range or transition)'})[trend]+'. Last swing highs '+H.map(s=>f(s.p)).join(' → ')+'; lows '+Lw.map(s=>f(s.p)).join(' → ')+'.');
    }else ctx.push('Too few confirmed swings to classify structure.');
    const r=m15.slice(-96),rh=Math.max(...r.map(q=>q.h)),rl=Math.min(...r.map(q=>q.l));
    ctx.push('Recent range ('+r.length+' candles): '+f(rl)+' to '+f(rh)+'. Last close '+f(m15[n].c)+'.');
    const a50=atr(m15,n,50);ctx.push('Volatility: ATR(14) '+f(a15)+' ('+(a15/m15[n].c*100).toFixed(2)+'% of price), '+(a50?(a15/a50).toFixed(2):'n/a')+'× ATR(50) so volatility is '+(a15>a50*1.15?'expanding':a15<a50*.85?'contracting':'steady')+'.');
    const lv=levels(m15,a15),last=m15[n].c;
    sup=lv.filter(l=>l.p<last).sort((x,y)=>y.p-x.p).slice(0,3);res=lv.filter(l=>l.p>last).sort((x,y)=>x.p-y.p).slice(0,3);
  }
  /* M5 */
  let d5=null,m5obs=[],stop=null,a5=0;
  if(m5){
    const n=m5.length-1;a5=atr(m5,n);
    for(let i=Math.max(25,n-2);i<=n;i++){const d=detect(m5,i);if(!d)continue;if(d.dir){d5=d;d5.at=i}[...d.bu,...d.be].forEach(s=>{const t=hm(m5[i].t)+' '+s;if(!m5obs.includes(t))m5obs.push(t)})}
    if(d5)stop=d5.stop;
  }
  /* M1 */
  let m1obs=[],m1ok=false,m1inv=false;
  if(m1){
    const n=m1.length-1,a1=atr(m1,n),net=m1[n].c-m1[n-5].c,q=m1[n];
    m1obs.push('Last 5 candles net move '+(net>=0?'+':'')+f(net)+' ('+(net/a1).toFixed(1)+'× ATR(14)).');
    m1obs.push('Last candle: '+(q.c>q.o?'bullish':q.c<q.o?'bearish':'flat')+', range '+f(q.h-q.l)+'. Last close '+f(q.c)+'.');
    const allL=[...sup,...res].map(l=>l.p),nl=allL.sort((x,y)=>Math.abs(x-q.c)-Math.abs(y-q.c))[0];
    if(nl!==undefined&&Math.abs(nl-q.c)<=Math.max(.5*a5,a1)){const uw=q.h-Math.max(q.o,q.c),lw=Math.min(q.o,q.c)-q.l;m1obs.push('Price is within '+f(Math.abs(nl-q.c))+' of M15 level '+f(nl)+(lw>uw*2?'; lower wick rejection.':uw>lw*2?'; upper wick rejection.':'; no clear rejection.'))}
    else m1obs.push('Price is not near a mapped M15 level.');
    if(d5){const L=d5.dir=='long';m1ok=L?(q.c>q.o&&net>0):(q.c<q.o&&net<0);m1inv=L?q.c<stop:q.c>stop;
      m1obs.push('Against the M5 '+d5.dir+' idea: '+(m1inv?'invalidated, price is beyond the stop reference.':m1ok?'confirmed by candle and short-term momentum.':'not confirmed yet.'))}
    else m1obs.push('No M5 setup to confirm.');
  }
  /* verdict */
  let vc='w',vt='WAIT — NO CONFIRMED SETUP',why=[];
  if(miss.length)why.push('Missing: '+miss.join(', ')+'. Nothing was assumed in place of it.');
  const spreadBad=spread!==null&&a5>0&&spread>.25*a5;
  if(spreadBad)why.push('Spread '+f(spread)+' is more than 25% of M5 ATR ('+f(a5)+'), too costly to trade around.');
  if(m5&&!d5)why.push('M5 shows no setup with a structure event plus at least three confirmations.');
  if(d5&&m1&&!m1ok)why.push('M1 has not confirmed the M5 '+d5.dir+' idea.');
  if(d5&&m1inv)why.push('The M5 setup is invalidated on M1.');
  if(d5&&m15&&((d5.dir=='long'&&trend=='down')||(d5.dir=='short'&&trend=='up')))why.push('Timeframe conflict: M5 points '+d5.dir+' while M15 structure is a '+trend+'trend.');
  if(!why.length&&d5&&m1ok&&!miss.length){vc=d5.dir=='long'?'up':'dn';vt='PAPER CANDIDATE — '+d5.dir.toUpperCase()+' (hypothetical, educational)'}
  h+=`<div class="verdict ${vc}">${vt}</div>`+(vc=='w'?li(why):'<p class="sub">M5 setup, M1 confirmation, M15 context and spread all agree. This is a paper observation, not advice.</p>');
  /* 9 points */
  const S=(t,b)=>`<div class="sec"><h2>${t}</h2>${b}</div>`;
  h+=S('1. Instrument','<p>BTCUSD (BTC/USDT on Binance for M5 and M1'+(m15?'; M15 from the feed you pasted':'')+'). Prices can differ slightly between feeds.</p>');
  h+=S('2. M15 market context',m15?li(ctx):'<p class="sub">Not assessed: no M15 data.</p>');
  h+=S('3. M5 setup observations',m5?li(m5obs.concat(['Last M5 candle is treated as closed; it may still be forming.'])):'<p class="sub">Not assessed: no M5 data.</p>');
  h+=S('4. M1 observations',m1?li(m1obs):'<p class="sub">Not assessed: no M1 data.</p>');
  h+=S('5. Support and resistance',m15?`<p><b>Support</b></p>${li(sup.map(l=>f(l.p)+' ('+l.n+' swing'+(l.n>1?'s':'')+')'))}<p><b>Resistance</b></p>${li(res.map(l=>f(l.p)+' ('+l.n+' swing'+(l.n>1?'s':'')+')'))}<p class="tag">Derived from M15 swing points; levels within 0.35× ATR are merged.${spread!==null?' Bid '+f(bid)+', ask '+f(ask)+', spread '+f(spread)+'.':' Spread not supplied.'}</p>`:'<p class="sub">Needs M15 data.</p>');
  const up=[],dn=[];
  if(d5){d5.bu.forEach(s=>up.push('M5: '+s));d5.be.forEach(s=>dn.push('M5: '+s))}
  if(trend=='up')up.push('M15 structure is an uptrend.');if(trend=='down')dn.push('M15 structure is a downtrend.');
  if(sup[0]&&px&&px-sup[0].p<=a15*.5)up.push('Price is close to M15 support '+f(sup[0].p)+'.');
  if(res[0]&&px&&res[0].p-px<=a15*.5)dn.push('Price is close to M15 resistance '+f(res[0].p)+'.');
  if(m1&&m1ok&&d5)(d5.dir=='long'?up:dn).push('M1 candle and momentum confirm the M5 idea.');
  h+=S('6. Evidence for upward movement',li(up));
  h+=S('7. Evidence for downward movement',li(dn));
  const inv=[];
  if(sup[0])inv.push('Upward scenario fails on an M15 close below '+f(sup[0].p)+(d5&&d5.dir=='long'?', or an M1 close below the setup stop reference '+f(stop):'')+'.');
  if(res[0])inv.push('Downward scenario fails on an M15 close above '+f(res[0].p)+(d5&&d5.dir=='short'?', or an M1 close above the setup stop reference '+f(stop):'')+'.');
  if(!inv.length)inv.push('Cannot name levels without M15 data.');
  h+=S('8. Invalidation',li(inv));
  /* backtest */
  let bh='';
  if(m5&&m5.length>=100){
    const r=backtest(m5,spread||0),all=stats(r.tr),k=Math.floor(r.tr.length*.6),IS=stats(r.tr.slice(0,k)),OOS=stats(r.tr.slice(k));
    bh+='<div class="tbl"><table><tr><th>Sample</th><th>Trades</th><th>Hit rate</th><th>False pos.</th><th>Avg R</th><th>Max DD</th></tr>'+row('First 60% (in-sample)',IS)+row('Last 40% (out-of-sample)',OOS)+row('All',all);
    ['Trending','Ranging','High volatility','Low volatility'].forEach(g=>{bh+=row(g,stats(r.tr.filter(x=>x.reg==g||x.vol==g)))});
    bh+='</table></div>';
    bh+=`<p class="tag">Rules are fixed, not tuned, so the split checks consistency over time. Entry at next M5 open ± half spread, stop beyond the last 3 candles, target 1.5R, 30-candle limit, stop assumed first if both are hit in one candle. Hit rate = target reached. False positives = signals that did not reach the target. Avg R is the simulated reward-to-risk outcome per trade (unrealised trades closed at the 30th candle).</p>`;
    bh+=`<p class="tag">False negatives: of ${r.chk} sampled candles with no signal nearby, ${r.miss} were followed by a 2×ATR move before a 1×ATR adverse move in some direction. Only a rough proxy, since the signal rules look for specific structure rather than any big move.</p>`;
    const ok=OOS.n>=30;
    h+=S('9. Confidence assessment',ok?`<p>Measured out-of-sample on ${OOS.n} simulated trades from the M5 history you pasted: hit rate ${(OOS.wr*100).toFixed(0)}%, average ${OOS.avg.toFixed(2)}R, max drawdown ${OOS.dd.toFixed(1)}R. This covers one short window of one market, so treat it as indicative only.</p>`:`<p><b>Not assessable.</b> The out-of-sample window has ${OOS.n} trades; at least 30 are needed before any rate means much. No accuracy percentage is claimed. Paste a longer M5 history (up to 1000 candles) for a larger sample.</p>`);
    h+=S('Historical performance (simulated)',bh);
  }else h+=S('9. Confidence assessment','<p><b>Not assessable.</b> A backtest needs at least 100 M5 candles. No accuracy percentage is claimed.</p>');
  $('out').innerHTML=h;
  $('out').scrollIntoView({behavior:'smooth'});
}
$('go').onclick=run;
$('clr').onclick=()=>{['m15','m5','m1','bk'].forEach(i=>$(i).value='');$('out').innerHTML='';$('err').textContent=''};

/* Live fetch: works on GitHub Pages or any normal site (CORS-enabled public endpoints) */
const BIN=['https://api.binance.com','https://data-api.binance.vision','https://api.binance.us'];
async function jget(path){let last;for(const base of BIN){try{const r=await fetch(base+path);if(r.ok)return await r.json();last=new Error('HTTP '+r.status)}catch(e){last=e}}throw last||new Error('request failed')}
const closed=k=>k.filter(x=>x[6]<Date.now());
async function live(){
  const st=$('fst');st.textContent=' Fetching…';$('err').textContent='';
  try{
    const [k5,k1,bk,k15]=await Promise.all([
      jget('/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1000'),
      jget('/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120'),
      jget('/api/v3/ticker/bookTicker?symbol=BTCUSDT'),
      jget('/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=200')]);
    let m15=closed(k15),note=' Binance 15m used for M15.';
    const key=$('tdkey').value.trim();
    if(key){
      try{
        const r=await fetch('https://api.twelvedata.com/time_series?symbol=BTC/USD&interval=15min&outputsize=200&apikey='+encodeURIComponent(key));
        const j=await r.json();if(j.status==='error'||!j.values)throw new Error(j.message||'no data');
        m15=j;note=' Twelve Data used for M15 (its newest candle may still be forming).';
      }catch(e){note=' Twelve Data failed ('+e.message+'); Binance 15m used for M15.'}
    }
    $('m15').value=JSON.stringify(m15);$('m5').value=JSON.stringify(closed(k5));
    $('m1').value=JSON.stringify(closed(k1));$('bk').value=JSON.stringify(bk);
    st.textContent=' Loaded at '+new Date().toISOString().slice(11,19)+'Z.'+note;
    run();
  }catch(e){st.textContent='';$('err').textContent='Live fetch failed: '+e.message+'. Your network or region may block the data source. Paste the data manually instead.'}
}
$('live').onclick=live;
