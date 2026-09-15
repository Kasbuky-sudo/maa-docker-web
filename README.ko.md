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

## 기능 대조 (MAA v6.17.5 데스크톱 기준)

이 표는 [`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json)에서 자동 생성되며, 웹 UI의 "기능 대조" 페이지와 같은 데이터를 사용합니다. 데이터 수정 후 `python3 scripts/gen-readme-parity.py`를 실행하세요 (CI가 불일치를 검사합니다).

<!-- parity:begin -->
집계: **완료 15** · 일부 10 · 미구현 26 · 데스크톱 전용 5 (총 56개)

### 실행 파이프라인 (모든 기능의 토대)

| 기능 | 상태 |
|---|---|
| MaaCore C API FFI (AsstCaller.h 전체) | ✅ 완료 |
| 리소스 로드 (AsstLoadResource) | ✅ 완료 |
| 기기 연결 (AsstAsyncConnect, ADB) | ✅ 완료 |
| 태스크 전송 (AsstAppendTask + 파라미터 매핑) | ✅ 완료 |
| 실행/정지 (AsstStart, AsstStop) | ✅ 완료 |
| 네이티브 콜백 로그 (태스크 체인/서브태스크) | ✅ 완료 |
| 스크린샷 / 실시간 화면 | ❌ 미구현 |

### 태스크 큐 · 12개 태스크 (데스크톱)

| 기능 | 상태 |
|---|---|
| 시작 (계정 전환/클라이언트 실행) | ❌ 미구현 |
| 이성 소모 | 🟡 일부 |
| 기지 교대 | 🟡 일부 |
| 보상 수령 | ✅ 완료 |
| 상점 (크레딧) | 🟡 일부 |
| 공개 모집 | 🟡 일부 |
| 로그라이크 | 🟡 일부 |
| 생식 연산 | 🟡 일부 |
| 커스텀 태스크 (interface.json) | ❌ 미구현 |
| 테마 변경 (인게임 스킨) | ❌ 미구현 |
| 창고 유지 (파밍 계획) | ❌ 미구현 |
| 사용자 데이터 동기화 | ❌ 미구현 |

### 태스크 큐 · 전체 기능

| 기능 | 상태 |
|---|---|
| 다중 인스턴스/복사/이름 변경/드래그 정렬 | ❌ 미구현 |
| 전체 선택 | ❌ 미구현 |
| 대기 후 정지 | ❌ 미구현 |
| 종료 후 동작 (게임/에뮬레이터 종료·시스템 종료·절전…) | ❌ 미구현 |
| 태스크 시간 초과 알림 | ❌ 미구현 |
| 오늘의 스테이지 안내 | ❌ 미구현 |
| 리소스 자동 재로드 | ❌ 미구현 |
| 예약 실행 | 🟡 일부 |

### 자동 전투 페이지 (Copilot)

| 기능 | 상태 |
|---|---|
| 작업 경로/미스터리 코드 인식 | ❌ 미구현 |
| 다중 작업 모드/일괄 가져오기 | ❌ 미구현 |
| 영상 인식 | ❌ 미구현 |
| 자동 편성/지원/신뢰도 보충/모듈 | ❌ 미구현 |
| 작업 공유/평가 | ❌ 미구현 |

### 도구함 페이지

| 기능 | 상태 |
|---|---|
| 공개 모집 인식 (태그/시간) | ❌ 미구현 |
| 창고 인식 (JSON 내보내기) | ❌ 미구현 |
| 오퍼레이터 인식 | ❌ 미구현 |
| 가챠/픽/미니게임 | ⚪ 데스크톱 전용 |

### 설정 (데스크톱 15개 그룹)

| 기능 | 상태 |
|---|---|
| 일반 설정 (클라이언트 종류) | ✅ 완료 |
| 연결 설정 | 🟡 일부 |
| 시작 설정 | ✅ 완료 |
| 타이머 설정 (프로필별 예약) | 🟡 일부 |
| 외부 알림 (SMTP/TG/Discord 등) | ❌ 미구현 |
| 원격 제어 (태스크 엔드포인트) | ❌ 미구현 |
| 단축키 설정 | ⚪ 데스크톱 전용 |
| 성능 설정 | ❌ 미구현 |
| 게임 설정 | ❌ 미구현 |
| GUI/배경 설정 | ⚪ 데스크톱 전용 |
| 버전 업데이트 설정 | 🟡 일부 |
| 프로필 관리 (다중 설정 전환) | ❌ 미구현 |
| 업적 | ⚪ 데스크톱 전용 |
| 문제 신고 | ⚪ 데스크톱 전용 |
| 정보 | ✅ 완료 |

### 인프라 (웹 버전 전용)

| 기능 | 상태 |
|---|---|
| 공식 런타임 다운로드/SHA-256 검증 | ✅ 완료 |
| Docker 배포 (nginx + node) | ✅ 완료 |
| 실시간 로그 스트림 (WebSocket) | ✅ 완료 |
| windows-ui 컴포넌트 체계 (공식 dist 동봉) | ✅ 완료 |
| 기능 대조 페이지 (본 섹션) | ✅ 완료 |
<!-- parity:end -->

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
