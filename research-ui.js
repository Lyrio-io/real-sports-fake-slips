'use strict';
const $=id=>document.getElementById(id), pct=x=>x==null?'Unavailable':(x*100).toFixed(1)+'%', when=x=>new Date(x).toLocaleString();
let games=[],busy=false,journal=[];
try{journal=JSON.parse(localStorage.getItem('rsfs-paper-clv-v1')||'[]');if(!Array.isArray(journal))journal=[];journal=journal.filter(p=>p&&typeof p.match==='string'&&typeof p.selection==='string'&&Number.isFinite(p.decimal)&&p.decimal>1&&Number.isFinite(Date.parse(p.start))&&Number.isFinite(Date.parse(p.at))&&(!p.reference||(Number.isFinite(p.reference.decimal)&&p.reference.decimal>1)));}catch{}
function el(tag,text,parent){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;}
function selected(){return games.find(g=>g.id===$('game').value);}
async function api(path,options){const r=await fetch(path,{cache:'no-store',...options});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed.');return data;}
function persist(){try{localStorage.setItem('rsfs-paper-clv-v1',JSON.stringify(journal));}catch{$('journal-status').textContent='Browser storage unavailable. These picks will not survive closing this page.';}}
function renderJournal(){
 $('journal').replaceChildren();if(!journal.length)el('p','No paper picks yet.',$('journal'));
 for(const p of journal){const d=el('div',null,$('journal'));d.className='entry';el('strong',p.match+' · '+p.selection,d);el('p',p.bookName+' · Entry '+p.decimal.toFixed(3)+' · '+when(p.at),d);
 const start=Date.parse(p.start), ref=p.reference, valid=ref&&Date.parse(ref.at)<start&&Date.parse(ref.at)>=start-600000&&Date.parse(ref.at)>=Date.parse(p.at);
 el('p',Date.now()<start?'Awaiting kickoff; latest same-book quote: '+(ref?ref.decimal.toFixed(3)+' at '+when(ref.at):'none'):valid?'CLV proxy: '+pct(p.decimal/ref.decimal-1)+' · Reference '+ref.decimal.toFixed(3)+' at '+when(ref.at):'CLV unavailable: no same-book snapshot within 10 minutes before kickoff.',d);
 const remove=el('button','Remove',d);remove.onclick=()=>{journal=journal.filter(x=>x!==p);persist();renderJournal();};
 }
}
function renderGame(){
 $('report').replaceChildren();$('report-status').textContent='';$('market').replaceChildren();$('pick').replaceChildren();const g=selected();$('research').disabled=!g||!g.books.length||busy;$('save').disabled=!g||!g.books.length;
 if(!g)return;el('p',when(g.start)+' · '+g.books.length+' fresh books',$('market'));el('h2','Market baseline',$('market'));
 for(const o of g.consensus)el('p',o.name+': '+pct(o.probability)+' fair market probability ('+o.books+' books)',$('market'));
 el('p','Bookmaker margin removed within each book, then averaged. This is the market’s estimate, not an independent prediction. Moneylines only.',$('market')).className='note';
 for(const b of g.books)for(const o of b.outcomes){const option=el('option',b.name+' · '+o.name+' · '+o.decimal.toFixed(3)+' · '+when(b.updatedAt),$('pick'));option.value=JSON.stringify([b.key,o.name]);}
}
async function refresh(){
 $('refresh').disabled=true;$('status').textContent='Loading current prices…';
 try{const current=$('game').value,data=await api('/api/research/games?sport='+encodeURIComponent($('sport').value));games=data.games.filter(g=>Date.parse(g.start)>Date.now());$('game').replaceChildren();for(const g of games){const o=el('option',g.away+' at '+g.home,$('game'));o.value=g.id;}if(games.some(g=>g.id===current))$('game').value=current;
 for(const p of journal){const g=games.find(g=>g.id===p.gameId),b=g?.books.find(b=>b.key===p.book),o=b?.outcomes.find(o=>o.name===p.selection);if(o&&Date.parse(b.updatedAt)>=Date.parse(p.at)&&Date.parse(b.updatedAt)<Date.parse(p.start)&&Date.now()<Date.parse(p.start))p.reference={decimal:o.decimal,at:b.updatedAt};}
 persist();renderGame();renderJournal();$('status').textContent=games.length?'Prices retrieved '+when(data.asOf)+'. Quotes older than 15 minutes are excluded.':'No upcoming games available in this league.';
 }catch(e){games=[];renderGame();$('status').textContent=e.message;}finally{$('refresh').disabled=false;}
}
$('refresh').onclick=refresh;$('sport').onchange=refresh;$('game').onchange=renderGame;
$('research').onclick=async()=>{const g=selected();if(!g)return;busy=true;$('research').disabled=true;$('report').replaceChildren();$('report-status').textContent='Checking current reporting and matchup evidence…';const note=$('note').value;
 try{const r=await api('/api/research/briefing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sport:$('sport').value,id:g.id,note})});if(selected()?.id!==g.id)return;$('report-status').textContent='Research as of '+when(r.asOf)+'. Tentative analysis; verify late lineup changes.';for(const block of r.blocks){el('p',block.text,$('report'));for(const c of block.citations){const a=el('a',c.title||c.url,$('report'));a.href=c.url;a.target='_blank';a.rel='noopener noreferrer';}}}catch(e){$('report-status').textContent=e.message;}finally{busy=false;$('research').disabled=!selected()?.books.length;}};
$('save').onclick=()=>{const g=selected();if(!g||Date.parse(g.start)<=Date.now())return;const [book,name]=JSON.parse($('pick').value),b=g.books.find(b=>b.key===book),o=b.outcomes.find(o=>o.name===name);if(Date.now()-Date.parse(b.updatedAt)>15*60000){$('journal-status').textContent='Refresh prices before saving this pick.';return;}journal.push({gameId:g.id,match:g.away+' at '+g.home,start:g.start,selection:name,book,bookName:b.name,decimal:o.decimal,at:new Date().toISOString(),quoteAt:b.updatedAt});persist();renderJournal();$('journal-status').textContent='Paper pick saved. No bet was placed.';};
renderJournal();refresh();setInterval(renderJournal,30000);
