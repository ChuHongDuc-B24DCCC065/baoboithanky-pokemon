# Poké-Engine

A browser-based Pokémon-style game built with JavaScript, HTML, and CSS.

## About

Poké-Engine is a small browser game focused on exploring a tile-based map. The project combines the original DOM/CSS game engine and Socket.IO movement with Firebase Authentication and Cloud Firestore-backed player data.

## Features

- Move around the map with **WASD** or the **arrow keys**.
- Talk to NPCs and advance their dialogue with **Space** or **Enter**.
- Register, sign in, and sign out through the web interface.
- Save and restore the player's map position and facing direction using the backend and Firestore.
- Keep the existing Socket.IO multiplayer movement relay.

## Technology

- JavaScript on Node.js, with HTML and CSS for the browser game.
- jQuery 3.1.1 and Async.js 2.6.2 for existing game-engine scripts (loaded from a CDN).
- Express for HTTP routes and static files.
- Firebase Authentication and the Firebase Admin SDK.
- Cloud Firestore for player profiles and saved position data.
- Socket.IO 2.3 for multiplayer communication.
- `dotenv` for loading local environment variables.

The package manifest still includes `bcryptjs`, `mongoose`, `connect-mongo`, and `express-session` for older model/session files. They are not part of the active Firebase authentication and player-data flow.

## Requirements

- Node.js 22 or later.
- npm.
- A Firebase project for Production, or Firebase Auth and Firestore Emulators for local testing.
- Java and the Firebase CLI when running the Firestore Emulator.

## Getting started

1. Clone the repository and open its directory.
2. Install the locked dependencies:

   ```bash
   npm ci
   ```

3. Copy `.env.example` to `.env` and choose one Firebase configuration below. The example defaults to the local Emulators; for Production, replace the Emulator settings with the Production settings. Replace both example secrets with different random values of at least 32 characters.
4. Start the server:

   ```bash
   npm start
   ```

The server listens on port `3000` by default. Set `PORT` to use another port. Open `http://localhost:3000` in a browser; unauthenticated users are directed to the sign-in flow.

## Firebase configuration

The server loads `.env` at startup. `NODE_ENV` controls secure cookie behavior. Set `FIREBASE_ENV` to `emulator` or `production`; Production mode is also selected when `NODE_ENV=production`. Do not leave Emulator hosts set in Production.

### Local Emulators

The checked-in `firebase.json` configures Auth Emulator on `127.0.0.1:9099` and Firestore Emulator on `127.0.0.1:8080`. Configure both endpoints; the server rejects a partial Emulator configuration.

```dotenv
NODE_ENV=development
FIREBASE_ENV=emulator
FIREBASE_PROJECT_ID=demo-poke-engine
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
CSRF_SECRET=<random value with at least 32 characters>
IDEMPOTENCY_SECRET=<a different random value with at least 32 characters>
```

Start the local emulators separately with the Firebase CLI:

```bash
firebase emulators:start --project demo-poke-engine --only auth,firestore
```

The Firebase CLI is not an npm dependency in this project. Do not use a Production project for emulator tests.

### Production Firebase

Use a Firebase project ID and credentials for that same project. For the Admin SDK, either set `FIREBASE_SERVICE_ACCOUNT_KEY` to an absolute path to a Service Account JSON file (the code also accepts JSON text directly), or set `GOOGLE_APPLICATION_CREDENTIALS` to the path and let Application Default Credentials load it. Prefer a file outside the repository. The server checks the project ID in an explicit Service Account against `FIREBASE_PROJECT_ID` and rejects Emulator hosts in Production mode.

```dotenv
NODE_ENV=production
FIREBASE_ENV=production
FIREBASE_PROJECT_ID=<your-firebase-project-id>
FIREBASE_SERVICE_ACCOUNT_KEY=<absolute-path-to-service-account-json>
FIREBASE_WEB_API_KEY=<firebase-web-api-key>
CSRF_SECRET=<random value with at least 32 characters>
IDEMPOTENCY_SECRET=<a different random value with at least 32 characters>
```

`FIREBASE_WEB_API_KEY` is required by the backend's Production Firebase Authentication REST calls; it is not a replacement for Admin SDK credentials. Use `GOOGLE_APPLICATION_CREDENTIALS` instead of `FIREBASE_SERVICE_ACCOUNT_KEY` if you prefer ADC. `ALLOWED_ORIGINS` is optional and accepts a comma-separated list of additional allowed origins. `PORT` is optional and defaults to `3000`. In Emulator mode only, `GCLOUD_PROJECT` is an optional project-ID fallback when `FIREBASE_PROJECT_ID` is unset.

## Project structure

- `public/` — game pages, browser scripts, styles, and map assets.
- `public/js/engine/` — map, movement, dialogue, and game engine code.
- `public/js/auth/` — browser-side sign-in and registration flows.
- `server/` — Express routes, authentication services, Firebase setup, Socket.IO, and tests.
- `server/core/` — multiplayer movement relay.
- `server/tests/` — gameplay and Firebase test suites.
- `firebase.json` and `firestore.rules` — local Emulator settings and Firestore client rules.

## Tests

Run individual suites from the project root:

```bash
node server/tests/test_gameplay_persistence.js
node server/tests/test_firebase_auth_phase2.js
node server/tests/test_firebase_foundation.js
node server/tests/test_firebase_auth_emulator_integration.js
```

`test_firebase_auth_phase2.js` primarily covers unit, simulation, and environment-probe checks. The gameplay persistence, Firebase foundation, and Auth integration suites are Emulator-oriented; start the local Auth and Firestore Emulators first where required. These commands are instructions only; no test result is implied here.

## Security notes

- Never commit `.env`, Service Account JSON files, or credential values.
- Keep Service Account files outside the repository and do not share credentials in issues or chat.
- Use Firebase Emulators for local experiments. Avoid running exploratory tests against Production because they may affect real project data.

## License

Poké-Engine is released under the [MIT License](LICENSE).
