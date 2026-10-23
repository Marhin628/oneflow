import React, { useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

const API = '/api/assignments';
const palette = ['#6c7cf0','#ed8b6b','#4eac98','#bc7bd5','#e3ae52','#5b9ed9'];
const empty = { title:'', course:'', due_date:'', type:'assignment', completed:false };
function toInputDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0,16);
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function fromApiDate(value) {
  if (!value) return '';
  // Flask-RESTful fields.DateTime defaults to an RFC 822 UTC string.
  return toInputDate(value);
}
async function api(path='', options={}) {
  let response;
  try { response = await fetch(API+path, {headers:{'Content-Type':'application/json'}, ...options}); }
  catch { throw new Error('Cannot reach Flask. Make sure python app.py is running on port 5000.'); }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.message || `Request failed (${response.status})`);
  return data;
}
export default function App() {
  const [items,setItems] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [modal,setModal] = useState(false);
  const [editing,setEditing] = useState(null);
  const [form,setForm] = useState(empty);
  const [filter,setFilter] = useState('All courses');
  const [saving,setSaving] = useState(false);
  const load = async () => { setError(''); try { const data = await api(); setItems(Array.isArray(data)?data:[]); } catch(e) {setError(e.message);} finally {setLoading(false);} };
  useEffect(()=>{load();},[]);
  const courses = [...new Set(items.map(a=>a.course).filter(Boolean))].sort();
  const colors = useMemo(()=>Object.fromEntries(courses.map((c,i)=>[c,palette[i%palette.length]])),[courses.join('|')]);
  const shown = items.filter(a=>filter==='All courses'||a.course===filter);
  const events = shown.map(a=>({id:String(a.id),title:`${a.completed?'✓ ':''}${a.title}`,start:a.due_date,allDay:false,backgroundColor:colors[a.course]||palette[0],borderColor:colors[a.course]||palette[0],classNames:a.completed?['done']:[],extendedProps:{assignment:a}}));
  const openNew = (date='') => {setEditing(null);setForm({...empty,due_date:date ? `${date}T12:00`:''});setModal(true);setError('');};
  const openEdit = a => {setEditing(a.id);setForm({title:a.title||'',course:a.course||'',due_date:fromApiDate(a.due_date),type:a.type||'assignment',completed:!!a.completed});setModal(true);setError('');};
  const close = ()=>{setModal(false);setEditing(null);};
  const save = async e => {e.preventDefault();setSaving(true);setError('');try {
    if (!form.title.trim()||!form.course.trim()||!form.due_date) throw new Error('Fill in title, course and due date.');
    const payload = {...form,title:form.title.trim(),course:form.course.trim(),due_date:form.due_date.length===16?`${form.due_date}:00`:form.due_date};
    if (editing!==null) await api(`/${editing}`,{method:'PATCH',body:JSON.stringify(payload)});
    else await api('',{method:'POST',body:JSON.stringify(payload)});
    close();await load();
  } catch(e){setError(e.message);}finally{setSaving(false);}};
  const remove = async()=>{if(!window.confirm('Delete this assignment?'))return;setSaving(true);setError('');try{await api(`/${editing}`,{method:'DELETE'});close();await load();}catch(e){setError(e.message);}finally{setSaving(false);}};
  const toggle = async a=>{setError('');try{await api(`/${a.id}`,{method:'PATCH',body:JSON.stringify({completed:!a.completed})});await load();}catch(e){setError(e.message);}};
  return <div className="shell">
    <header className="topbar"><div><div className="brand"><span className="brandmark">◈</span> OneFlow</div><p>Stay on top of what's next.</p></div><button className="primary" onClick={()=>openNew()}>+ New assignment</button></header>
    <section className="stats"><div><span>Assignments</span><strong>{items.length}</strong></div><div><span>Upcoming</span><strong>{items.filter(a=>!a.completed&&new Date(a.due_date)>=new Date()).length}</strong></div><div><span>Completed</span><strong>{items.filter(a=>a.completed).length}</strong></div></section>
    <div className="layout"><aside className="sidebar"><div className="sidehead">Courses</div><button className={filter==='All courses'?'course active':'course'} onClick={()=>setFilter('All courses')}>All courses <span>{items.length}</span></button>{courses.map(c=><button key={c} className={filter===c?'course active':'course'} onClick={()=>setFilter(c)}><i style={{background:colors[c]}}/>{c}<span>{items.filter(a=>a.course===c).length}</span></button>)}<div className="hint">Tip: click a date to add an assignment, or an event to edit it.</div></aside>
    <main className="calendar-card">{error&&!modal&&<div className="error">{error} <button onClick={load}>Retry</button></div>}{loading?<div className="loading">Loading assignments…</div>:<FullCalendar plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]} initialView="dayGridMonth" headerToolbar={{left:'prev,next today',center:'title',right:'dayGridMonth,timeGridWeek,timeGridDay'}} buttonText={{month:'Month',week:'Week',day:'Day'}} height="auto" dayMaxEvents={3} nowIndicator selectable dateClick={info=>openNew(info.dateStr.slice(0,10))} eventClick={info=>openEdit(info.event.extendedProps.assignment)} events={events}/>}</main></div>
    {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div className="dialog" role="dialog" aria-modal="true" aria-label={editing!==null?'Edit assignment':'New assignment'}><div className="dialog-head"><h2>{editing!==null?'Edit assignment':'New assignment'}</h2><button className="close" onClick={close} aria-label="Close">×</button></div><form onSubmit={save}><label>Title<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Homework 1"/></label><label>Course<input required value={form.course} onChange={e=>setForm({...form,course:e.target.value})} placeholder="CSE 220" list="course-list"/><datalist id="course-list">{courses.map(c=><option key={c} value={c}/>)}</datalist></label><label>Due date & time<input required type="datetime-local" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/></label><label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="assignment">Assignment</option><option value="exam">Exam</option><option value="quiz">Quiz</option><option value="event">Event</option><option value="other">Other</option></select></label>{editing!==null&&<label className="check"><input type="checkbox" checked={form.completed} onChange={e=>setForm({...form,completed:e.target.checked})}/> Completed</label>}{error&&<div className="error">{error}</div>}<div className="actions">{editing!==null&&<button type="button" className="danger" disabled={saving} onClick={remove}>Delete</button>}<span className="grow"/><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={saving} type="submit">{saving?'Saving…':'Save'}</button></div></form></div></div>}
  </div>;
}
