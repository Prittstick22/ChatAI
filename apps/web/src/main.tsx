import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const API = 'http://localhost:8000';
type Message = {id:number; user:string; text:string; room:string; created_at:string};
type Poll = {id:number;question:string;options:string[]};
function App(){
  const [user,setUser]=useState('Alex');
  const [messages,setMessages]=useState<Message[]>([]);
  const [text,setText]=useState('');
  const [tab,setTab]=useState<'catchup'|'search'|'events'>('catchup');
  const [digest,setDigest]=useState('');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<Message[]>([]);
  const [suggestion,setSuggestion]=useState('');
  const [polls,setPolls]=useState<Poll[]>([]);
  const [error,setError]=useState('');
  const end=useRef<HTMLDivElement>(null);
  const refresh=()=>fetch(API+'/messages').then(r=>r.json()).then(setMessages).catch(()=>setError('Chat service offline'));
  const refreshPolls=()=>fetch(API+'/polls').then(r=>r.json()).then(setPolls).catch(()=>{});
  useEffect(()=>{
    refresh();refreshPolls();
    let sock:WebSocket|null=null;let retry:number|undefined;let closed=false;
    function connect(){
      sock=new WebSocket(API.replace(/^http/,'ws')+'/ws');
      sock.onmessage=e=>{const msg=JSON.parse(e.data); if(msg.type==='message')setMessages(old=>old.some(m=>m.id===msg.message.id)?old:[...old,msg.message]);};
      sock.onclose=()=>{if(!closed)retry=window.setTimeout(connect,1600)};
    }
    connect();
    return()=>{closed=true;clearTimeout(retry);sock?.close()};
  },[]);
  useEffect(()=>end.current?.scrollIntoView({behavior:'smooth'}),[messages]);
  async function send(e:React.FormEvent){e.preventDefault();if(!text.trim())return;const value=text;setText('');try{const r=await fetch(API+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,text:value})});if(!r.ok)throw Error();const m=await r.json();setMessages(old=>old.some(x=>x.id===m.id)?old:[...old,m]);setError('')}catch{setError('Failed to send');setText(value)}}
  const loadDigest=async()=>{try{setDigest('Summarising...');const r=await fetch(API+'/digest');setDigest((await r.json()).summary)}catch{setDigest('Summary unavailable')}};
  const search=async(e:React.FormEvent)=>{e.preventDefault();try{const r=await fetch(API+'/search?query='+encodeURIComponent(query));setResults((await r.json()).results)}catch{setError('Search unavailable')}};
  const suggest=async()=>{const r=await fetch(API+'/suggest');setSuggestion((await r.json()).suggestion)};
  const createPoll=async()=>{const question=window.prompt('Poll question?');if(!question)return;const opts=window.prompt('Options, separated by commas')?.split(',').map(s=>s.trim()).filter(Boolean);if(!opts||opts.length<2)return;await fetch(API+'/polls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,options:opts})});refreshPolls()};
  const vote=async(id:number,option_index:number)=>{await fetch(API+'/polls/'+id+'/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,option_index})});alert('Vote saved')};
  return <div className="layout"><aside><div className="logo">✦ ChatAI</div><p>The group chat that organises itself.</p><h4>DEMO ROOM</h4><div className="room"># Hackathon team</div><h4>YOUR IDENTITY</h4><select value={user} onChange={e=>setUser(e.target.value)}>{['Alex','Sam','Jordan','Taylor'].map(u=><option key={u}>{u}</option>)}</select><p className="fine">Demo identities are not authenticated.</p></aside><main><header><strong># Hackathon team</strong><span>Real-time conversation</span></header><section className="messages">{messages.map(m=><div className={'message '+(m.user===user?'mine':'')} key={m.id}><b>{m.user}</b><p>{m.text}</p><small>{new Date(m.created_at).toLocaleTimeString()}</small></div>)}<div ref={end}/></section>{error&&<div className="error">{error}</div>}<form className="composer" onSubmit={send}><input value={text} onChange={e=>setText(e.target.value)} placeholder="Message your team..."/><button>Send →</button></form></main><section className="intelligence"><h2>✦ Invisible AI</h2><nav>{(['catchup','search','events'] as const).map(t=><button className={tab===t?'active':''} onClick={()=>setTab(t)} key={t}>{t==='catchup'?'Catch up':t==='search'?'Search':'Actions'}</button>)}</nav>{tab==='catchup'&&<div><h3>Missed something?</h3><p>Turn a long conversation into a quick brief.</p><button onClick={loadDigest}>Summarise conversation</button><div className="result">{digest||'Your group digest appears here.'}</div></div>}{tab==='search'&&<div><h3>Search by meaning</h3><form onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="What time are we meeting?"/><button>Search</button></form>{results.map(m=><div className="hit" key={m.id}><b>{m.user}</b><p>{m.text}</p></div>)}</div>}{tab==='events'&&<div><h3>Proactive suggestions</h3><button onClick={suggest}>Detect next action</button><div className="result">{suggestion||'Suggested actions appear here.'}</div><a href={API+'/calendar.ics?title=Team%20meeting&date=20261010T120000Z'}>Download example calendar invite</a><h3>Group polls</h3><button onClick={createPoll}>Create poll</button>{polls.map(p=><div className="hit" key={p.id}><b>{p.question}</b>{p.options.map((o,i)=><button key={i} onClick={()=>vote(p.id,i)}>{o}</button>)}</div>)}</div>}</section></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
