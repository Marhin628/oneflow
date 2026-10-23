import React, { useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

const API = '/api/assignments';
const ALL = 'All courses';
const palette = ['#6c7cf0','#ed8b6b','#4eac98','#bc7bd5','#e3ae52','#5b9ed9','#d9677f','#7a9b4e'];
const types = ['assignment','exam','quiz','project','event','other'];
const empty = { title:'', course:'', due_date:'', type:'assignment', completed:false };

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
async function api(path='', options={}) {
  let response;
  try { response = await fetch(API+path, {headers:{'Content-Type':'application/json'}, ...options}); }
  catch { throw new Error('Cannot reach Flask. Make sure python app.py is running on port 5000.'); }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(errorText(data, response.status));
  return data;
}

export default function App() {
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
  const colors = useMemo(()=>Object.fromEntries(courses.map((c,i)=>[c,palette[i%palette.length]])),[courses.join('|')]);
  // Fall back to all courses when the filtered course no longer has any assignments.
  useEffect(()=>{ if (filter!==ALL && !courses.includes(filter)) setFilter(ALL); },[courses.join('|')]);

  const shown = items.filter(a=>filter===ALL||a.course===filter);
  const now = new Date();
  const upcoming = shown.filter(a=>!a.completed&&new Date(a.due_date)>=now).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
  const overdue = shown.filter(a=>!a.completed&&new Date(a.due_date)<now);
  const events = shown.map(a=>({
    id:String(a.id), title:`${a.completed?'✓ ':''}${a.title}`, start:a.due_date, allDay:false,
    backgroundColor:colors[a.course]||palette[0], borderColor:colors[a.course]||palette[0],
    classNames:a.completed?['done']:[], extendedProps:{assignment:a},
  }));

  const openNew = (date='') => {setEditing(null);setForm({...empty,course:filter===ALL?'':filter,due_date:date});setModal(true);setError('');};
  const openEdit = a => {setEditing(a.id);setForm({title:a.title||'',course:a.course||'',due_date:toInputDate(a.due_date),type:a.type||'assignment',completed:!!a.completed});setModal(true);setError('');};
  const close = ()=>{setModal(false);setEditing(null);setError('');};
  useEffect(()=>{
    if (!modal) return;
    const onKey = e=>{ if (e.key==='Escape') close(); };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[modal]);

  const save = async e => {e.preventDefault();setSaving(true);setError('');try {
    if (!form.title.trim()||!form.course.trim()||!form.due_date) throw new Error('Fill in title, course and due date.');
    const payload = {...form,title:form.title.trim(),course:form.course.trim(),due_date:form.due_date.length===16?`${form.due_date}:00`:form.due_date};
    if (editing!==null) await api(`/${editing}`,{method:'PATCH',body:JSON.stringify(payload)});
    else await api('',{method:'POST',body:JSON.stringify(payload)});
    close();await load();
  } catch(e){setError(e.message);}finally{setSaving(false);}};
  const remove = async()=>{if(!window.confirm(`Delete "${form.title}"? This cannot be undone.`))return;setSaving(true);setError('');try{await api(`/${editing}`,{method:'DELETE'});close();await load();}catch(e){setError(e.message);}finally{setSaving(false);}};
  const toggle = async a=>{setError('');try{await api(`/${a.id}`,{method:'PATCH',body:JSON.stringify({completed:!a.completed})});await load();}catch(e){setError(e.message);}};
  const reschedule = async info=>{
    setError('');
    try { await api(`/${info.event.id}`,{method:'PATCH',body:JSON.stringify({due_date:toLocalIso(info.event.start)})}); await load(); }
    catch(e) { info.revert(); setError(e.message); }
  };
  // Month cells have no time, so default to noon; week/day slots keep the clicked time.
  const clickDate = info => openNew(info.allDay ? `${info.dateStr.slice(0,10)}T12:00` : toLocalIso(info.date).slice(0,16));

  return <div className="shell">
    <header className="topbar">
      <div><div className="brand"><span className="brandmark">◈</span> OneFlow</div><p>Stay on top of what's next.</p></div>
      <button className="primary" onClick={()=>openNew()}>+ New assignment</button>
    </header>

    <section className="stats">
      <div><span>{filter===ALL?'Assignments':filter}</span><strong>{shown.length}</strong></div>
      <div><span>Upcoming</span><strong>{upcoming.length}</strong></div>
      <div className={overdue.length?'warn':''}><span>Overdue</span><strong>{overdue.length}</strong></div>
      <div><span>Completed</span><strong>{shown.filter(a=>a.completed).length}</strong></div>
    </section>

    <div className="layout">
      <aside className="sidebar">
        <div className="sidehead">Courses</div>
        <button className={filter===ALL?'course active':'course'} onClick={()=>setFilter(ALL)}>{ALL} <span>{items.length}</span></button>
        {courses.map(c=><button key={c} className={filter===c?'course active':'course'} onClick={()=>setFilter(c)}><i style={{background:colors[c]}}/>{c}<span>{items.filter(a=>a.course===c).length}</span></button>)}

        <div className="sidehead upnext">Up next</div>
        {upcoming.length+overdue.length===0&&<div className="hint">{loading?'Loading…':'Nothing due. Nice work!'}</div>}
        <ul className="todo">
          {[...overdue,...upcoming].slice(0,8).map(a=><li key={a.id} className={new Date(a.due_date)<now?'late':''}>
            <input type="checkbox" checked={!!a.completed} onChange={()=>toggle(a)} aria-label={`Mark ${a.title} complete`}/>
            <button className="todo-text" onClick={()=>openEdit(a)}>
              <strong><i style={{background:colors[a.course]}}/>{a.title}</strong>
              <small>{a.course} · {a.type} · {formatDue(a.due_date)}</small>
            </button>
          </li>)}
        </ul>
        <div className="hint">Tip: click a date to add an assignment, click an event to edit it, or drag it to reschedule.</div>
      </aside>

      <main className="calendar-card">
        {error&&!modal&&<div className="error">{error} <button onClick={load}>Retry</button></div>}
        {loading?<div className="loading">Loading assignments…</div>:<FullCalendar
          plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{left:'prev,next today',center:'title',right:'dayGridMonth,timeGridWeek,timeGridDay'}}
          buttonText={{today:'Today',month:'Month',week:'Week',day:'Day'}}
          height="auto" dayMaxEvents={3} nowIndicator scrollTime="08:00:00"
          eventTimeFormat={{hour:'numeric',minute:'2-digit',meridiem:'short'}}
          editable eventDurationEditable={false} eventDrop={reschedule}
          dateClick={clickDate}
          eventClick={info=>openEdit(info.event.extendedProps.assignment)}
          eventDidMount={info=>{const a=info.event.extendedProps.assignment; info.el.title=`${a.title} · ${a.course} · ${a.type}${a.completed?' (completed)':''}`;}}
          events={events}/>}
      </main>
    </div>

    {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={editing!==null?'Edit assignment':'New assignment'}>
        <div className="dialog-head"><h2>{editing!==null?'Edit assignment':'New assignment'}</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <form onSubmit={save}>
          <label>Title<input required autoFocus maxLength={100} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Homework 1"/></label>
          <div className="row">
            <label>Course<input required maxLength={50} value={form.course} onChange={e=>setForm({...form,course:e.target.value})} placeholder="CSE 220" list="course-list"/><datalist id="course-list">{courses.map(c=><option key={c} value={c}/>)}</datalist></label>
            <label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{[...new Set([...types,form.type])].map(t=><option key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</option>)}</select></label>
          </div>
          <label>Due date & time<input required type="datetime-local" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/></label>
          {editing!==null&&<label className="check"><input type="checkbox" checked={form.completed} onChange={e=>setForm({...form,completed:e.target.checked})}/> Completed</label>}
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
