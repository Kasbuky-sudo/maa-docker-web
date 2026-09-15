# MAA for NAS

[简体中文](README.md) | **English** | [日本語](README.ja.md) | [한국어](README.ko.md)

> ## ⚠️ Project status: early development — not usable yet
>
> **Do not use this for production or for automating your daily game routine.** The project is under heavy development, the UI and API change without notice, and **a full end-to-end task run on a real device has never been completed**.
> This code is for development, experiments and tinkering only. See the [roadmap](#roadmap) and [GitHub Issues](https://github.com/Kasbuky-sudo/maa-docker-web/issues).

Wraps the official Linux runtime of [MAA (MaaAssistantArknights)](https://github.com/MaaAssistantArknights/MaaAssistantArknights)
into a Web-managed service that runs in **x86_64 / arm64** Docker environments (NAS friendly).

This repository **does not redistribute** MAA binaries or resources: the server downloads the runtime
from the official MAA GitHub release and verifies it with SHA-256 into a persistent volume.

## Versions and updates

| Version | Source | Notes |
|---|---|---|
| Server version | `apps/maa-server/package.json` | **Single source of truth**: the titlebar, settings and about page all read it from `GET /api/version`, so no page hardcodes a version any more |
| MAA runtime version | the runtime on disk (marker inside `data/runtime`) | Independently upgradable: "Check for updates" compares against the latest official release and only downloads **after you confirm**, verifying the official `assets[].digest` SHA-256 |

Upgrading the runtime does not require rebuilding the image: the server reads the marker on boot, and
replacing the runtime invalidates the cached MaaCore resources and drops the old session.

## What works / what does not

✅ **Implemented**

- Multi-arch images and container deployment (`linux/amd64` + `linux/arm64`, published to ghcr by CI)
- Official MAA runtime download / SHA-256 verification / extraction / state machine /
  **version comparison and upgrade against the official release**
- The web UI has been **rewritten** on official windows-ui components (official dist only) and is wired to the API:
  home, task queue (12 tasks with per-task settings), copilot, schedule, toolbox, logs, settings
- Backend wiring: runner status polling (2.5s), task config persistence, queue start/stop,
  logs (HTTP + live WebSocket), connection settings, system info, runtime and resource verification
- Connect test: `AsstAsyncConnect`; **verified against a real device (Meizu 16X, wireless ADB)**.
  The endpoint returns immediately and reports progress through status polling (gateway timeouts are gone),
  and a successful test **keeps the session** so "start" can reuse it
- MaaCore message ids verified one by one against the binding shipped with the runtime, and MaaCore's own
  messages are surfaced to the UI instead of a bare "timeout"
- Mobile layout: single-column stacking below 760px, drawer navigation (official `collapsed-float`),
  no horizontal overflow on any page

❌ **Not available yet**

- **No end-to-end task run on a real device yet**: the connection is verified, the download → execute → finish loop is not
- The recognition tools (recruitment / operator / depot) have no backend API: the UI mirrors the desktop
  layout using data from the official JSON, but the results are simulated locally and the page says so
- Copilot: no backend API; the page is a faithful mock and can parse job files locally
- Settings other than the connection group are not persisted (the `config.json` whitelist has 4 fields)
- Schedules are stored but there is **no server-side scheduler**
- **No authentication at all**: run it on a trusted LAN only

## Feature parity (vs the MAA desktop app; current baseline v6.17.5, the runtime itself upgrades in-app)

Generated from [`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json) — the same data that drives the "Feature parity" page in the Web UI. After editing the data run `python3 scripts/gen-readme-parity.py` (CI fails if this table is stale).

<!-- parity:begin -->
Summary: **30 done** · 6 partial · 20 missing · 5 desktop-only (of 61)

### Execution pipeline (the foundation)

| Feature | Status |
|---|---|
| MaaCore C API FFI (full AsstCaller.h) | ✅ Done |
| Resource loading (AsstLoadResource) | ✅ Done |
| Device connection (AsstAsyncConnect, ADB) | ✅ Done |
| Connection test (AsstAsyncConnect probe) | ✅ Done |
| Task dispatch (AsstAppendTask + param mapping) | ✅ Done |
| Start / stop (AsstStart, AsstStop) | ✅ Done |
| Native callback logs (task chain / subtask events) | ✅ Done |
| Screencap / live view | ❌ Missing |
| Parameter mapping (protocol-schema driven) | ✅ Done |
| Instance options (touch mode / client type) | ✅ Done |

### Task queue · 12 tasks (desktop list)

| Feature | Status |
|---|---|
| StartUp (wake & login) | ✅ Done |
| Fight (sanity farming) | 🟡 Partial |
| Infrast (base shift) | ✅ Done |
| Award (rewards) | ✅ Done |
| Mall (credit store) | ✅ Done |
| Recruit (auto) | ✅ Done |
| Roguelike (auto) | ✅ Done |
| Reclamation Algorithm | ✅ Done |
| Depot recognition | ✅ Done |
| Operator box recognition | ✅ Done |
| Switch theme | ✅ Done |
| Custom task | ✅ Done |

### Task queue · global actions

| Feature | Status |
|---|---|
| Multiple instances / copy / rename / drag-sort | ❌ Missing |
| Select all | ❌ Missing |
| Wait & stop | ❌ Missing |
| Post-action (exit game/emulator, shutdown, sleep…) | 🟡 Partial |
| Task timeout reminder | ❌ Missing |
| Today's stage hint | ❌ Missing |
| Auto reload resources | ❌ Missing |
| Scheduled runs | 🟡 Partial |

### Copilot page

| Feature | Status |
|---|---|
| Copilot path / mystery code | ❌ Missing |
| Multi-job mode / bulk import | ❌ Missing |
| Video recognition | ❌ Missing |
| Auto squad / support / low-trust fill / modules | ❌ Missing |
| Job sharing / rating | ❌ Missing |

### Toolbox page

| Feature | Status |
|---|---|
| Recruitment recognition (tags / timer) | ❌ Missing |
| Depot recognition (JSON export) | ❌ Missing |
| Operator recognition | ❌ Missing |
| Gacha / Peep / MiniGame | ⚪ Desktop-only |

### Settings (15 desktop groups)

| Feature | Status |
|---|---|
| General (client type) | ✅ Done |
| Connection settings | 🟡 Partial |
| Startup settings | ✅ Done |
| Timer settings (per-profile schedules) | 🟡 Partial |
| External notifications (SMTP/TG/Discord/…) | ❌ Missing |
| Remote control (task endpoints) | ❌ Missing |
| Hotkey settings | ⚪ Desktop-only |
| Performance settings | ❌ Missing |
| Game settings | ❌ Missing |
| GUI / background settings | ⚪ Desktop-only |
| Version update settings | 🟡 Partial |
| Profile management (multiple configs) | ❌ Missing |
| Achievements | ⚪ Desktop-only |
| Issue report | ⚪ Desktop-only |
| About | ✅ Done |

### Infrastructure (web-specific)

| Feature | Status |
|---|---|
| Official runtime download / SHA-256 verification | ✅ Done |
| Containerised deployment (nginx + node) | ✅ Done |
| Live log stream (WebSocket) | ✅ Done |
| windows-ui component system (vendored official dist) | ✅ Done |
| Feature parity page (this section) | ✅ Done |
| Task pages rebuilt against MaaWpfGui XAML | ✅ Done |
| Task catalog / param schema generated from the protocol doc | ✅ Done |
<!-- parity:end -->

## Architecture

```text
browser ──▶ maa-web (nginx) ──▶ maa-server (Node.js)
                                  ├── runtime management (download/verify/extract)
                                  ├── REST + WebSocket (logs, tasks, status)
                                  └── runner ──koffi FFI──▶ libMaaCore.so ──ADB──▶ device
```

- `apps/maa-server`: API service; also serves the static frontend for local development
- `apps/maa-web`: static frontend, built solely from [windows-ui](https://github.com/virtualvivek/windows-ui) (MIT) components
- `docker/`: `Dockerfile.server` (ships adb and libatomic1), `Dockerfile.web`

## Quick start (development only)

```bash
git clone https://github.com/Kasbuky-sudo/maa-docker-web.git
cd maa-docker-web
# use docker-compose.yml and .env from deploy/
docker compose up -d
```

Open `http://<host>:8080`. The first start downloads ~220 MB of runtime; you can also trigger it from the Runtime page.

Images (multi-arch, built automatically from main):

```text
ghcr.io/kasbuky-sudo/maa-server
ghcr.io/kasbuky-sudo/maa-web
```

## Roadmap

- [x] M1: runtime containerisation + base API + multi-arch images
- [x] M2: frontend rebuilt on windows-ui components + catalog-driven UI
- [x] M3: MaaCore FFI execution pipeline (koffi), smoke-verified in-container
- [ ] M4: complete connection settings + **end-to-end task verification on a real device**
- [ ] M5: fill in all 12 desktop tasks + queue-level actions
- [ ] M6: scheduler, external notifications, multi-device, authentication

## Documentation

- [Architecture](docs/architecture.md) · [Deployment](docs/deployment.md) · [API](docs/api.md) · [Development](docs/development.md) · [Release](docs/release.md)
- [Third-party notices](NOTICE)

## License and notices

This repository is released under [MIT](LICENSE). MAA itself is AGPL-3.0; no MAA binaries or resources are
bundled here. Users obtain the runtime from the official release and its use is governed by MAA's own license.
See [NOTICE](NOTICE). This project is not affiliated with the MaaAssistantArknights team.
