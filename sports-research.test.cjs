const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizeGame,createResearch}=require('./sports-research.cjs');
function fixture(){return {id:'match',sport_key:'americanfootball_nfl',home_team:'Home',away_team:'Away',commence_time:new Date(Date.now()+3600000).toISOString(),bookmakers:[{key:'book',title:'Book',last_update:new Date().toISOString(),markets:[{key:'h2h',outcomes:[{name:'Home',price:1.8},{name:'Away',price:2.1}]}]}]};}
test('no-vig market baseline sums to one; stale and in-play quotes are excluded',()=>{
 const game=fixture(),n=normalizeGame(game);assert.equal(n.books.length,1);assert.ok(Math.abs(n.consensus.reduce((a,b)=>a+b.probability,0)-1)<1e-10);
 game.bookmakers[0].last_update=new Date(Date.now()-16*60000).toISOString();assert.equal(normalizeGame(game).books.length,0);
 game.commence_time=new Date(Date.now()-1).toISOString();assert.equal(normalizeGame(game),null);
 const draw=fixture();draw.bookmakers[0].markets[0].outcomes.push({name:'Draw',price:3});assert.equal(normalizeGame(draw).consensus.length,3);
});
test('research coalesces requests, uses sourced evidence and never passes server credentials into prompt',async()=>{
 let odds=0,ai=0;const service=createResearch({ODDS_API_KEY:'odds-secret',ANTHROPIC_API_KEY:'ai-secret',KALSHI_PRIVATE_KEY:'kalshi-secret'},async(url,options)=>{
 if(String(url).includes('the-odds-api')){odds++;return Response.json([fixture()]);}
 ai++;const body=JSON.parse(options.body);assert.equal(body.tools[0].name,'web_search');assert.ok(!options.body.includes('secret'));assert.match(body.messages[0].content,/unverifiedUserContext/);
 return Response.json({stop_reason:'end_turn',content:[{type:'text',text:'Tentative lean with evidence.',citations:[{type:'web_search_result_location',title:'Official report',url:'https://example.com/report'},{type:'web_search_result_location',title:'bad',url:'javascript:bad'}]}]});
 });
 const reports=await Promise.all([service.briefing('americanfootball_nfl','match','Travel?'),service.briefing('americanfootball_nfl','match','Travel?')]);assert.equal(odds,1);assert.equal(ai,1);assert.equal(reports[0].blocks[0].citations.length,1);
 await assert.rejects(service.games('untrusted-host'),/supported/);
});
test('uncited or incomplete AI output cannot become a verdict',async()=>{
 for(const result of [{stop_reason:'end_turn',content:[{type:'text',text:'A lock.'}]},{stop_reason:'max_tokens',content:[{type:'text',text:'Partial',citations:[{type:'web_search_result_location',url:'https://example.com'}]}]}]){
 const s=createResearch({ODDS_API_KEY:'x',ANTHROPIC_API_KEY:'y'},async url=>Response.json(String(url).includes('the-odds-api')?[fixture()]:result));await assert.rejects(s.briefing('americanfootball_nfl','match'));
 }
});
test('sandbox CLV rejects legacy and post-kickoff data and requires the original book and point',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('./index.html'),'utf8');
 const code=source.slice(source.indexOf('function validClosingProxy('),source.indexOf('// CLV in cents:'));
 const leg={sportKey:'nfl',gameId:'g',book:'Original',market:'spreads',outcome:'Home',point:-3,start:new Date(Date.now()+5*60000).toISOString()};
 const context={state:{profiles:{a:{bets:[{status:'pending',legs:[leg]}]}}},persistProfiles(){},Date};vm.createContext(context);vm.runInContext(code,context);
 const game={id:'g',bookmakers:[{title:'Other',last_update:new Date().toISOString(),markets:[{key:'spreads',outcomes:[{name:'Home',point:-3,price:-110}]}]}]};
 context.snapshotClosingLines('nfl',[game]);assert.equal(leg.closingLine,undefined);
 game.bookmakers[0].title='Original';game.bookmakers[0].markets[0].outcomes[0].point=-4;context.snapshotClosingLines('nfl',[game]);assert.equal(leg.closingLine,undefined);
 game.bookmakers[0].markets[0].outcomes[0].point=-3;context.snapshotClosingLines('nfl',[game]);assert.equal(leg.closingLine,-110);assert.equal(context.validClosingProxy(leg),false);
 leg.start=new Date(Date.now()-1000).toISOString();leg.closingLineAt=new Date(Date.now()-2000).toISOString();assert.equal(context.validClosingProxy(leg),true);
 delete leg.closingSource;assert.equal(context.validClosingProxy(leg),false);delete leg.closingLine;context.snapshotClosingLines('nfl',[game]);assert.equal(leg.closingLine,undefined);
});
