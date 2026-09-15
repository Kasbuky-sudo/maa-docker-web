# MAA Docker Web

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | **한국어**

> ## ⚠️ 프로젝트 상태: 초기 개발 단계 — 아직 사용할 수 없습니다
>
> **운영 환경이나 일상 자동화에 사용하지 마세요.** 현재 활발히 개발 중이며 UI와 API가 예고 없이 바뀝니다. 또한 **실제 기기에서의 종단 간 태스크 실행은 한 번도 검증되지 않았습니다.**
> 현재 코드는 개발·실험·검증 용도로만 적합합니다. 자세한 내용은 [로드맵](#로드맵)과 [GitHub Issues](https://github.com/Kasbuky-sudo/maa-docker-web/issues)를 참고하세요.

[MAA(MaaAssistantArknights)](https://github.com/MaaAssistantArknights/MaaAssistantArknights) 공식
Linux 런타임을 **x86_64 / arm64** Docker 환경(NAS 친화)에서 동작하는 웹 관리 서비스로 감싼 프로젝트입니다.

이 저장소는 MAA 바이너리와 리소스를 **배포하지 않습니다**. 런타임은 MAA 공식 GitHub Release에서
다운로드하고 SHA-256으로 검증한 뒤 영구 볼륨에 저장합니다.

## 되는 것 / 안 되는 것

✅ **구현 및 검증 완료**

- 멀티 아키텍처 이미지와 컨테이너 배포 (`linux/amd64` + `linux/arm64`, CI가 ghcr에 게시)
- 공식 런타임 다운로드 / SHA-256 검증 / 압축 해제 / 상태 머신
- 실시간 로그 (WebSocket + 링 버퍼 + 파일 기록)
- 웹 UI(공식 [windows-ui](https://github.com/virtualvivek/windows-ui) 컴포넌트만 사용): 태스크 / 스케줄 / 설정 / Runtime / 로그 / 기능 대조 / 정보
- 태스크 카탈로그(JSON 기반 UI): 이성 소모, 기지 교대, 보상 수령, 상점 구매, 공개 모집, 로그라이크, 생식 연산
- MaaCore C API FFI 바인딩(koffi → `libMaaCore.so`): `AsstGetVersion` / `AsstSetUserDir` / `AsstLoadResource` / `AsstCreateEx` / 네이티브 콜백을 컨테이너 안에서 확인

❌ **아직 사용 불가 (중요)**

- **실제 기기에서 태스크를 끝까지 실행해 본 적이 없습니다** — 연결·전송·실행 경로는 코드에 있지만 통합 검증은 미실시
- 연결 설정은 ADB 주소 입력란 하나뿐: ADB 경로, 터치 모드, MuMu/LD 스크린샷 강화, 연결 프로필 미구현
- 데스크톱 12개 태스크 중 5개 미구현: 시작, 커스텀 태스크, 테마 변경, 창고 유지, 사용자 데이터 동기화
- 자동 전투(Copilot)와 도구함 페이지 전체 미구현
- 스케줄은 저장만 되고 서버 측 스케줄러가 없음. 큐 전체 동작(종료 후 작업 등)도 미구현
- **인증이 전혀 없습니다**: 신뢰할 수 있는 LAN에서만 사용하고 인터넷에 노출하지 마세요

전체 체크리스트는 웹 UI의 "기능 대조" 페이지에 있으며,
[`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json) (기준: MAA v6.17.5 데스크톱)을 데이터로 사용합니다.

## 구조

```text
브라우저 ──▶ maa-web (nginx) ──▶ maa-server (Node.js)
                                    ├── 런타임 관리(다운로드/검증/해제)
                                    ├── REST + WebSocket (로그·태스크·상태)
                                    └── runner ──koffi FFI──▶ libMaaCore.so ──ADB──▶ 기기
```

- `apps/maa-server`: API 서비스. 로컬 개발 시 프런트 정적 파일도 직접 제공
- `apps/maa-web`: [windows-ui](https://github.com/virtualvivek/windows-ui)(MIT) 컴포넌트로만 만든 정적 프런트
- `docker/`: `Dockerfile.server`(adb와 libatomic1 포함), `Dockerfile.web`

## 빠른 시작 (개발·검증 전용)

```bash
git clone https://github.com/Kasbuky-sudo/maa-docker-web.git
cd maa-docker-web
# deploy/ 의 docker-compose.yml 과 .env 사용
docker compose up -d
```

`http://<호스트>:8080` 접속. 첫 실행 시 약 220MB 런타임을 내려받으며 Runtime 페이지에서 수동 실행도 가능합니다.

이미지(멀티 아키, main 브랜치에서 자동 빌드):

```text
ghcr.io/kasbuky-sudo/maa-server
ghcr.io/kasbuky-sudo/maa-web
```

## 로드맵

- [x] M1: 런타임 컨테이너화 + 기본 API + 멀티 아키 이미지
- [x] M2: windows-ui 컴포넌트로 프런트 재구축 + 카탈로그 기반 UI
- [x] M3: MaaCore FFI 실행 파이프라인(koffi), 컨테이너 내 스모크 검증 완료
- [ ] M4: 연결 설정 완성 + **실제 기기 종단 간 검증**
- [ ] M5: 12개 태스크 전체 구현 + 큐 전체 동작
- [ ] M6: 스케줄러, 외부 알림, 다중 기기, 인증

## 문서

- [아키텍처](docs/architecture.md) · [배포](docs/deployment.md) · [API](docs/api.md) · [개발](docs/development.md) · [릴리스](docs/release.md)
- [서드파티 고지](NOTICE)

## 라이선스

이 저장소의 코드는 [MIT](LICENSE)로 배포됩니다. MAA 본체는 AGPL-3.0이며, 이 저장소는 그 바이너리나
리소스를 포함하지 않습니다. 런타임은 공식 릴리스에서 받으며 사용은 MAA 자체 라이선스를 따릅니다.
자세한 내용은 [NOTICE](NOTICE)를 참고하세요. 이 프로젝트는 MaaAssistantArknights 팀과 무관합니다.
