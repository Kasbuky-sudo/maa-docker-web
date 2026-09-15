# MAA Docker Web

[简体中文](README.md) | **English** | [日本語](README.ja.md) | [한국어](README.ko.md)

> ## ⚠️ Project status: early development — not usable yet
>
> **Do not use this for production or for automating your daily game routine.** The project is under heavy development, the UI and API change without notice, and **a full end-to-end task run on a real device has never been completed**.
> This code is for development, experiments and tinkering only. See the [roadmap](#roadmap) and [GitHub Issues](https://github.com/Kasbuky-sudo/maa-docker-web/issues).

Wraps the official Linux runtime of [MAA (MaaAssistantArknights)](https://github.com/MaaAssistantArknights/MaaAssistantArknights)
into a Web-managed service that runs in **x86_64 / arm64** Docker environments (NAS friendly).

This repository **does not redistribute** MAA binaries or resources: the server downloads the runtime
from the official MAA GitHub release and verifies it with SHA-256 into a persistent volume.

## What works / what does not

✅ **Implemented and verified**

- Multi-arch images and containerised deployment (`linux/amd64` + `linux/arm64`, published to ghcr by CI)
- Official runtime download / SHA-256 verification / extraction / state machine
- Live logs (WebSocket + ring buffer + file output)
- Web UI built entirely on official [windows-ui](https://github.com/virtualvivek/windows-ui) components: Tasks / Schedule / Settings / Runtime / Logs / Feature parity / About
- Task catalog (JSON-driven UI): Fight, Infrast, Award, Mall, Recruit, Roguelike, Reclamation
- MaaCore C API FFI binding (koffi → `libMaaCore.so`): `AsstGetVersion` / `AsstSetUserDir` / `AsstLoadResource` / `AsstCreateEx` / native callback verified inside the container

❌ **Not usable yet (important)**

- **No task has ever run end-to-end on a real device** — the code path exists, but no integration test was done
- Connection settings are a single ADB address field: no ADB path, touch mode, MuMu/LD screencap enhancement, connection profile
- 5 of the 12 desktop tasks are missing: StartUp, Custom, SwitchTheme, DepotMaintain, UserDataUpdate
- Copilot and Toolbox pages are entirely missing
- Scheduling only stores entries; there is no server-side scheduler. Queue-level actions (post-action, timeout reminders) are missing
- **No authentication at all**: run it on a trusted LAN only, never expose it to the internet

The full checklist lives in the "Feature parity" page of the Web UI, backed by
[`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json) (baseline: MAA v6.17.5 desktop).

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
