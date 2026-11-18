# Connecting Google Workspace (Gmail, Calendar, Sheets, Docs), Sign in with Google, and Clever

The head coach sets this up once, inside the app: **Integrations › Setup** (`/settings/integrations?tab=setup`) lists every step with the exact addresses to paste into Google Cloud (computed from the address you opened the app with, or `APP_URL` when it is set), and has fields for the Google **Client ID** and **Client secret**. The secret is stored encrypted in the database (AES-256-GCM, the same key as Google tokens) and is never shown again. After that, any staff member opens **Integrations › Connection**, clicks **Continue with Google**, and picks the services they want.

Environment variables still work as a fallback: if nothing is saved in the app, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are used.

What each feature does:

| Feature | What the app can do | Scopes requested |
|---|---|---|
| Gmail | Read emails with a label you choose (default "Team Calendar") and turn them into calendar drafts for review; add an "Imported" label to approved emails; optionally deliver program email (the outbox) | `gmail.readonly`, `gmail.send`, `gmail.modify` |
| Google Calendar | Push team events to a Google calendar (updates, cancellations and deletions follow) and import Google events into the review queue | `calendar` |
| Google Sheets | Import the roster and test maxes from a sheet; export roster, attendance and outstanding equipment to a new spreadsheet | `spreadsheets`, `drive.file` |
| Google Docs | Export a practice plan or a player's season report to a new Google Doc | `documents`, `drive.file` |

Each person turns on the services they want, and Google only asks for those scopes. Turning on another service later asks Google for just that one (incremental consent). Turning a service off stops the app using it straight away. `openid`, `email` and `profile` are always requested so the app can show which Google account is connected (email, name and photo).

You need: a Google account that can create Google Cloud projects (a school Workspace account or a personal Gmail account). Access to the Render dashboard is only needed for `TOKEN_KEY` and the persistent disk (step 5).

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
3. **Application type:** Web application. Name it `Program Manager`.
4. Open **Integrations › Setup** in the app in another tab. Copy each address from there with its **Copy** button:
   - **Authorized JavaScript origins:** the app address, for example `https://<render-app>.onrender.com`
   - **Authorized redirect URIs:** add both

     ```
     https://<render-app>.onrender.com/api/google/callback
     https://<render-app>.onrender.com/api/auth/google/callback
     ```

     The first is for connecting Gmail, Calendar, Sheets and Docs; the second is for **Sign in with Google**. The addresses must match exactly (https, no trailing slash). The app computes them from the address you opened it with (Render's `X-Forwarded-Proto` / `X-Forwarded-Host`), so open the app at the address staff use. If that is not possible, set `APP_URL`.
5. Click **Create**.
6. Paste the **Client ID** and **Client secret** into **Integrations › Setup › Google** and click **Save**, then **Check with Google**. A green message means Google accepted the pair.

The Desktop (Windows) app uses the same client: it opens Google in the system browser, so no extra client type or redirect URI is needed.

## 5. Server settings (Render)

Only these are needed; the Google client itself is configured in the app.

| Key | Value |
|---|---|
| `TOKEN_KEY` | a long random secret, for example the output of `openssl rand -hex 32`. Encrypts Google tokens and the saved Client secrets. |
| `DB_FILE` | a path on a Render persistent disk, for example `/var/data/app.db` |
| `TZ` | your time zone, for example `America/Chicago` |
| `APP_URL` | optional: `https://<render-app>.onrender.com` (no trailing slash). Only needed if the app cannot tell its own address, for example behind an unusual proxy. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional fallback when nothing is saved in the app |

About `TOKEN_KEY`: Google tokens and the saved Client secrets are stored encrypted (AES-256-GCM) with a key derived from `TOKEN_KEY`. If it is missing, the app generates a key, saves it in a `.token-key` file next to the database and logs a warning (and Integrations › Setup shows a warning); that works only if the database directory is on a persistent disk. Set `TOKEN_KEY` explicitly in production. If the key changes or is lost, stored tokens and secrets can no longer be read: paste the Client secret again and everyone reconnects.

Also make sure the database lives on a Render **persistent disk** (set `DB_FILE` to a path on the disk, for example `/var/data/app.db`); otherwise connections, drafts and everything else are lost on each deploy.

Timezone: event times are wall-clock times on the server. Set `TZ` in Render (for example `America/Chicago`) so the app, the email parser and pushed Google Calendar events use your local time.

## 6. Connect an account

1. Sign in to the app as a staff member and open **Integrations › Connection**.
2. Switch on the services you want and click **Continue with Google**. Approve the Google consent screen. The page then shows the connected account (email and photo) and a switch per service. If you unticked a service on Google's screen, the page offers **Allow on Google** to ask again. If access expires or is revoked, it offers **Reconnect with Google**.
   - In the Windows app, Google opens in your normal browser (Google does not allow sign-in inside app windows). The app shows a four-letter code; the browser page shows the same code and says "You can return to Program Manager". The app notices by itself within a couple of seconds.
3. In Gmail, create a label named **Team Calendar** (or pick another label on the **Gmail** tab) and apply it to schedule emails, by hand or with a Gmail filter (for example `from:athletics@yourschool.org`).
4. Click **Scan now** on the Gmail tab, or wait: the app checks every 10 minutes and notifies you when new drafts are waiting. Review each draft, pick the audience, and click **Approve** to add it to the calendar. Approved emails get an **Imported** label in Gmail.

### Sending program email through Gmail (optional)

By default the app only writes email to the outbox (Settings › Email outbox). To deliver it for real:

1. The staff member whose Gmail will send must connect with Gmail ticked and, on the Gmail tab, tick **The head coach may send program email from my Gmail** (not needed if it is the head coach's own account).
2. The head coach picks that account under **Program email** on the Gmail tab.

Only email queued after it is turned on is sent (older outbox entries stay simulated). Quiet hours still apply because delivery waits for each entry's delivery time. Gmail has daily sending limits (about 500 per day for personal accounts and 2,000 for Workspace), so large programs should use a Workspace account.

## 7. Sign in with Google (school SSO)

1. In **Integrations › Setup › Sign in with Google**, tick **Allow sign-in with Google**.
2. Optional: enter your Google Workspace for Education domain (for example `ridgeviewschools.org`). Then only accounts from that domain can sign in; Google also shows only school accounts in its picker. The app checks the domain in the ID token (`hd`), not just the picker.
3. Save. The sign-in page now shows **Continue with Google**.

How it works: OpenID Connect with the `openid email profile` scopes and the same client as above. A person signs in only when their **verified** Google email matches an **active** account in the program (any role). Nobody is created automatically: someone without a matching account sees "No Program Manager account uses this email address. Ask your head coach to add you with this address". An invited person who has not set a password yet can sign in this way; the invite is then marked used. Staff still enter the two-step code when two-step verification is on.

## 8. Clever

For districts that use Clever Instant Login:

1. In the Clever developer dashboard (<https://apps.clever.com/>), open your app and add the redirect URI shown in **Integrations › Setup › Clever** (`https://<render-app>.onrender.com/api/auth/clever/callback`).
2. Paste the app's **Client ID** and **Client secret**, tick **Allow sign-in with Clever**, and click **Save**. **Check with Clever** confirms the pair.
3. The sign-in page shows **Continue with Clever**. People are matched by the email on their Clever user record, the same way as Google.

Endpoints used: `https://clever.com/oauth/authorize`, `https://clever.com/oauth/tokens` (HTTP Basic client authentication) and `https://api.clever.com/v3.0/me` (then `/v3.0/users/{id}` for the email). For tests they can be overridden with `CLEVER_AUTH_URL`, `CLEVER_TOKEN_URL`, `CLEVER_API_BASE` (and `CLEVER_ME_URL`); `CLEVER_CLIENT_ID` / `CLEVER_CLIENT_SECRET` are an environment fallback like Google's.

## Troubleshooting

- **"Google is not set up yet"**: no Client ID and Client secret are saved in Integrations › Setup and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not set.
- **`redirect_uri_mismatch` from Google**: the redirect URIs in Google Cloud must equal the ones shown in Integrations › Setup exactly. If the app shows the wrong address (for example `http://` instead of `https://`), set `APP_URL`.
- **Check with Google says the pair was not accepted**: copy the Client ID and secret again; a secret shown once in Google Cloud can be reset there.
- **"No Program Manager account uses this email address"** at sign-in: the head coach adds or edits the person with that exact email (Staff and roles, or the roster).
- **"Use your school Google account to sign in"**: a domain is set under Sign in with Google and the account is not in it.
- **"Access blocked: app has not completed the Google verification process"**: the account is not listed as a test user (step 3.5), or the app is External and in production without verification.
- **"Google access was revoked or expired"**: in Testing mode, refresh tokens expire after 7 days; reconnect on the Connection tab. A user can also revoke access at <https://myaccount.google.com/permissions>.
- **"The sign-in link expired or did not match this session"**: the connect link is tied to the browser session that started it and is valid for 15 minutes; start again from the Connection tab.
