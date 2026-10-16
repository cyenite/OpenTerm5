import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsEvent } from '../shared/news';
import { calendarWeek, NewsCalendar, parseCalendar, type CalendarCache } from './news-calendar';

const feed = [
  { title: 'Non-Farm Employment Change', country: 'USD', date: '2026-10-16T08:30:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'Bank Holiday', country: 'JPY', date: '2026-10-11T19:00:00-04:00', impact: 'Holiday', forecast: '', previous: '' },
  { title: 'CPI y/y', country: 'GBP', date: '2026-10-14T02:00:00-04:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'broken', country: 'USD', date: 'soon', impact: 'High' },
];

const NFP = Date.parse('2026-10-16T08:30:00-04:00');

function setup(response: () => Promise<Response> = async () => new Response(JSON.stringify(feed))) {
  const saved: CalendarCache[] = [];
  const messages: string[] = [];
  const clock = { time: Date.parse('2026-10-15T12:00:00Z') };
  let calls = 0;
  const calendar = new NewsCalendar(
    { load: async () => ({ fetchedAt: 0, events: [] }), save: async (value) => { saved.push(value); } },
    async () => { calls++; return response(); },
    (message) => messages.push(message),
    () => clock.time,
  );
  return { calendar, saved, messages, clock, calls: () => calls };
}

test('the feed is parsed into dated events, without holidays or broken rows, oldest first', () => {
  const events = parseCalendar(feed);
  assert.deepEqual(events.map((event) => event.title), ['CPI y/y', 'Non-Farm Employment Change']);
  assert.deepEqual(events[1], { time: NFP, impact: 'high', title: 'Non-Farm Employment Change', currency: 'USD' });
  assert.throws(() => parseCalendar({}), /not a list/);
});

test('the calendar week runs Sunday to Sunday in New York', () => {
  const events: NewsEvent[] = [{ time: Date.parse('2026-10-14T02:00:00-04:00'), impact: 'medium', title: 'CPI', currency: 'GBP' }];
  const week = calendarWeek(events)!;
  assert.equal(new Date(week.start).toISOString(), '2026-10-11T04:00:00.000Z');
  assert.equal(week.end - week.start, 7 * 86_400_000);
  assert.equal(calendarWeek([]), null);
});

test('blackouts cover the window around matching releases only', async () => {
  const { calendar } = setup();
  await calendar.refresh();
  const window = (time: number) => calendar.blackout(['EUR', 'USD'], time, 2 * 60_000, 5 * 60_000, 'high');
  assert.equal(window(NFP - 2 * 60_000)?.title, 'Non-Farm Employment Change');
  assert.equal(window(NFP + 5 * 60_000)?.title, 'Non-Farm Employment Change');
  assert.equal(window(NFP - 2 * 60_000 - 1), undefined);
  assert.equal(window(NFP + 5 * 60_000 + 1), undefined);
  assert.equal(calendar.blackout(['JPY'], NFP, 60_000, 60_000, 'high'), undefined, 'other currencies');
  const cpi = Date.parse('2026-10-14T02:00:00-04:00');
  assert.equal(calendar.blackout(['GBP'], cpi, 60_000, 60_000, 'high'), undefined, 'medium impact is below a high threshold');
  assert.equal(calendar.blackout(['GBP'], cpi, 60_000, 60_000, 'medium')?.title, 'CPI y/y');
});

test('outside the fetched week nothing is blocked and the journal says why once', async () => {
  const { calendar, messages } = setup();
  await calendar.refresh();
  const nextWeek = NFP + 7 * 86_400_000;
  assert.equal(calendar.isCovering(nextWeek), false);
  assert.equal(calendar.blackout(['USD'], nextWeek, 60_000, 60_000, 'high'), undefined);
  calendar.blackout(['USD'], nextWeek, 60_000, 60_000, 'high');
  assert.equal(messages.filter((message) => /not enforced/.test(message)).length, 1);
});

test('a failed refresh keeps the last calendar and reports the error', async () => {
  let isDown = false;
  const { calendar, saved, messages } = setup(async () => isDown ? new Response('busy', { status: 429 }) : new Response(JSON.stringify(feed)));
  await calendar.refresh();
  isDown = true;
  await calendar.refresh();
  assert.equal(saved.length, 1);
  assert.equal(calendar.view().status.error, 'the feed answered HTTP 429');
  assert.match(messages.at(-1)!, /HTTP 429/);
  assert.equal(calendar.blackout(['USD'], NFP, 0, 0, 'high')?.title, 'Non-Farm Employment Change');
});

test('the feed is only contacted while a guard uses it', async () => {
  const { calendar, calls } = setup();
  await calendar.init();
  assert.equal(calls(), 0);
  calendar.setActive(true);
  await calendar.refresh();
  calendar.setActive(false);
  assert.ok(calls() >= 1);
  assert.equal(calendar.view().status.isActive, false);
  calendar.stop();
});
