# HDL public course-calendar feed

The site reads the public PSYC 243 calendar iCal feed through a same-origin Netlify Function. The function fetches the calendar server-side, returns only the next two scheduled Tuesday/Thursday class meetings plus the current lifespan stage, and caches the result for five minutes. It does not request Google Calendar account permissions and does not return attendee data.

The calendar cards preserve linked note resources, assigned reading text, and linked assignment resources from each event description. Concept practices and unlinked completion items are omitted. Cards link to the matching Google Calendar event; note and assignment links remain separate controls inside the card.

The local design preview uses `calendar-preview-feed.js`, a point-in-time snapshot generated from the same public iCal feed. The downloadable `HDL-calendar-preview.html` embeds that snapshot so it can be reviewed without publishing or reaching the live feed. The published site uses `/.netlify/functions/calendar-feed` and retrieves fresh calendar data automatically.

The iCal address is public, as configured by the instructor. Keep private notes and student information out of the calendar.
