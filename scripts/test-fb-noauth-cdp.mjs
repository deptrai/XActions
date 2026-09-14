import { FacebookCrawler } from '../src/scrapers/social/facebook/crawler.js';
const crawler = new FacebookCrawler({ requiresProxy:false, cdpUrl:'http://127.0.0.1:9333' });
const t=setTimeout(()=>{console.log('HARDTIMEOUT');process.exit(2)},200000);
const tests=[
 ['profile',{action:'profile',args:{username:'zuck'}}],
 ['page_posts',{action:'page_posts',args:{pageId:'zuck',count:5}}],
 ['post_comments',{action:'post_comments',args:{url:'https://www.facebook.com/permalink.php?story_fbid=10117314656226921&id=4',maxComments:8,includeReplies:true}}],
 ['get_comments',{action:'get_comments',args:{postId:'10117314656226921',maxComments:8}}],
 ['group_posts',{action:'group_posts',args:{groupId:'opensource',count:5}}],
 ['group_members',{action:'group_members',args:{groupUrl:'https://www.facebook.com/groups/opensource',limit:8}}],
 ['group_search',{action:'group_search',args:{groupUrl:'https://www.facebook.com/groups/opensource',query:'linux',limit:5}}],
 ['search',{action:'search',args:{query:'technology',type:'pages',limit:5}}],
 ['marketplace',{action:'marketplace',args:{query:'macbook',location:'Ho Chi Minh City',limit:5}}],
 ['followers',{action:'followers',args:{username:'zuck',limit:8}}],
 ['following',{action:'following',args:{username:'zuck'}}],
];
const out=[];
for(const [label,req] of tests){
  process.stdout.write(`\n▶ ${label} ... `);
  const t0=Date.now();
  try{const r=await crawler.start(req);
    const n=(r.comments||r.posts||r.pages||r.members||r.followers||r.following||r.results||[]).length;
    const ms=Date.now()-t0;
    console.log(`\n✅ ${label} (${ms}ms): count=${n} note=${(r.note||'').slice(0,110)}`);
    if(r.profile){const p=r.profile;console.log(`   profile: name=${p.name} followers=${p.followersCount} bio=${(p.bio||'').slice(0,70)}`);}
    const f=(r.comments||r.posts||r.pages||r.members||r.followers||[])[0]; if(f)console.log('   first:',JSON.stringify(f).slice(0,180));
    out.push({label,s:'PASS',n,ms});
  }catch(e){const ms=Date.now()-t0;console.log(`\n❌ ${label} (${ms}ms): ${e.message} [${e.code||'-'}/${e.type||'-'}]`);out.push({label,s:'FAIL',e:e.message});}
}
console.log('\n===== CDP REAL-CHROME SUMMARY =====');
const p=out.filter(x=>x.s==='PASS').length;
out.forEach(x=>console.log(`${x.s==='PASS'?'✅':'❌'} ${x.label.padEnd(15)} ${x.n!==undefined?'count='+x.n:(x.e||'').slice(0,70)}`));
console.log(`${p}/${out.length} PASSED (real-Chrome CDP, residential IP)`);
clearTimeout(t);await crawler.cleanup().catch(()=>{});process.exit(0);
