const CALENDAR_ICS_URL = 'https://calendar.google.com/calendar/ical/134651e964b5e965ddca581606293fc19ccb342dde01a6e9dd4e7807c00138af%40group.calendar.google.com/public/basic.ics';
const CALENDAR_ID = '134651e964b5e965ddca581606293fc19ccb342dde01a6e9dd4e7807c00138af@group.calendar.google.com';
const CALENDAR_WEB_ID = CALENDAR_ID.replace(/@group\.calendar\.google\.com$/, '@g');
const CALENDAR_TZ = 'America/Chicago';
const SKIP_TITLES = /\b(no class|spring break|campus closed|offices closed|holiday|faculty convocation|grading day|commencement)\b/i;
const CACHE_MS = 5 * 60 * 1000;
let cached = null;

async function readCalendarFeed() {
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.payload;
  const response = await fetch(CALENDAR_ICS_URL, { headers: { accept: 'text/calendar' } });
  if (!response.ok) throw new Error('Calendar feed unavailable');
  const text = await response.text();
  const allEvents = parseIcs(text).filter(event => event.date && event.title && !event.cancelled);
  const classEvents = allEvents
    .filter(event => !SKIP_TITLES.test(event.title) && [2, 4].includes(weekday(event.date)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const today = localToday();
  const previousTopics = classEvents.filter(event => event.date <= today && stageForTitle(event.title) !== null);
  const upcomingTopics = classEvents.filter(event => event.date >= today && stageForTitle(event.title) !== null);
  const currentStage = previousTopics.length
    ? stageForTitle(previousTopics[previousTopics.length - 1].title)
    : (upcomingTopics.length ? stageForTitle(upcomingTopics[0].title) : null);
  const payload = {
    ok: true,
    timeZone: CALENDAR_TZ,
    updatedAt: new Date().toISOString(),
    currentStage,
    events: classEvents.filter(event => event.date >= today).slice(0, 2).map(({ date, title, description, url, notes, readings, assignments, overview }) => ({ date, title, description, url, notes, readings, assignments, overview }))
  };
  cached = { savedAt: Date.now(), payload };
  return payload;
}

function parseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') { if (current) events.push(normalizeEvent(current)); current = null; continue; }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(';', 1)[0].toUpperCase();
    const value = line.slice(colon + 1);
    if (['DTSTART', 'SUMMARY', 'DESCRIPTION', 'URL', 'UID', 'STATUS'].includes(key)) current[key] = value;
  }
  return events;
}

function normalizeEvent(event) {
  const title = decodeText(event.SUMMARY || '').trim().slice(0, 240);
  const description = plainDescription(decodeText(event.DESCRIPTION || '')).slice(0, 6000);
  const sections = descriptionSections(description);
  return {
    date: parseIcsDate(event.DTSTART || ''),
    title,
    description,
    notes: linkedItems(sections.notes),
    readings: cleanSection(sections.readings),
    assignments: linkedItems(sections.complete).filter(item => !/concept\s+practice/i.test(item.title)),
    overview: overviewForTitle(title),
    url: eventCalendarUrl(event),
    cancelled: /^CANCELLED$/i.test(event.STATUS || '')
  };
}

function eventCalendarUrl(event) {
  if (/^https:\/\/(?:www\.)?google\.com\/calendar\/event\?/.test(event.URL || '')) return event.URL;
  const uid = String(event.UID || '').match(/^([a-z0-9]+)@google\.com$/i);
  const date = parseIcsDate(event.DTSTART || '');
  if (!uid || !date) return '';
  const eventId = `${uid[1]}_${date.replace(/-/g, '')}`;
  const eid = Buffer.from(`${eventId} ${CALENDAR_WEB_ID}`).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `https://www.google.com/calendar/event?eid=${eid}&ctz=${encodeURIComponent(CALENDAR_TZ)}`;
}

function parseIcsDate(raw) {
  const match = String(raw).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return '';
  const [, year, month, day, hour, minute, second, utc] = match;
  if (!hour || !utc) return `${year}-${month}-${day}`;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function decodeText(value) {
  return String(value).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function plainDescription(value) {
  return String(value)
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `[${label.replace(/<[^>]*>/g, '').trim()}](${href})`)
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}

function descriptionSections(description) {
  const sections = { notes: '', complete: '', readings: '' };
  let active = '';
  for (const line of String(description || '').split('\n')) {
    const heading = line.match(/^\s*(Notes|Complete|Read):\s*(.*)$/i);
    if (heading) {
      active = { notes: 'notes', complete: 'complete', read: 'readings' }[heading[1].toLowerCase()];
      if (heading[2]) sections[active] += `${heading[2]}\n`;
    } else if (active) sections[active] += `${line}\n`;
  }
  return sections;
}

function linkedItems(section) {
  const items = [];
  for (const line of String(section || '').split('\n')) {
    const link = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i);
    if (!link) continue;
    items.push({ title: cleanText(line), url: link[2] });
  }
  return items;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/gi, '$1')
    .replace(/[*_`]/g, '').replace(/^\s*[-•]+\s*/, '')
    .replace(/\s+/g, ' ').trim();
}

function cleanSection(value) {
  return String(value || '').split('\n').map(cleanText).filter(Boolean).join(' ');
}

function overviewForTitle(title) {
  const topic = String(title || '').split(':').slice(1).join(':').trim().toLowerCase();
  const phase = String(title || '').split(':')[0].trim().toLowerCase();
  if (/cognitive/.test(topic)) return `A brief look at thinking, memory, and problem-solving during ${phase}.`;
  if (/psychosocial/.test(topic)) return `A brief look at relationships and social-emotional development during ${phase}.`;
  if (/biosocial/.test(topic)) return `A brief look at physical development, health, and biology during ${phase}.`;
  return `A concise introduction to ${topic || 'this class topic'} in ${phase || 'development'}.`;
}

function weekday(isoDate) { return new Date(`${isoDate}T12:00:00Z`).getUTCDay(); }
function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function stageForTitle(title) {
  const t = String(title || '').toLowerCase();
  if (/late adulthood|death|bereavement|affirmation of life/.test(t)) return 7;
  if (/emerging adulthood/.test(t)) return 5;
  if (/middle childhood/.test(t)) return 3;
  if (/early childhood/.test(t)) return 2;
  if (/adolescence/.test(t)) return 4;
  if (/first two years|infan|toddler/.test(t)) return 1;
  if (/\badulthood\b/.test(t)) return 6;
  if (/beginning|genetic|prenatal|birth/.test(t)) return 0;
  return null;
}

function jsonp(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `hdlCalendarFeed(${json});`;
}

module.exports = { readCalendarFeed, jsonp, parseIcs };
