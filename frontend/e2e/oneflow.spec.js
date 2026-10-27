import { test, expect } from '@playwright/test';
import { TEST_API } from '../playwright.config.js';

// The browser clock is pinned to Wed Oct 28 2026, 10:00 (America/Chicago) so the
// visible month/week and "overdue" status are the same on every run.
const NOW = new Date('2026-10-28T10:00:00-05:00');
const API = `${TEST_API}/api/assignments`;

const hw = (over={}) => ({ title:'HW1', course:'CSE 220', type:'assignment', due_date:'2026-10-29T14:00:00', ...over });
const ev = (over={}) => ({ kind:'event', title:'Lecture', course:'', type:'class', due_date:'2026-10-28T14:00:00', end_date:'2026-10-28T15:00:00', ...over });

async function seed(request, ...items) {
  const out = [];
  for (const item of items) {
    const r = await request.post(API, { data:item });
    expect(r.status(), await r.text()).toBe(201);
    out.push(await r.json());
  }
  return out;
}
const all = async request => (await request.get(API)).json();

async function open(page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await expect(page.locator('.fc')).toBeVisible();
}
const dialog = page => page.getByRole('dialog');
const calEvent = (page, text) => page.locator('.calendar-card .fc-event', { hasText:text });
const view = async (page, name) => { await page.locator('.fc-toolbar').getByRole('button', { name, exact:true }).click(); };
const center = async loc => { const b = await loc.boundingBox(); return { x:b.x+b.width/2, y:b.y+b.height/2 }; };

// Moves the pointer in small steps so FullCalendar registers a real drag.
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x+3, from.y+3, { steps:3 });
  await page.mouse.move(to.x, to.y, { steps:15 });
  await page.mouse.up();
}
// Point inside a week/day time slot: the column for `date`, near the top of the `time` row.
async function slot(page, date, time, dy=4) {
  const col = await page.locator(`.fc-timegrid-col[data-date="${date}"]`).boundingBox();
  const row = await page.locator(`.fc-timegrid-slot-lane[data-time="${time}"]`).boundingBox();
  return { x:col.x+col.width/2, y:row.y+dy };
}

test.beforeEach(async ({ request }) => {
  // Clears the throwaway e2e database (port 5001) only.
  expect(API).toContain('127.0.0.1:5001');
  for (const item of await all(request)) await request.delete(`${API}/${item.id}`);
});

test('assignment create, edit and delete through the UI', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name:'+ Assignment' }).click();
  await expect(dialog(page).getByRole('heading')).toHaveText('New assignment');
  await dialog(page).getByLabel('Title').fill('Essay draft');
  await dialog(page).getByLabel('Course').fill('ENG 101');
  await dialog(page).getByLabel('Due date & time').fill('2026-10-29T14:00');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('.fc-daygrid-day[data-date="2026-10-29"] .fc-event', { hasText:'Essay draft' })).toBeVisible();
  let [a] = await all(request);
  expect(a).toMatchObject({ title:'Essay draft', course:'ENG 101', type:'assignment', kind:'assignment', due_date:'2026-10-29T14:00:00', end_date:null });

  await calEvent(page, 'Essay draft').click();
  await expect(dialog(page).getByRole('heading')).toHaveText('Edit assignment');
  await expect(dialog(page).getByLabel('Due date & time')).toHaveValue('2026-10-29T14:00');
  await dialog(page).getByLabel('Title').fill('Essay final');
  await dialog(page).getByLabel('Type').selectOption('exam');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(calEvent(page, 'Essay final')).toBeVisible();
  await expect(calEvent(page, 'Essay draft')).toHaveCount(0);
  [a] = await all(request);
  expect(a).toMatchObject({ title:'Essay final', type:'exam', due_date:'2026-10-29T14:00:00' });

  await calEvent(page, 'Essay final').click();
  page.once('dialog', d => d.accept());
  await dialog(page).getByRole('button', { name:'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(calEvent(page, 'Essay final')).toHaveCount(0);
  expect(await all(request)).toEqual([]);
});

test('event create, edit and delete through the UI', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name:'+ Event' }).click();
  await expect(dialog(page).getByRole('heading')).toHaveText('New event');
  await expect(dialog(page).getByRole('radio', { name:'Event' })).toHaveAttribute('aria-checked', 'true');
  await dialog(page).getByLabel('Title').fill('Robotics club');
  await dialog(page).getByLabel('Type').selectOption('club');
  await dialog(page).getByLabel('Starts').fill('2026-10-29T18:00');
  await expect(dialog(page).getByLabel('Ends')).toHaveValue('2026-10-29T19:00');
  await dialog(page).getByLabel('Ends').fill('2026-10-29T19:30');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  let [e] = await all(request);
  expect(e).toMatchObject({ kind:'event', title:'Robotics club', type:'club', course:'', due_date:'2026-10-29T18:00:00', end_date:'2026-10-29T19:30:00' });

  await view(page, 'Week');
  const block = page.locator('.fc-timegrid-col[data-date="2026-10-29"] .fc-event', { hasText:'Robotics club' });
  await expect(block).toBeVisible();
  await block.click();
  await expect(dialog(page).getByRole('heading')).toHaveText('Edit event');
  await expect(dialog(page).getByLabel('Ends')).toHaveValue('2026-10-29T19:30');
  await dialog(page).getByLabel('Course (optional)').fill('ENGR 1');
  await dialog(page).getByLabel('Ends').fill('2026-10-29T20:00');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  [e] = await all(request);
  expect(e).toMatchObject({ course:'ENGR 1', end_date:'2026-10-29T20:00:00' });

  await block.click();
  page.once('dialog', d => d.accept());
  await dialog(page).getByRole('button', { name:'Delete' }).click();
  await expect(block).toHaveCount(0);
  expect(await all(request)).toEqual([]);
});

test('an event cannot end before it starts', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name:'+ Event' }).click();
  await dialog(page).getByLabel('Title').fill('Bad times');
  await dialog(page).getByLabel('Starts').fill('2026-10-29T18:00');
  await dialog(page).getByLabel('Ends').fill('2026-10-29T17:00');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(dialog(page)).toBeVisible();
  expect(await all(request)).toEqual([]);
});

test('switching kind in the dialog swaps the date fields', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name:'+ Assignment' }).click();
  await dialog(page).getByLabel('Due date & time').fill('2026-10-30T09:00');
  await dialog(page).getByRole('radio', { name:'Event' }).click();
  await expect(dialog(page).getByRole('heading')).toHaveText('New event');
  await expect(dialog(page).getByLabel('Starts')).toHaveValue('2026-10-30T09:00');
  await expect(dialog(page).getByLabel('Ends')).toHaveValue('2026-10-30T10:00');
  await expect(dialog(page).getByLabel('Type')).toHaveValue('class');
  await dialog(page).getByRole('radio', { name:'Assignment' }).click();
  await expect(dialog(page).getByLabel('Due date & time')).toHaveValue('2026-10-30T09:00');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});

test('clicking a month day opens a new assignment due at noon', async ({ page }) => {
  await open(page);
  await page.locator('.fc-daygrid-day[data-date="2026-10-30"] .fc-daygrid-day-frame').click({ position:{ x:20, y:60 } });
  await expect(dialog(page).getByRole('heading')).toHaveText('New assignment');
  await expect(dialog(page).getByLabel('Due date & time')).toHaveValue('2026-10-30T12:00');
});

test('clicking or dragging across week time slots opens a new event', async ({ page }) => {
  await open(page);
  await view(page, 'Week');
  await page.locator('.fc-timegrid-slot-lane[data-time="13:00:00"]').scrollIntoViewIfNeeded();
  const p = await slot(page, '2026-10-29', '13:00:00');
  await page.mouse.click(p.x, p.y);
  await expect(dialog(page).getByRole('heading')).toHaveText('New event');
  await expect(dialog(page).getByLabel('Starts')).toHaveValue('2026-10-29T13:00');
  await expect(dialog(page).getByLabel('Ends')).toHaveValue('2026-10-29T14:00');
  await page.keyboard.press('Escape');

  await drag(page, await slot(page, '2026-10-29', '10:00:00'), await slot(page, '2026-10-29', '11:00:00'));
  await expect(dialog(page).getByLabel('Starts')).toHaveValue('2026-10-29T10:00');
  await expect(dialog(page).getByLabel('Ends')).toHaveValue('2026-10-29T11:30');
});

test('completing an assignment from Up next and un-completing it in the dialog', async ({ page, request }) => {
  const [a] = await seed(request, hw(), hw({ title:'Late lab', due_date:'2026-10-27T09:00:00' }));
  await open(page);
  await expect(page.locator('.stats .warn')).toContainText('Overdue1');
  const item = page.locator('.todo li', { hasText:'HW1' });
  await expect(item).toBeVisible();
  await expect(page.locator('.todo li.late', { hasText:'Late lab' })).toBeVisible();

  // Completing removes the row from Up next, so click() rather than check() (which expects the box to stay ticked).
  await item.getByRole('checkbox').click();
  await expect(item).toHaveCount(0);
  await expect(calEvent(page, '✓ HW1')).toHaveClass(/done/);
  await expect(page.locator('.stats')).toContainText('Completed1');
  expect((await all(request)).find(x => x.id===a.id).completed).toBe(true);

  await calEvent(page, 'HW1').click();
  await expect(dialog(page).getByLabel('Completed')).toBeChecked();
  await dialog(page).getByLabel('Completed').uncheck();
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(page.locator('.todo li', { hasText:'HW1' })).toBeVisible();
  await expect(calEvent(page, 'HW1')).not.toHaveClass(/done/);
  expect((await all(request)).find(x => x.id===a.id).completed).toBe(false);
});

test('month, week and day views show assignments and events', async ({ page, request }) => {
  await seed(request, hw({ title:'Problem set', due_date:'2026-10-28T16:00:00' }), ev());
  await open(page);
  const title = page.locator('.fc-toolbar-title');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await expect(title).toHaveText('October 2026');
  await expect(calEvent(page, 'Problem set')).toBeVisible();
  await expect(calEvent(page, 'Lecture')).toBeVisible();

  await view(page, 'Week');
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  await expect(title).toHaveText('Oct 25 – 31, 2026');
  await expect(page.locator('.fc-timegrid-col[data-date="2026-10-28"] .fc-event')).toHaveCount(2);

  await view(page, 'Day');
  await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
  await expect(title).toHaveText('October 28, 2026');
  await expect(calEvent(page, 'Problem set')).toBeVisible();
  await expect(calEvent(page, 'Lecture')).toBeVisible();

  await page.locator('.fc-toolbar').getByRole('button', { name:'next' }).click();
  await expect(title).toHaveText('October 29, 2026');
  await expect(page.locator('.calendar-card .fc-event')).toHaveCount(0);
  await page.locator('.fc-toolbar').getByRole('button', { name:'Today' }).click();
  await expect(title).toHaveText('October 28, 2026');

  await view(page, 'Month');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
});

test('items are color coded by category', async ({ page, request }) => {
  await seed(request,
    hw({ title:'Midterm', type:'exam' }), hw({ title:'Pop quiz', type:'quiz' }),
    hw({ title:'Worksheet' }), hw({ title:'Group project', type:'project' }),
    hw({ title:'Reading', type:'other' }), ev({ title:'Study group', type:'study' }));
  await open(page);
  const bg = t => expect(calEvent(page, t)).toHaveCSS('background-color', {
    Midterm:'rgb(229, 72, 77)', 'Pop quiz':'rgb(229, 72, 77)',
    Worksheet:'rgb(245, 197, 66)', 'Group project':'rgb(245, 197, 66)',
    Reading:'rgb(63, 174, 106)', 'Study group':'rgb(74, 127, 224)',
  }[t]);
  for (const t of ['Midterm','Pop quiz','Worksheet','Group project','Reading','Study group']) await bg(t);
});

test('filtering by course, including falling back when a course empties', async ({ page, request }) => {
  await seed(request, hw(), hw({ title:'Calc exam', course:'MATH 101', type:'exam' }), ev({ title:'Gym' }));
  await open(page);
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name:/^CSE 220/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name:/^MATH 101/ })).toBeVisible();

  await sidebar.getByRole('button', { name:/^MATH 101/ }).click();
  await expect(calEvent(page, 'Calc exam')).toBeVisible();
  await expect(calEvent(page, 'HW1')).toHaveCount(0);
  await expect(calEvent(page, 'Gym')).toHaveCount(0);
  await expect(page.locator('.stats > div').first()).toContainText('MATH 101');

  await sidebar.getByRole('button', { name:/^All courses/ }).click();
  for (const t of ['Calc exam','HW1','Gym']) await expect(calEvent(page, t)).toBeVisible();

  await sidebar.getByRole('button', { name:/^MATH 101/ }).click();
  await calEvent(page, 'Calc exam').click();
  page.once('dialog', d => d.accept());
  await dialog(page).getByRole('button', { name:'Delete' }).click();
  await expect(sidebar.getByRole('button', { name:/^MATH 101/ })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name:/^All courses/ })).toHaveClass(/active/);
  await expect(calEvent(page, 'HW1')).toBeVisible();
  await expect(calEvent(page, 'Gym')).toBeVisible();
});

test('dragging an assignment to another day in month view reschedules it', async ({ page, request }) => {
  const [a] = await seed(request, hw({ due_date:'2026-10-28T14:00:00' }));
  await open(page);
  const target = page.locator('.fc-daygrid-day[data-date="2026-10-30"]');
  await drag(page, await center(calEvent(page, 'HW1')), await center(target));
  await expect(target.locator('.fc-event', { hasText:'HW1' })).toBeVisible();
  await expect.poll(async () => (await all(request)).find(x => x.id===a.id).due_date).toBe('2026-10-30T14:00:00');

  await page.reload();
  await expect(page.locator('.fc-daygrid-day[data-date="2026-10-30"] .fc-event', { hasText:'HW1' })).toBeVisible();
});

test('dragging an event in week view moves its start and end together', async ({ page, request }) => {
  const [e] = await seed(request, ev());
  await open(page);
  await view(page, 'Week');
  const block = calEvent(page, 'Lecture');
  await block.scrollIntoViewIfNeeded();
  const b = await block.boundingBox();
  // Grab 4px below the event's top and drop 4px below the 15:00 slot top on Thursday.
  await drag(page, { x:b.x+b.width/2, y:b.y+4 }, await slot(page, '2026-10-29', '15:00:00'));
  await expect.poll(async () => {
    const x = (await all(request)).find(i => i.id===e.id);
    return [x.due_date, x.end_date];
  }).toEqual(['2026-10-29T15:00:00', '2026-10-29T16:00:00']);
  await expect(page.locator('.fc-timegrid-col[data-date="2026-10-29"] .fc-event', { hasText:'Lecture' })).toBeVisible();
});

test('resizing an event in week view changes only its end time', async ({ page, request }) => {
  const [e] = await seed(request, ev());
  await open(page);
  await view(page, 'Week');
  const block = calEvent(page, 'Lecture');
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  const handle = block.locator('.fc-event-resizer-end');
  await expect(handle).toBeAttached();
  const h = await handle.boundingBox();
  // Drag the bottom edge from 15:00 down into the 15:30 slot so the event ends at 16:00.
  const to = await slot(page, '2026-10-28', '15:30:00', 10);
  await drag(page, { x:h.x+h.width/2, y:h.y+h.height/2 }, { x:h.x+h.width/2, y:to.y });
  await expect.poll(async () => {
    const x = (await all(request)).find(i => i.id===e.id);
    return [x.due_date, x.end_date];
  }).toEqual(['2026-10-28T14:00:00', '2026-10-28T16:00:00']);
});

test('assignments have no resize handle (only events can be resized)', async ({ page, request }) => {
  await seed(request, hw({ due_date:'2026-10-28T14:00:00' }));
  await open(page);
  await view(page, 'Week');
  const block = calEvent(page, 'HW1');
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await expect(block.locator('.fc-event-resizer-end')).toHaveCount(0);
});

test('everything is still there after a refresh', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name:'+ Assignment' }).click();
  await dialog(page).getByLabel('Title').fill('Persist me');
  await dialog(page).getByLabel('Course').fill('HIST 200');
  await dialog(page).getByLabel('Type').selectOption('project');
  await dialog(page).getByLabel('Due date & time').fill('2026-10-30T23:59');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await page.getByRole('button', { name:'+ Event' }).click();
  await dialog(page).getByLabel('Title').fill('Office hours');
  await dialog(page).getByLabel('Starts').fill('2026-10-29T11:00');
  await dialog(page).getByLabel('Ends').fill('2026-10-29T12:15');
  await dialog(page).getByRole('button', { name:'Save' }).click();
  await expect(calEvent(page, 'Office hours')).toBeVisible();

  await page.reload();
  await expect(calEvent(page, 'Persist me')).toBeVisible();
  await expect(calEvent(page, 'Office hours')).toBeVisible();
  await expect(page.locator('.sidebar').getByRole('button', { name:/^HIST 200/ })).toBeVisible();

  await calEvent(page, 'Persist me').click();
  await expect(dialog(page).getByLabel('Course')).toHaveValue('HIST 200');
  await expect(dialog(page).getByLabel('Type')).toHaveValue('project');
  await expect(dialog(page).getByLabel('Due date & time')).toHaveValue('2026-10-30T23:59');
  await page.keyboard.press('Escape');

  await calEvent(page, 'Office hours').click();
  await expect(dialog(page).getByLabel('Starts')).toHaveValue('2026-10-29T11:00');
  await expect(dialog(page).getByLabel('Ends')).toHaveValue('2026-10-29T12:15');
  expect(await all(request)).toHaveLength(2);
});
