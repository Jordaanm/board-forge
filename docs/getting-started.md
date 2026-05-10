# Getting Started

Virtual Table is a browser-based virtual tabletop. Each room is a real-time physics sandbox where players can spawn boards, dice, cards, tokens, and decks, and a host can author custom games with a built-in scripting environment. Networking is peer-to-peer over WebRTC, with a small WebSocket server used only for signaling and ICE configuration.

## Prerequisites

- **Node.js** 18 or newer for the client (Vite + React + TypeScript).
- **Bun** for the signaling server (the server's `dev` and `build` scripts use `bun`).
- A modern Chromium- or Firefox-based browser. WebRTC data channels and `crypto.randomUUID` are required.

## Installing dependencies

This is an npm workspace monorepo. From the repository root:

```sh
npm install
```

That installs both `@board-together/client` and `@board-together/server` along with the dev dependencies used by the end-to-end tests.

## Running the app

The repository ships a single command that runs the client and the server concurrently:

```sh
npm run dev
```

This starts:

- the **client** dev server (Vite) on `http://localhost:5173`
- the **signaling server** on `http://localhost:3001` (also serves the `ws://localhost:3001` WebSocket used by the WebRTC signaling exchange)

If you only want one half running, use `npm run dev:client` or `npm run dev:server`.

The signaling server reads a few environment variables, all optional:

- `PORT` — port to listen on (defaults to `3001`).
- `MAX_ROOM_PEERS` — hard cap on simultaneous peers in a room (defaults to `16`).
- `STUN_URLS` — comma-separated list of STUN URLs (defaults to `stun:stun.l.google.com:19302`).
- `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` — optional TURN credentials. Without TURN, peers behind symmetric NAT will fail to connect.

## Creating a room

Open `http://localhost:5173` in your browser. The landing page shows two things:

1. A **Create Room** button.
2. A list of **Open Rooms** that the signaling server is currently aware of, refreshed every few seconds.

Clicking **Create Room** generates a fresh room id, navigates to `?room=<id>&host=1`, and makes you the host of that room. The host action bar appears at the top of the screen and the share link is shown in the bottom-center until the first guest connects.

## Joining a room

There are two ways to join a room as a guest:

- Click **Join** next to a room in the **Open Rooms** list on the landing page.
- Open a share link of the form `http://localhost:5173/?room=<id>` directly. (The host's URL contains `&host=1`; strip that parameter or follow the host's share link.)

Joining is anonymous — there is no sign-up or login. You receive a peer id automatically, the room state replicates from the host, and the connection-status pill at the top of the screen transitions from **Waiting for peer…** to **Connected** once the peer-to-peer channel is open. If the room is already at the peer cap the status pill will say **Room is full**.

## Once you're in

By default every player has a free-orbit camera. Right-click drag to orbit, middle-click drag to pan, mouse wheel to zoom. Left-click is reserved for the active tool — use the **Toolbar** in the bottom-left corner (or the number-key shortcuts `1`, `2`, `3`) to switch between Grab, Ping, and Flick.

Once seated, your hand panel appears at the bottom of the screen and your seat-coloured cursor is visible to the other players.

For details on player controls see [controls.md](./controls.md). For host responsibilities and the action bar see [hosting.md](./hosting.md). To author a custom game in JavaScript see [scripting.md](./scripting.md).
