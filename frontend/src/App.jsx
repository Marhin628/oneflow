import React, { useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

const API = '/api/assignments';
const ALL = 'All courses';
// Color coding: tests red, homework yellow, other assignments green, schedule (events) blue.
const categories = {
  test:     {label:'Tests',    color:'#e5484d', text:'#ffffff'},
  homework: {label:'Homework', color:'#f5c542', text:'#4a3800'},
  other:    {label:'Other',    color:'#3fae6a', text:'#ffffff'},
  schedule: {label:'Schedule', color:'#4a7fe0', text:'#ffffff'},
};
const kindTypes = {
  assignment: [['assignment','Homework'],['project','Project'],['exam','Exam'],['quiz','Quiz'],['other','Other']],
  event:      [['class','Class'],['club','Club meeting'],['study','Study session'],['meeting','Meeting'],['other','Other']],
};
const empty = { kind:'assignment', title:'', course:'', due_date:'', end_date:'', type:'assignment', completed:false };

function categoryOf(a) {
  if (a.kind==='event') return 'schedule';
  if (['exam','quiz','test'].includes(a.type)) return 'test';
  if (['assignment','homework','project'].includes(a.type)) return 'homework';
  return 'other';
}
const typeLabel = a => (kindTypes[a.kind]||kindTypes.assignment).find(([v])=>v===a.type)?.[1] || a.type;

// The API stores naive local times ("2026-10-31T15:00:00"), so dates are never converted to UTC.
const pad = n => String(n).padStart(2,'0');
function toLocalIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
function toInputDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0,16) : toLocalIso(d).slice(0,16);
}
const addHour = input => toLocalIso(new Date(new Date(input).getTime()+3600000)).slice(0,16);
const withSeconds = v => v.length===16 ? `${v}:00` : v;
function formatDue(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
  const time = d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})}, ${time}`;
}
function errorText(data, status) {
  const msg = data?.message;
  if (typeof msg === 'string') return msg;
  if (msg && typeof msg === 'object') return Object.entries(msg).map(([k,v])=>`${k}: ${v}`).join('; ');
  return `Request failed (${status})`;
}
// Called when any request comes back 401 (signed out or session expired); App points it at its sign-out handler.
let onUnauthorized = () => {};
async function request(url, options={}) {
  let response;
  try { response = await fetch(url, {headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...options}); }
  catch { throw new Error('Cannot reach the OneFlow server. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (response.status===401 && url!=='/api/auth/google') onUnauthorized();
  if (!response.ok) throw new Error(errorText(data, response.status));
  return data;
}
const api = (path='', options={}) => request(API+path, options);

// Loads Google's sign-in script once (https://developers.google.com/identity/gsi/web).
let googleScript;
function loadGoogle() {
  googleScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in did not load'));
    s.onerror = () => { googleScript = null; reject(new Error('Google sign-in did not load')); };
    document.head.appendChild(s);
  });
  return googleScript;
}

function SignIn({ onSignedIn }) {
  const [config,setConfig] = useState(null);
  const [error,setError] = useState('');
  const button = useRef(null);
  useEffect(()=>{ request('/api/config').then(setConfig).catch(e=>setError(e.message)); },[]);
  useEffect(()=>{
    if (!config?.google_client_id) return;
    let cancelled = false;
    loadGoogle().then(google=>{
      if (cancelled || !button.current) return;
      google.accounts.id.initialize({ client_id:config.google_client_id, callback: async ({credential})=>{
        setError('');
        try { onSignedIn(await request('/api/auth/google',{method:'POST',body:JSON.stringify({credential})})); }
        catch(e) { setError(e.message); }
      }});
      google.accounts.id.renderButton(button.current, { theme:'outline', size:'large', shape:'pill', text:'continue_with', width:280 });
    }).catch(()=>setError('Could not load Google sign-in. Check your connection and refresh the page.'));
    return ()=>{ cancelled = true; };
  },[config]);
  return <div className="signin">
    <div className="signin-card">
      <div className="brand"><span className="brandmark">◈</span> OneFlow</div>
      <p>Your assignments, exams and schedule in one calendar.</p>
      {config&&!config.google_client_id&&<div className="error">Google sign-in isn't set up on this server yet (GOOGLE_CLIENT_ID is missing).</div>}
      <div ref={button} className="gbutton"/>
      {error&&<div className="error">{error}</div>}
      <small>Your calendar is private to your Google account.</small>
    </div>
  </div>;
}

export default function App() {
  // undefined while checking the session, null when signed out
  const [user,setUser] = useState(undefined);
  useEffect(()=>{
    onUnauthorized = () => setUser(null);
    request('/api/me').then(setUser).catch(()=>setUser(null));
  },[]);
  const signOut = async () => {
    try { await request('/api/auth/logout',{method:'POST'}); } catch { /* signed out locally either way */ }
    window.google?.accounts?.id?.disableAutoSelect();
    setUser(null);
  };
  if (user===undefined) return <div className="signin"><div className="loading">Loading…</div></div>;
  if (user===null) return <SignIn onSignedIn={setUser}/>;
  // keyed by user so switching accounts starts from a clean state
  return <Calendar key={user.id} user={user} onSignOut={signOut}/>;
}

function Calendar({ user, onSignOut }) {
  const [items,setItems] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [modal,setModal] = useState(false);
  const [editing,setEditing] = useState(null);
  const [form,setForm] = useState(empty);
  const [filter,setFilter] = useState(ALL);
  const [saving,setSaving] = useState(false);

  const load = async () => { setError(''); try { const data = await api(); setItems(Array.isArray(data)?data:[]); } catch(e) {setError(e.message);} finally {setLoading(false);} };
  useEffect(()=>{load();},[]);

  const courses = [...new Set(items.map(a=>a.course).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  // Fall back to all courses when the filtered course no longer has any items.
  useEffect(()=>{ if (filter!==ALL && !courses.includes(filter)) setFilter(ALL); },[courses.join('|')]);

  const shown = items.filter(a=>filter===ALL||a.course===filter);
  const tasks = shown.filter(a=>a.kind!=='event');
  const now = new Date();
  const upcoming = tasks.filter(a=>!a.completed&&new Date(a.due_date)>=now).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
  const overdue = tasks.filter(a=>!a.completed&&new Date(a.due_date)<now);
  const events = shown.map(a=>{
    const cat = categories[categoryOf(a)];
    const isEvent = a.kind==='event';
    return {
      id:String(a.id), title:`${a.completed?'✓ ':''}${a.title}`, start:a.due_date, end:isEvent?a.end_date:undefined, allDay:false,
      backgroundColor:cat.color, borderColor:cat.color, textColor:cat.text, durationEditable:isEvent,
      classNames:[isEvent?'block':'deadline', ...(a.completed?['done']:[])], extendedProps:{assignment:a},
    };
  });

  const openNew = (kind='assignment', start='', end='') => {
    setEditing(null);
    setForm({...empty, kind, type:kindTypes[kind][0][0], course:filter===ALL?'':filter, due_date:start, end_date:end||(kind==='event'&&start?addHour(start):'')});
    setModal(true);setError('');
  };
  const openEdit = a => {
    const kind = a.kind==='event'?'event':'assignment';
    setEditing(a.id);
    setForm({kind,title:a.title||'',course:a.course||'',due_date:toInputDate(a.due_date),end_date:toInputDate(a.end_date),type:a.type||kindTypes[kind][0][0],completed:!!a.completed});
    setModal(true);setError('');
  };
  const close = ()=>{setModal(false);setEditing(null);setError('');};
  useEffect(()=>{
    if (!modal) return;
    const onKey = e=>{ if (e.key==='Escape') close(); };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[modal]);

  const setKind = kind => setForm(f=>({
    ...f, kind,
    type: kindTypes[kind].some(([v])=>v===f.type) ? f.type : kindTypes[kind][0][0],
    end_date: kind==='event' && f.due_date && !f.end_date ? addHour(f.due_date) : f.end_date,
  }));
  // Keep an event's end after its start when the start moves.
  const setStart = value => setForm(f=>({
    ...f, due_date:value,
    end_date: f.kind==='event' && value && (!f.end_date || f.end_date<=value) ? addHour(value) : f.end_date,
  }));

  const save = async e => {e.preventDefault();setSaving(true);setError('');try {
    const isEvent = form.kind==='event';
    if (!form.title.trim()||!form.due_date||(!isEvent&&!form.course.trim())) throw new Error(isEvent?'Fill in title and start time.':'Fill in title, course and due date.');
    if (isEvent&&(!form.end_date||form.end_date<=form.due_date)) throw new Error('End time must be after the start time.');
    const payload = {...form,title:form.title.trim(),course:form.course.trim(),due_date:withSeconds(form.due_date)};
    if (isEvent) { payload.end_date = withSeconds(form.end_date); delete payload.completed; } else delete payload.end_date;
    if (editing!==null) await api(`/${editing}`,{method:'PATCH',body:JSON.stringify(payload)});
    else await api('',{method:'POST',body:JSON.stringify(payload)});
    close();await load();
  } catch(e){setError(e.message);}finally{setSaving(false);}};
  const remove = async()=>{if(!window.confirm(`Delete "${form.title}"? This cannot be undone.`))return;setSaving(true);setError('');try{await api(`/${editing}`,{method:'DELETE'});close();await load();}catch(e){setError(e.message);}finally{setSaving(false);}};
  const toggle = async a=>{setError('');try{await api(`/${a.id}`,{method:'PATCH',body:JSON.stringify({completed:!a.completed})});await load();}catch(e){setError(e.message);}};
  // Handles both dragging (moves start and end together) and resizing events.
  const reschedule = async info=>{
    setError('');
    const isEvent = info.event.extendedProps.assignment.kind==='event';
    const body = {due_date:toLocalIso(info.event.start)};
    if (isEvent && info.event.end) body.end_date = toLocalIso(info.event.end);
    try { await api(`/${info.event.id}`,{method:'PATCH',body:JSON.stringify(body)}); await load(); }
    catch(e) { info.revert(); setError(e.message); }
  };
  // Month cells default to an assignment due at noon; week/day time slots default to an event over the selected time.
  const onSelect = info => {
    info.view.calendar.unselect();
    if (info.allDay) return openNew('assignment', `${info.startStr.slice(0,10)}T12:00`);
    const end = info.end - info.start > 30*60000 ? info.end : new Date(info.start.getTime()+3600000);
    openNew('event', toLocalIso(info.start).slice(0,16), toLocalIso(end).slice(0,16));
  };
  const isEvent = form.kind==='event';

  return <div className="shell">
    <header className="topbar">
      <div><div className="brand"><span className="brandmark">◈</span> OneFlow</div><p>Stay on top of what's next.</p></div>
      <div className="newbtns">
        <button className="secondary" onClick={()=>openNew('event')}>+ Event</button>
        <button className="primary" onClick={()=>openNew('assignment')}>+ Assignment</button>
        <div className="account">
          {user.picture?<img src={user.picture} alt="" referrerPolicy="no-referrer"/>:<span className="avatar">{(user.name||user.email||'?')[0].toUpperCase()}</span>}
          <span className="who" title={user.email}>{user.name||user.email}</span>
          <button className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>

    <section className="stats">
      <div><span>{filter===ALL?'Assignments':filter}</span><strong>{tasks.length}</strong></div>
      <div><span>Upcoming</span><strong>{upcoming.length}</strong></div>
      <div className={overdue.length?'warn':''}><span>Overdue</span><strong>{overdue.length}</strong></div>
      <div><span>Completed</span><strong>{tasks.filter(a=>a.completed).length}</strong></div>
    </section>

    <div className="layout">
      <aside className="sidebar">
        <div className="sidehead">Courses</div>
        <button className={filter===ALL?'course active':'course'} onClick={()=>setFilter(ALL)}>{ALL} <span>{items.length}</span></button>
        {courses.map(c=><button key={c} className={filter===c?'course active':'course'} onClick={()=>setFilter(c)}>{c}<span>{items.filter(a=>a.course===c).length}</span></button>)}

        <div className="sidehead upnext">Up next</div>
        {upcoming.length+overdue.length===0&&<div className="hint">{loading?'Loading…':'Nothing due. Nice work!'}</div>}
        <ul className="todo">
          {[...overdue,...upcoming].slice(0,8).map(a=><li key={a.id} className={new Date(a.due_date)<now?'late':''}>
            <input type="checkbox" checked={!!a.completed} onChange={()=>toggle(a)} aria-label={`Mark ${a.title} complete`}/>
            <button className="todo-text" onClick={()=>openEdit(a)}>
              <strong><i style={{background:categories[categoryOf(a)].color}}/>{a.title}</strong>
              <small>{a.course} · {typeLabel(a)} · {formatDue(a.due_date)}</small>
            </button>
          </li>)}
        </ul>

        <div className="sidehead upnext">Colors</div>
        <ul className="legend">{Object.values(categories).map(c=><li key={c.label}><i style={{background:c.color}}/>{c.label}</li>)}</ul>
        <div className="hint">Tip: click a day for an assignment, click or drag across time slots in Week/Day for an event. Drag items to reschedule; drag an event's edge to change its length.</div>
      </aside>

      <main className="calendar-card">
        {error&&!modal&&<div className="error">{error} <button onClick={load}>Retry</button></div>}
        {loading?<div className="loading">Loading assignments…</div>:<FullCalendar
          plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{left:'prev,next today',center:'title',right:'dayGridMonth,timeGridWeek,timeGridDay'}}
          buttonText={{today:'Today',month:'Month',week:'Week',day:'Day'}}
          height="auto" dayMaxEvents={3} nowIndicator scrollTime="08:00:00"
          eventDisplay="block" defaultTimedEventDuration="00:30"
          eventTimeFormat={{hour:'numeric',minute:'2-digit',meridiem:'short'}}
          editable eventDrop={reschedule} eventResize={reschedule}
          selectable select={onSelect}
          eventClick={info=>openEdit(info.event.extendedProps.assignment)}
          eventDidMount={info=>{const a=info.event.extendedProps.assignment; info.el.title=`${a.title}${a.course?` · ${a.course}`:''} · ${typeLabel(a)}${a.completed?' (completed)':''}`;}}
          events={events}/>}
      </main>
    </div>

    {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`${editing!==null?'Edit':'New'} ${form.kind}`}>
        <div className="dialog-head"><h2>{editing!==null?'Edit':'New'} {isEvent?'event':'assignment'}</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <form onSubmit={save}>
          <div className="segmented" role="radiogroup" aria-label="Kind">
            {['assignment','event'].map(k=><button key={k} type="button" role="radio" aria-checked={form.kind===k} className={form.kind===k?'on':''} onClick={()=>setKind(k)}>{k==='event'?'Event':'Assignment'}</button>)}
          </div>
          <label>Title<input required autoFocus maxLength={100} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder={isEvent?'CSE 220 lecture':'Homework 1'}/></label>
          <div className="row">
            <label>{isEvent?'Course (optional)':'Course'}<input required={!isEvent} maxLength={50} value={form.course} onChange={e=>setForm({...form,course:e.target.value})} placeholder="CSE 220" list="course-list"/><datalist id="course-list">{courses.map(c=><option key={c} value={c}/>)}</datalist></label>
            <label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
              {[...kindTypes[form.kind], ...(kindTypes[form.kind].some(([v])=>v===form.type)?[]:[[form.type,form.type]])].map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select></label>
          </div>
          {isEvent
            ? <div className="row">
                <label>Starts<input required type="datetime-local" value={form.due_date} onChange={e=>setStart(e.target.value)}/></label>
                <label>Ends<input required type="datetime-local" min={form.due_date} value={form.end_date} onChange={e=>setForm({...form,end_date:e.target.value})}/></label>
              </div>
            : <label>Due date & time<input required type="datetime-local" value={form.due_date} onChange={e=>setStart(e.target.value)}/></label>}
          {editing!==null&&!isEvent&&<label className="check"><input type="checkbox" checked={form.completed} onChange={e=>setForm({...form,completed:e.target.checked})}/> Completed</label>}
          {error&&<div className="error">{error}</div>}
          <div className="actions">
            {editing!==null&&<button type="button" className="danger" disabled={saving} onClick={remove}>Delete</button>}
            <span className="grow"/>
            <button type="button" className="secondary" onClick={close}>Cancel</button>
            <button className="primary" disabled={saving} type="submit">{saving?'Saving…':'Save'}</button>
          </div>
        </form>
      </div>
    </div>}
  </div>;
}
