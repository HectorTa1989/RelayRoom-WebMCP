# ChatGPT Sites deployment boundary

RelayRoom is now packaged for a static ChatGPT Sites room frontend through `.openai/hosting.json`. This is intentionally a static deployment: the room bundle contains no secrets and cannot run the Express API, SQLite, ERPNext adapter, or Polar webhook receiver.

## Required deployment shape

Deploy these five HTTPS surfaces before publishing the room Site:

1. the API (`apps/api`), including the workspace database and server secrets;
2. the buyer portal;
3. the supplier portal;
4. the carrier portal; and
5. the room static Site (`apps/room/dist`).

The API and portals can remain on the existing Docker/Node host. The room Site can then be published from `apps/room/dist`. The origins are compiled into the room bundle, so set all four values before `npm run build:site`:

```powershell
$env:VITE_API_ORIGIN="https://api.example.com"
$env:VITE_BUYER_ORIGIN="https://buyer.example.com"
$env:VITE_SUPPLIER_ORIGIN="https://supplier.example.com"
$env:VITE_CARRIER_ORIGIN="https://carrier.example.com"
npm run build:site
```

The build fails when an origin is missing, uses localhost, or is not HTTPS. This prevents publishing a Site that appears to load but still calls a developer machine.

## Publishing and link

Create a Site for the repository, save a version from the validated source, and deploy that version. The Sites deployment result includes the live URL (`current_live_url`); the same value is shown in the Site dashboard. Use that URL as the shareable room link. If you change any `VITE_*` origin, rebuild and publish a new version.

## Important limitations

The three partner pages must be separately reachable because WebMCP tool discovery and iframe origin checks depend on their exact origins. Do not put `SESSION_SECRET`, provider keys, Polar secrets, or Gemini keys in `VITE_*` variables. Keep the API and provider adapter on the private Node deployment, behind HTTPS and server-side access controls.
