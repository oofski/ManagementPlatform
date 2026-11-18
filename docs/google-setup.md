# Connecting Google Workspace (Gmail, Calendar, Sheets, Docs)

This guide sets up the Google integration for an app deployed on Render. Once it is done, any staff member can open **Integrations** (`/settings/integrations`) and connect their own Google account.

What each feature does:

| Feature | What the app can do | Scopes requested |
|---|---|---|
| Gmail | Read emails with a label you choose (default "Team Calendar") and turn them into calendar drafts for review; add an "Imported" label to approved emails; optionally deliver program email (the outbox) | `gmail.readonly`, `gmail.send`, `gmail.modify` |
| Google Calendar | Push team events to a Google calendar (updates, cancellations and deletions follow) and import Google events into the review queue | `calendar` |
| Google Sheets | Import the roster and test maxes from a sheet; export roster, attendance and outstanding equipment to a new spreadsheet | `spreadsheets`, `drive.file` |
| Google Docs | Export a practice plan or a player's season report to a new Google Doc | `documents`, `drive.file` |

Each person picks the features they want, and Google only asks for those scopes. `openid` and `email` are always requested so the app can show which Google account is connected.

You need: a Google account that can create Google Cloud projects (a school Workspace account or a personal Gmail account), and access to the Render dashboard for the app.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in.
2. Open the project picker at the top of the page and click **New project**.
3. Name it (for example `Ridgeview Football App`), choose your organization if you have one, and click **Create**.
4. Make sure the new project is selected in the project picker for the rest of these steps.

## 2. Enable the APIs

1. Go to **APIs & Services › Library**.
2. Search for and **Enable** each of these:
   - **Gmail API**
   - **Google Calendar API**
   - **Google Sheets API**
   - **Google Docs API**
   - **Google Drive API** (needed to create new Docs and Sheets)

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services › OAuth consent screen** (in newer consoles: **Google Auth Platform › Branding / Audience / Data access**).
2. **User type:**
   - **Internal** if you use a Google Workspace domain and every staff member has an account in it. Internal apps skip Google's verification.
   - **External** for personal Gmail accounts or mixed domains.
3. Fill in the app name (for example `Ridgeview Football`), a support email, and the developer contact email. Add your Render domain (`onrender.com` or your custom domain) under **Authorized domains**.
4. **Scopes:** add the scopes from the table above:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.file`
   - `openid` and `.../auth/userinfo.email`
5. **Publishing status: Testing.** Under **Test users**, add the Google address of every staff member who will connect (up to 100). Only test users can connect while the app is in Testing mode.

> **Important about Gmail scopes.** `gmail.readonly` and `gmail.modify` are *restricted* scopes, and `gmail.send` and `calendar` are *sensitive*. For an External app in Testing mode they work for your listed test users, but Google shows an "unverified app" warning and refresh tokens for Testing-mode apps expire after 7 days (staff would need to reconnect weekly). Before releasing widely (Publishing status: **In production**), the app must pass Google's OAuth verification, and restricted Gmail scopes also require a security assessment. An **Internal** app in a Workspace domain avoids both. If you cannot do either yet, staff can still connect only Calendar, Sheets and Docs.

## 4. Create the OAuth client

1. Go to **APIs & Services › Credentials** (or **Google Auth Platform › Clients**).
2. Click **Create credentials › OAuth client ID**.
3. **Application type:** Web application. Name it `Render`.
4. **Authorized JavaScript origins:** `https://<render-app>.onrender.com`
5. **Authorized redirect URIs:** add exactly

   ```
   https://<render-app>.onrender.com/api/google/callback
   ```

   Replace `<render-app>` with your Render service name. If you use a custom domain, use that domain instead (it must match `APP_URL` below exactly, including `https` and no trailing slash).
6. Click **Create** and copy the **Client ID** and **Client secret**.

## 5. Set the environment variables in Render

1. Open the Render dashboard, select the web service, and go to **Environment**.
2. Add:

   | Key | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | the Client ID from step 4 |
   | `GOOGLE_CLIENT_SECRET` | the Client secret from step 4 |
   | `APP_URL` | `https://<render-app>.onrender.com` (no trailing slash) |
   | `TOKEN_KEY` | a long random secret, for example the output of `openssl rand -hex 32` |

3. Save. Render redeploys the service.

About `TOKEN_KEY`: Google tokens are stored encrypted (AES-256-GCM) with a key derived from `TOKEN_KEY`. If it is missing, the app generates a key, saves it in a `.token-key` file next to the database and logs a warning; that works only if the database directory is on a persistent disk. Set `TOKEN_KEY` explicitly in production. If the key changes or is lost, stored tokens can no longer be read and everyone must reconnect.

Also make sure the database lives on a Render **persistent disk** (set `DB_FILE` to a path on the disk, for example `/var/data/app.db`); otherwise connections, drafts and everything else are lost on each deploy.

Timezone: event times are wall-clock times on the server. Set `TZ` in Render (for example `America/Chicago`) so the app, the email parser and pushed Google Calendar events use your local time.

## 6. Connect an account

1. Sign in to the app as a staff member and open `https://<render-app>.onrender.com/settings/integrations`.
2. On **Connection**, tick the features you want and click **Connect Google**. Approve the Google consent screen.
3. In Gmail, create a label named **Team Calendar** (or pick another label on the **Gmail** tab) and apply it to schedule emails, by hand or with a Gmail filter (for example `from:athletics@yourschool.org`).
4. Click **Scan now** on the Gmail tab, or wait: the app checks every 10 minutes and notifies you when new drafts are waiting. Review each draft, pick the audience, and click **Approve** to add it to the calendar. Approved emails get an **Imported** label in Gmail.

### Sending program email through Gmail (optional)

By default the app only writes email to the outbox (Settings › Email outbox). To deliver it for real:

1. The staff member whose Gmail will send must connect with Gmail ticked and, on the Gmail tab, tick **The head coach may send program email from my Gmail** (not needed if it is the head coach's own account).
2. The head coach picks that account under **Program email** on the Gmail tab.

Only email queued after it is turned on is sent (older outbox entries stay simulated). Quiet hours still apply because delivery waits for each entry's delivery time. Gmail has daily sending limits (about 500 per day for personal accounts and 2,000 for Workspace), so large programs should use a Workspace account.

## Troubleshooting

- **"Google is not set up on this server yet"**: one of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or `APP_URL` is missing; the message names which.
- **`redirect_uri_mismatch` from Google**: the redirect URI in step 4 must equal `APP_URL` + `/api/google/callback` exactly.
- **"Access blocked: app has not completed the Google verification process"**: the account is not listed as a test user (step 3.5), or the app is External and in production without verification.
- **"Google access was revoked or expired"**: in Testing mode, refresh tokens expire after 7 days; reconnect on the Connection tab. A user can also revoke access at <https://myaccount.google.com/permissions>.
- **"The sign-in link expired or did not match this session"**: the connect link is tied to the browser session that started it and is valid for 15 minutes; start again from the Connection tab.
