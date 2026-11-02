# ThroughLens CAMBOT — Google Sheets Camera Catalogue

This build combines the responsive ThroughLens camera catalogue, Google Sheets import/write-back support (write-back requires server credentials), customer-interest capture, admin activity history, duplicate warnings, and locally bundled camera photos.

## Run locally
1. Install Node.js 20 or newer.
2. Extract this ZIP.
3. Open a terminal in the extracted folder.
4. Run `npm install`
5. Run `npm start`
6. Open `http://localhost:3000` for the public catalogue.
7. Open `http://localhost:3000/admin` for admin access.

## Admin access
The admin page supports adding a camera, editing its details and image URL, marking it Available / Sold / Unavailable / Needs confirmation, and removing a listing from the public catalogue.

- Default local-development password: `ChangeMe-CAMBOT-2026!`
- **Before using this on a network or hosting it publicly, set the `CAMBOT_ADMIN_PASSWORD` environment variable to a strong private password.** Do not share the password or commit it to a public repository.
- On Windows PowerShell, for the current terminal session, set it before starting the server: `$env:CAMBOT_ADMIN_PASSWORD="your-strong-private-password"` then `npm start`.
- Admin sessions are held in server memory and end when the server restarts.
- Admin-added listings, admin overrides, and removed/hidden sheet listings are saved in `data/admin-data.json`.

**Google Sheets vs admin edits:** Google Sheets remains the source for sheet-managed rows. New rows added to the sheet appear after sync. Admin changes to sheet rows are saved as local overrides on this server and do not write back to Google Sheets. Admin-added cameras are local to this CAMBOT server; to have them managed by Sheets instead, add a row to the spreadsheet. Back up `data/admin-data.json` if you need to preserve admin changes when moving the project.

## Google Sheets connection
The app is configured for the supplied spreadsheet ID. It fetches the first sheet tab as CSV and refreshes approximately every 60 seconds.

**The spreadsheet must be viewable without a Google sign-in by the server.** In Google Sheets, open Share and set General access to **Anyone with the link — Viewer**. If your organization does not allow this, publish the inventory tab to the web or configure a server-side `GOOGLE_SHEET_CSV_URL`. Do not put private service-account keys or other credentials in browser code.

Optional environment variables:
- `GOOGLE_SHEET_ID` — spreadsheet ID (defaults to the supplied sheet)
- `GOOGLE_SHEET_GID` — tab ID, only if you need a specific tab
- `GOOGLE_SHEET_CSV_URL` — full CSV export URL, if you publish a specific tab
- `SHEET_SYNC_INTERVAL_MS` — refresh interval; minimum 30 seconds, default 60 seconds
- `PORT` — server port
- `GOOGLE_SHEET_TAB` — exact spreadsheet tab name for API write-back (defaults to `Sheet1`; set it to the actual tab name)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the full service-account JSON string (server only; never place this in frontend code or commit it)
- `CAMBOT_INSTAGRAM_URL` — official Instagram profile or DM destination URL
- `CAMBOT_MESSENGER_URL` — Facebook Messenger page chat URL, usually `https://m.me/YourPageUsername`
- `CAMBOT_WHATSAPP_URL` — optional WhatsApp chat URL

## Sheet columns
The importer recognizes the current column names `Camera model`, `Presyo`, `Issues / kondisyon`, `Inclusions`, `Status`, and `LINK`, plus common English aliases. A `Brand` and/or `Condition` column is also supported.

For future listings, add a **Photo URL** column and paste a direct, publicly viewable image URL. Google Drive file links are converted to image-view URLs where possible. The image file must be accessible to visitors; private Drive files will not render. If no Photo URL is provided, CAMBOT tries to match the model to a bundled camera photo.

## Photos included
The supplied `THROUGHLENS.zip` contained screenshots of Instagram camera posts. The app includes cropped camera-photo images and maps confidently recognized model names to the local inventory. The bundled starter inventory has 83 of 86 rows matched to a camera photo; 3 rows remain placeholders because the uploaded screenshots show different or unclear model names. Those cards can be completed by adding a Photo URL in the sheet. No seller-post images are fetched or scraped automatically.

## Enable two-way Google Sheets sync
1. In Google Cloud Console, create/select a project and enable **Google Sheets API**.
2. Create a service account and generate its JSON key. Keep the key private.
3. Share the spreadsheet with the service account's `client_email` and grant **Editor** access.
4. Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the complete JSON object as a server environment variable, and set `GOOGLE_SHEET_TAB` to the exact tab name containing the camera list.
5. Restart CAMBOT. `/api/sync-status` will report `writeBackConfigured: true` when the JSON setting exists. Test with a non-critical row first and confirm the intended tab/columns.

PowerShell example (paste your private JSON locally; do not send it in chat): `$env:GOOGLE_SERVICE_ACCOUNT_JSON = Get-Content .\service-account.json -Raw; $env:GOOGLE_SHEET_TAB = "YourTabName"; npm start`. Keep `service-account.json` out of Git and public folders. If the service account is not shared as Editor, or if the tab name/headers are wrong, write-back will fail and the error will be returned to the admin action. Supported headers include Camera model, Brand, Presyo/Price, Issues / kondisyon, Condition, Inclusions, Status, LINK, Photo URL/Image URL, and Notes.

## Customer interest and social messages
- A camera detail panel offers **Interested in buying?** with Facebook Messenger and Instagram options for listings not marked Sold/Unavailable.
- Clicking records an interest in `data/customer-interests.json` and the Activity Log, then opens the configured social destination in a new tab.
- Set `CAMBOT_MESSENGER_URL` and `CAMBOT_INSTAGRAM_URL` to your real business page destinations. The app cannot silently send an Instagram/Facebook message or guarantee prefilled text from an ordinary website; the customer must send the message themselves. The admin sees the interest click and can mark it New, Contacted, Converted, or Not interested. This is not a payment/order confirmation system.

## Sync and fallback behavior
- The catalogue reads the Google Sheet as its primary source when the CSV export is accessible.
- New rows and edits should appear after the next refresh (normally within about 60 seconds).
- The status line under the filters reports whether Google Sheets is connected.
- If Google Sheets is private, unavailable, or the headers cannot be recognized, the site falls back to its bundled local inventory rather than showing an empty catalogue. Check `/api/sync-status` for the latest sync result.
- If service-account write-back is not configured, sheet-row edits remain local overrides and admin additions remain local. Use the spreadsheet for authoritative changes until write-back is configured.

## Admin features
- Activity log for inventory changes and customer-interest clicks
- Duplicate warning for matching brand/model (confirm to add a separate unit)
- Customer-interest inbox with status tracking
- Optional Google Sheets API write-back when service-account credentials are configured

## Catalogue features
- Search by brand, model, condition, known issues, and inclusions
- Filter by brand, price range, and listing status (Available, Sold, Unavailable, Needs confirmation)
- Sort by price or brand
- Responsive camera cards and a details modal
- Original seller links, camera photos, known issues, inclusions, and status
- Availability disclaimer so listings marked for review are not presented as confirmed available

## Important
Google Sheets synchronization can only be confirmed against the live spreadsheet when the running app can access its CSV export. If the share settings block public viewing, the catalogue will display its local fallback and show a sync warning. This is a catalogue prototype, not a payment or checkout system.
