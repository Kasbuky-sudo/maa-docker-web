#!/usr/bin/env python3
"""Generate the feature-parity tables in README.md / README.en.md / README.ja.md / README.ko.md
from apps/maa-server/src/feature-parity.json — the same data that drives the Web UI page.

Usage:
    python3 scripts/gen-readme-parity.py           # rewrite the READMEs in place
    python3 scripts/gen-readme-parity.py --check   # exit 1 if the READMEs are stale (CI)

The README files must contain the markers:
    <!-- parity:begin -->  ... generated content ...  <!-- parity:end -->
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "apps" / "maa-server" / "src" / "feature-parity.json"
BEGIN, END = "<!-- parity:begin -->", "<!-- parity:end -->"

# zh key -> (en, ja, ko)
T = {
    # sections
    "执行管线（一切功能的地基）": ("Execution pipeline (the foundation)", "実行パイプライン（すべての基盤）", "실행 파이프라인 (모든 기능의 토대)"),
    "任务队列 · 12 种任务（桌面端任务列表）": ("Task queue · 12 tasks (desktop list)", "タスクキュー · 12 タスク（デスクトップ版）", "태스크 큐 · 12개 태스크 (데스크톱)"),
    "任务队列 · 全局功能": ("Task queue · global actions", "タスクキュー · 全体機能", "태스크 큐 · 전체 기능"),
    "自动战斗页（Copilot · 作业）": ("Copilot page", "自動戦闘ページ（Copilot）", "자동 전투 페이지 (Copilot)"),
    "小工具页（Toolbox）": ("Toolbox page", "ツールボックスページ", "도구함 페이지"),
    "设置（桌面端 15 组）": ("Settings (15 desktop groups)", "設定（デスクトップ版 15 グループ）", "설정 (데스크톱 15개 그룹)"),
    "基础设施（Web 版自有）": ("Infrastructure (web-specific)", "インフラ（Web 版独自）", "인프라 (웹 버전 전용)"),
    # pipeline
    "MaaCore C 接口 FFI（AsstCaller.h 全套）": ("MaaCore C API FFI (full AsstCaller.h)", "MaaCore C API FFI（AsstCaller.h 一式）", "MaaCore C API FFI (AsstCaller.h 전체)"),
    "资源加载 AsstLoadResource": ("Resource loading (AsstLoadResource)", "リソース読み込み (AsstLoadResource)", "리소스 로드 (AsstLoadResource)"),
    "设备连接 AsstAsyncConnect（ADB）": ("Device connection (AsstAsyncConnect, ADB)", "デバイス接続 (AsstAsyncConnect, ADB)", "기기 연결 (AsstAsyncConnect, ADB)"),
    "任务下发 AsstAppendTask + 参数映射": ("Task dispatch (AsstAppendTask + param mapping)", "タスク投入 (AsstAppendTask + パラメータ変換)", "태스크 전송 (AsstAppendTask + 파라미터 매핑)"),
    "执行/停止（AsstStart/AsstStop）": ("Start / stop (AsstStart, AsstStop)", "実行・停止 (AsstStart, AsstStop)", "실행/정지 (AsstStart, AsstStop)"),
    "原生回调日志（任务链/子任务事件）": ("Native callback logs (task chain / subtask events)", "ネイティブログ（タスクチェーン・サブタスク）", "네이티브 콜백 로그 (태스크 체인/서브태스크)"),
    "执行截图 / 实时画面": ("Screencap / live view", "スクリーンショット・ライブ画面", "스크린샷 / 실시간 화면"),
    "连接测试（AsstAsyncConnect 探活）": ("Connection test (AsstAsyncConnect probe)", "接続テスト（AsstAsyncConnect 探活）", "연결 테스트 (AsstAsyncConnect 확인)"),
    "一键长草工作台（三栏 + 运行实况 + 状态栏）": ("One-click idle workbench (3 columns + live panel + status bar)", "一括放置ワークベンチ（3 カラム + 実況 + ステータスバー）", "원클릭 방치 워크벤치 (3열 + 실시간 패널 + 상태 표시줄)"),
    # tasks
    "开始唤醒 StartUp": ("StartUp (wake & login)", "起動（ログイン処理）", "시작 (로그인 처리)"),
    "理智作战 Fight": ("Fight (sanity farming)", "理性消費", "이성 소모"),
    "基建换班 Infrast": ("Infrast (base shift)", "基地シフト", "기지 교대"),
    "领取奖励 Award": ("Award (rewards)", "報酬受取", "보상 수령"),
    "信用收支 Mall": ("Mall (credit store)", "購買部", "상점 (크레딧)"),
    "自动公招 Recruit": ("Recruit (auto)", "公開求人", "공개 모집"),
    "自动肉鸽 Roguelike": ("Roguelike (auto)", "ローグライク", "로그라이크"),
    "生息演算 Reclamation": ("Reclamation Algorithm", "生息演算", "생식 연산"),
    "仓库识别 Depot": ("Depot recognition", "倉庫認識", "창고 인식"),
    "干员识别 OperBox": ("Operator box recognition", "オペレーター認識", "오퍼레이터 인식"),
    "更换主题 SwitchTheme": ("Switch theme", "テーマ変更", "테마 변경"),
    "自定任务 Custom": ("Custom task", "カスタムタスク", "커스텀 태스크"),
    "参数映射（协议 schema 驱动）": ("Parameter mapping (protocol-schema driven)", "パラメータ変換（プロトコル schema 駆動）", "파라미터 매핑 (프로토콜 스키마 기반)"),
    "实例选项（触控模式 / 客户端类型）": ("Instance options (touch mode / client type)", "インスタンスオプション（タッチモード・クライアント種別）", "인스턴스 옵션 (터치 모드/클라이언트 종류)"),
    "任务页界面（逐项对照 MaaWpfGui XAML）": ("Task pages rebuilt against MaaWpfGui XAML", "タスク画面を MaaWpfGui XAML に逐項準拠", "태스크 화면을 MaaWpfGui XAML 기준으로 재구성"),
    "任务目录 / 参数 schema 由协议文档自动生成": ("Task catalog / param schema generated from the protocol doc", "タスクカタログ・パラメータ schema をプロトコル文書から自動生成", "태스크 카탈로그/파라미터 스키마를 프로토콜 문서에서 자동 생성"),
    "开始唤醒（账号切换/启动客户端）": ("StartUp (account switch / launch client)", "起動（アカウント切替・クライアント起動）", "시작 (계정 전환/클라이언트 실행)"),
    "理智作战": ("Fight (sanity farming)", "理性消費", "이성 소모"),
    "基建换班": ("Infrast (base shift)", "基地シフト", "기지 교대"),
    "领取奖励": ("Award (daily rewards)", "報酬受取", "보상 수령"),
    "信用收支": ("Mall (credit store)", "購買部", "상점 (크레딧)"),
    "自动公招": ("Recruit (auto)", "公開求人", "공개 모집"),
    "自动肉鸽": ("Roguelike (auto)", "ローグライク", "로그라이크"),
    "生息演算": ("Reclamation Algorithm", "生息演算", "생식 연산"),
    "自定任务（interface.json 协议）": ("Custom task (interface.json)", "カスタムタスク（interface.json）", "커스텀 태스크 (interface.json)"),
    "更换主题（游戏内皮肤）": ("Switch theme (in-game skin)", "テーマ変更（ゲーム内スキン）", "테마 변경 (인게임 스킨)"),
    "仓库维护（刷钱计划）": ("Depot maintain (farming plan)", "倉庫維持（資金計画）", "창고 유지 (파밍 계획)"),
    "用户数据同步": ("User data sync", "ユーザーデータ同期", "사용자 데이터 동기화"),
    # queue globals
    "任务多实例/复制/重命名/拖动排序": ("Multiple instances / copy / rename / drag-sort", "複数インスタンス・複製・名称変更・並べ替え", "다중 인스턴스/복사/이름 변경/드래그 정렬"),
    "全选": ("Select all", "全選択", "전체 선택"),
    "等待 & 停止": ("Wait & stop", "待機して停止", "대기 후 정지"),
    "完成后动作（退出游戏/模拟器/关机/休眠…）": ("Post-action (exit game/emulator, shutdown, sleep…)", "終了後アクション（ゲーム/エミュレータ終了・シャットダウン・休止…）", "종료 후 동작 (게임/에뮬레이터 종료·시스템 종료·절전…)"),
    "任务超时提醒": ("Task timeout reminder", "タスクタイムアウト通知", "태스크 시간 초과 알림"),
    "今日关卡提示": ("Today's stage hint", "本日のステージ情報", "오늘의 스테이지 안내"),
    "自动重载资源": ("Auto reload resources", "リソース自動再読み込み", "리소스 자동 재로드"),
    "定时执行（日程）": ("Scheduled runs", "スケジュール実行", "예약 실행"),
    # copilot
    "作业路径/神秘代码识别": ("Copilot path / mystery code", "作業パス・神秘コード認識", "작업 경로/미스터리 코드 인식"),
    "多作业模式/批量导入": ("Multi-job mode / bulk import", "複数作業モード・一括インポート", "다중 작업 모드/일괄 가져오기"),
    "视频识别": ("Video recognition", "動画認識", "영상 인식"),
    "自动编队/借助战/补充低信赖/模组": ("Auto squad / support / low-trust fill / modules", "自動編成・助戦・信頼度補充・モジュール", "자동 편성/지원/신뢰도 보충/모듈"),
    "作业分享/评价": ("Job sharing / rating", "作業共有・評価", "작업 공유/평가"),
    # toolbox
    "公招识别（Tag/时间）": ("Recruitment recognition (tags / timer)", "公開求人認識（タグ・時間）", "공개 모집 인식 (태그/시간)"),
    "仓库识别（导出 JSON）": ("Depot recognition (JSON export)", "倉庫認識（JSON 出力）", "창고 인식 (JSON 내보내기)"),
    "干员识别": ("Operator recognition", "オペレーター認識", "오퍼레이터 인식"),
    "牛牛抽卡/牛牛监控/牛杂": ("Gacha / Peep / MiniGame", "ガチャ・ピープ・ミニゲーム", "가챠/픽/미니게임"),
    # settings
    "常规设置（客户端类型）": ("General (client type)", "一般設定（クライアント種別）", "일반 설정 (클라이언트 종류)"),
    "连接设置": ("Connection settings", "接続設定", "연결 설정"),
    "启动设置": ("Startup settings", "起動設定", "시작 설정"),
    "定时设置（多套配置独立定时）": ("Timer settings (per-profile schedules)", "タイマー設定（プロファイル別スケジュール）", "타이머 설정 (프로필별 예약)"),
    "外部通知（SMTP/TG/Discord/Server酱…）": ("External notifications (SMTP/TG/Discord/…)", "外部通知（SMTP/TG/Discord など）", "외부 알림 (SMTP/TG/Discord 등)"),
    "远程控制（任务端点）": ("Remote control (task endpoints)", "リモート制御（タスクエンドポイント）", "원격 제어 (태스크 엔드포인트)"),
    "热键设置": ("Hotkey settings", "ホットキー設定", "단축키 설정"),
    "性能设置": ("Performance settings", "パフォーマンス設定", "성능 설정"),
    "游戏设置": ("Game settings", "ゲーム設定", "게임 설정"),
    "GUI/背景设置": ("GUI / background settings", "GUI・背景設定", "GUI/배경 설정"),
    "版本更新设置": ("Version update settings", "バージョン更新設定", "버전 업데이트 설정"),
    "配置管理（多套配置切换）": ("Profile management (multiple configs)", "設定管理（複数プロファイル切替）", "프로필 관리 (다중 설정 전환)"),
    "成就系统": ("Achievements", "実績", "업적"),
    "问题反馈": ("Issue report", "問題報告", "문제 신고"),
    "关于": ("About", "情報", "정보"),
    # infrastructure
    "MAA 官方运行包下载/SHA-256 校验": ("Official runtime download / SHA-256 verification", "公式ランタイムのダウンロード・SHA-256 検証", "공식 런타임 다운로드/SHA-256 검증"),
    "Docker 化部署（nginx + node）": ("Containerised deployment (nginx + node)", "Docker デプロイ（nginx + node）", "Docker 배포 (nginx + node)"),
    "日志实时流（WebSocket）": ("Live log stream (WebSocket)", "ログのリアルタイム配信（WebSocket）", "실시간 로그 스트림 (WebSocket)"),
    "windows-ui 组件体系（官方 dist vendored）": ("windows-ui component system (vendored official dist)", "windows-ui コンポーネント体系（公式 dist 同梱）", "windows-ui 컴포넌트 체계 (공식 dist 동봉)"),
    "功能对照页（本页）": ("Feature parity page (this section)", "機能対照ページ（本セクション）", "기능 대조 페이지 (본 섹션)"),
    "移动端适配（≤760px 单列 + 抽屉导航）": ("Mobile layout (single column + drawer nav below 760px)", "モバイル対応（760px 以下 1 カラム + ドロワー）", "모바일 대응 (760px 이하 1열 + 드로어)"),
    "前后端接入（状态轮询/配置持久化/实时画面）": ("Backend wiring (status polling / config persistence / live view)", "バックエンド接続（状態ポーリング・設定永続化・ライブ画面）", "백엔드 연동 (상태 폴링·설정 영구 저장·라이브 화면)"),
}

LABEL = {
    "zh": {"full": "✅ 已实现", "partial": "🟡 部分实现", "none": "❌ 未实现", "na": "⚪ 桌面专属"},
    "en": {"full": "✅ Done", "partial": "🟡 Partial", "none": "❌ Missing", "na": "⚪ Desktop-only"},
    "ja": {"full": "✅ 実装済み", "partial": "🟡 一部", "none": "❌ 未実装", "na": "⚪ デスクトップ専用"},
    "ko": {"full": "✅ 완료", "partial": "🟡 일부", "none": "❌ 미구현", "na": "⚪ 데스크톱 전용"},
}
HEAD = {
    "zh": ("功能", "状态", "说明"),
    "en": ("Feature", "Status", ""),
    "ja": ("機能", "状態", ""),
    "ko": ("기능", "상태", ""),
}
COUNTS = {
    "zh": "统计：**已实现 {full}** · 部分实现 {partial} · 未实现 {none} · 桌面专属 {na}（共 {total} 项）",
    "en": "Summary: **{full} done** · {partial} partial · {none} missing · {na} desktop-only (of {total})",
    "ja": "集計：**実装済み {full}** · 一部 {partial} · 未実装 {none} · デスクトップ専用 {na}（計 {total} 項目）",
    "ko": "집계: **완료 {full}** · 일부 {partial} · 미구현 {none} · 데스크톱 전용 {na} (총 {total}개)",
}
FILES = {"zh": "README.md", "en": "README.en.md", "ja": "README.ja.md", "ko": "README.ko.md"}


def render(lang: str, data: dict) -> str:
    idx = 0 if lang == "zh" else {"en": 0, "ja": 1, "ko": 2}[lang]
    label = LABEL[lang]
    counts = {"full": 0, "partial": 0, "none": 0, "na": 0}
    missing = []
    if lang != "zh":
        for sec in data["sections"]:
            if sec["module"] not in T:
                missing.append(sec["module"])
            for it in sec["items"]:
                if it["name"] not in T:
                    missing.append(it["name"])
        if missing:
            raise SystemExit(
                "::error::missing %s translations in scripts/gen-readme-parity.py: %s"
                % (lang, "; ".join(missing))
            )
    for sec in data["sections"]:
        for it in sec["items"]:
            counts[it["status"]] += 1
    lines = [COUNTS[lang].format(total=sum(counts.values()), **counts), ""]
    with_notes = lang == "zh"
    for sec in data["sections"]:
        module = sec["module"] if lang == "zh" else T[sec["module"]][idx]
        cols = 3 if with_notes else 2
        lines.append(f"### {module}")
        lines.append("")
        lines.append("| " + " | ".join(c for c in HEAD[lang][:cols]) + " |")
        lines.append("|" + "---|" * cols)
        for it in sec["items"]:
            name = it["name"] if lang == "zh" else T[it["name"]][idx]
            row = [name, label[it["status"]]]
            if with_notes:
                row.append((it.get("note") or "").replace("|", r"\|"))
            lines.append("| " + " | ".join(row) + " |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    check = "--check" in sys.argv
    data = json.loads(DATA.read_text(encoding="utf-8"))
    stale = []
    for lang, fname in FILES.items():
        path = ROOT / fname
        text = path.read_text(encoding="utf-8")
        if BEGIN not in text or END not in text:
            print(f"::error::{fname} is missing the {BEGIN} / {END} markers", file=sys.stderr)
            return 1
        block = render(lang, data)
        new = re.sub(
            re.escape(BEGIN) + r".*?" + re.escape(END),
            BEGIN + "\n" + block + END,
            text,
            flags=re.S,
        )
        if new != text:
            if check:
                stale.append(fname)
            else:
                path.write_text(new, encoding="utf-8", newline="\n")
                print(f"updated {fname}")
    if check:
        if stale:
            print("::error::feature parity in README is stale: " + ", ".join(stale) +
                  " — run scripts/gen-readme-parity.py", file=sys.stderr)
            return 1
        print("feature parity tables are up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
