# LinkedIn — RelayRoom demo clip

Pair with `demo/video/relayroom-linkedin.mp4` (1080×1350, 4:5 — LinkedIn's tallest in-feed format).
The full 2:59 film is `demo/video/relayroom-demo.mp4` if you'd rather link it than embed the cut.

---

## Primary post — copy from here

A container is late. Friday's 480-unit delivery is short by 170 units.

What normally happens: someone opens three browser tabs — the buyer's ERP, the supplier's WMS, the carrier's TMS — and spends the afternoon copying numbers between companies. Then does it again to actually book it. Then unwinds it by hand when the carrier tender fails.

I built RelayRoom to show a different shape, using WebMCP.

The three portals stay three separate websites. Each one publishes a few narrow, typed capabilities — to one named origin, not to the world. A coordination room composes them.

One click:

→ It calls exactly one read tool on each partner's own site. Only normalised answers cross a boundary. No portal scraping, no shared backend, no partner data imported.

→ A deterministic solver computes every feasible recovery from those live results. The model then picks one and explains it — from a closed list of IDs. It can select. It cannot invent, and it cannot execute.

→ The plan: 310 units from the primary lot + 170 from backup, on a priority relay. 480 units protected, 12 hours early, +8% cost against a 10% cap.

The part I'd actually defend in a design review:

**The commit tools do not exist until a human approves.**

Not hidden. Not disabled. Not registered. Before approval, `commit_inventory_hold` isn't in `getTools()` — there is no name to call, from any code path, by any caller. Approve, discovery re-runs, and you can watch the tool count per origin tick from 2 to 3.

An approval gate you can see in a capability listing beats one you have to trust the frontend about.

And when it goes wrong, it goes wrong properly. Flip on the failure rehearsal: the supplier reservation commits, the carrier tender fails, the compensating release tool appears on the supplier origin and gets called, and the buyer commit is never attempted. You get a receipt listing all nine tool calls with the origin that ran each one.

Every organisation already built the hard part. The portal exists. The data is in it. The permissions are already modelled.

What was missing is a narrow, browser-native way for one page to ask another page to do a specific, named, typed thing — where the answer to "who is allowed to see this capability?" stays with the company that owns it.

That's WebMCP. The supply chain is just where it hurts most.

Full write-up and code in the comments. MIT.

#WebMCP #AI #SupplyChain #WebDevelopment #AIAgents #OpenAI

---

## First comment (post this yourself, right after)

Repo, full walkthrough and the long-form write-up:
→ github.com/HectorTa1989

Stack: WebMCP (`registerTool` / `getTools({ fromOrigins })` / `executeTool`), React + Vite across five origins, `node:sqlite` per partner, OpenAI Responses API with schema-constrained selection, Polar for entitlements, Playwright + Remotion for the demo film.

---

## Short variant — if you want a tighter feed post

Three companies. One broken shipment. Zero copy-paste between portals.

RelayRoom lets a buyer, a supplier and a carrier resolve a supply-chain exception together — while staying three completely separate websites with their own state, their own APIs and their own origin allowlists.

One click discovers the smallest safe capability on each partner origin, computes a feasible recovery from live results, and shows the plan.

Then it stops.

The commit tools aren't hidden before approval — they're *not registered*. There's no name to call. Approve once and they appear, the commits land inside the company that owns each one, and if the carrier fails, the completed supplier step is reversed automatically.

Built on WebMCP. Demo and code below. MIT.

#WebMCP #AIAgents #SupplyChain #OpenAI

---

## Posting notes

- **Format**: upload the 4:5 MP4 as native LinkedIn video — native video outranks a link to a hosted player.
- **Captions**: the clip is fully captioned on-screen, so it reads with sound off, which is how most of the feed watches it.
- **Links**: keep the repo link in the first comment, not the post body.
- **Hook**: the first two lines are what shows before "…see more" — they're written to work alone.
- **Thumbnail**: `demo/assets/stills/linkedin-frame.png` is a clean frame if you want to set one
  manually; `linkedin-title.png` is the opening card.
