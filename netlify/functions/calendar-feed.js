const { readCalendarFeed, jsonp } = require('../../calendar-feed/ical-feed.cjs');

exports.handler = async function (event) {
  if ((event.queryStringParameters || {}).callback !== 'hdlCalendarFeed') {
    return { statusCode: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found' };
  }
  try {
    const payload = await readCalendarFeed();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      body: jsonp(payload)
    };
  } catch (_) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
      body: jsonp({ ok: false, events: [] })
    };
  }
};
