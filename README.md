# TravelMate

TravelMate is a responsive trip-planning app built with React, Tailwind CSS, and a Node.js API. Its SQLite database is created automatically at `data/travelmate.sqlite` on the first run; the database directory is not checked into source control.

## Run locally

Requires Node.js 22.13 or newer (the server uses Node's built-in `node:sqlite`) and npm.

```powershell
npm.cmd install
```

In one terminal, start the API:

```powershell
npm.cmd run server
```

In another terminal, start the React app:

```powershell
npm.cmd run dev
```

Open the local URL printed by Vite (normally http://localhost:5173). New visitors start on the login/register screen; returning signed-in users go straight to the home page, and guests can choose **Explore first**. To use the built-in production server instead, run `npm.cmd run build` and then `npm.cmd start`. The production server serves the built app and API from the same origin; set `PORT` and `DATABASE_PATH` as needed.

## Administrator

Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (at least 12 characters) before starting the API. On startup, TravelMate creates the administrator account or promotes the matching existing account. New registrations are always regular users. Example for the current PowerShell session:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "use-a-unique-password-of-at-least-12-characters"
npm.cmd run server
```

Keep the administrator password private. Passwords are stored as salted scrypt hashes; sessions use random, `HttpOnly`, `SameSite=Lax` cookies. Shared itinerary links are read-only and use unguessable tokens. They expose only the trip details, itinerary, budget, and expenses the trip owner chose to share by creating the link.

## Features

- Account registration, login, logout, and editable profile.
- Destination search and filters for category, country, budget, and popularity.
- Personal wishlists, persistent trips, companions, date validation, and trip editing/deletion.
- Day-by-day itinerary and expense CRUD, budget totals, and remaining-balance display.
- Read-only trip sharing, print-friendly itinerary pages, and responsive dashboards.
- Administrator-only user and destination management, category management, and platform statistics.

Destination photos are served from Unsplash and require an internet connection. If a photo cannot load, the app displays an accessible fallback.

Password-reset links expire after 15 minutes and are single-use. For local demos, the API returns a development-only reset token that is shown in the reset form. For deployment, configure `PASSWORD_RESET_WEBHOOK_URL` to an HTTPS endpoint you control; TravelMate sends it a JSON `POST` containing `{ "to", "resetUrl", "expiresInMinutes" }` for delivery through your chosen email provider. The API response remains generic to avoid revealing whether an email has an account.

## Validate

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```
