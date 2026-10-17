# Friendship Garden

A small, calm cooperative game for sharing optional conversation prompts, practical tips, favorite memories, and kind notes with a private circle. Shared activities grow the circle's garden; there are no timers, streaks, rankings, or penalties for taking a break.

## Prerequisites

- Node.js 18 or later (uses the built-in `fetch` API in tests and no installed packages)
- npm is not required

## Setup and run

1. Open a terminal in this folder.
2. Start the app with `node server.js`.
3. Visit <http://127.0.0.1:3000>.
4. To use a different local port, pass it as an argument (for example, `node server.js 3001`) or set `PORT` before starting the server.

The first circle creation saves data to `data/friendship-garden.json`. The file is created automatically. Circle members should share the invite code privately. The browser remembers the current circle on that browser; someone on another device can join with the invite code and a display name. The demo mode is read-only and does not create a circle or save its example content.

## Tests

Run the focused backend and persistence tests with:

```sh
node --test
```

The tests cover circle creation/joining, access checks, input validation, posting/editing/removing messages, reporting, and saving/loading progress.

## Privacy and hosting limits

This project intentionally uses local JSON storage and collects only display names, circle membership, optional activity text, and reports. There are no analytics, advertising, or external messaging services. User-submitted content is inserted into the page as text rather than interpreted as markup.

The local JSON file is **not secure multi-user hosting**. The included server binds to `127.0.0.1`, and its simple member identifiers are not an authentication system. JSON storage is suitable for trying the app on one trusted computer, not for hosting private groups on the public internet; concurrent processes, backups, access control, and data recovery are not handled as a production database would handle them. Before public hosting, use a maintained database with transactions and backups, strong account/session authentication and authorization, HTTPS, rate limiting, abuse-report handling, secure secret management, privacy and retention policies, and operational monitoring. A public deployment should also be reviewed for its local privacy and safeguarding requirements. Do not put sensitive personal, medical, financial, or crisis information in the garden. This is a friendly social activity, not a crisis service or a replacement for professional support.
