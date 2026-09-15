# MAA Docker Web

[简体中文](README.md) | [English](README.en.md) | **日本語** | [한국어](README.ko.md)

> ## ⚠️ プロジェクト状況：開発初期、まだ使用できません
>
> **本番利用や日々の自動化には使わないでください。** 現在も活発に開発中で、UI と API は予告なく変わります。また、**実機でのエンドツーエンドのタスク実行は一度も検証されていません**。
> 現状のコードは開発・実験・検証用途のみです。詳細は[ロードマップ](#ロードマップ)と [GitHub Issues](https://github.com/Kasbuky-sudo/maa-docker-web/issues) をご覧ください。

[MAA（MaaAssistantArknights）](https://github.com/MaaAssistantArknights/MaaAssistantArknights) 公式の
Linux ランタイムを、**x86_64 / arm64** の Docker 環境（NAS 向け）で動く Web 管理サービスとして包んだものです。

本リポジトリは MAA のバイナリ・リソースを**同梱しません**。ランタイムは MAA 公式 GitHub Release から
ダウンロードし、SHA-256 で検証したうえで永続ボリュームに展開します。

## できること / できないこと

✅ **実装済み・検証済み**

- マルチアーキテクチャイメージとコンテナ運用（`linux/amd64` + `linux/arm64`、CI が ghcr に公開）
- 公式ランタイムのダウンロード / SHA-256 検証 / 展開 / ステートマシン
- リアルタイムログ（WebSocket + リングバッファ + ファイル出力）
- Web UI（公式 [windows-ui](https://github.com/virtualvivek/windows-ui) コンポーネントのみで構築）：タスク / スケジュール / 設定 / Runtime / ログ / 機能対照 / 情報
- タスクカタログ（JSON 駆動 UI）：理性消費、基地シフト、報酬受取、購買部、公開求人、ローグライク、生息演算
- MaaCore C API の FFI バインディング（koffi → `libMaaCore.so`）：`AsstGetVersion` / `AsstSetUserDir` / `AsstLoadResource` / `AsstCreateEx` / ネイティブコールバックをコンテナ内で確認

❌ **まだ使用不可（重要）**

- **実機でタスクを一度も通しで動かせていません**：接続・投入・実行の経路はコード上あるが、結合検証は未実施
- 接続設定は ADB アドレスの入力欄のみ：ADB パス、タッチモード、MuMu/LD スクリーンショット強化、接続プロファイルは未実装
- デスクトップ版の 12 タスクのうち 5 つが未実装：起動、カスタムタスク、テーマ変更、倉庫維持、ユーザーデータ同期
- 自動戦闘（Copilot）とツールボックスのページが丸ごと未実装
- スケジュールは保存のみでサーバー側スケジューラなし。キュー全体の操作（終了後アクション等）も未実装
- **認証は一切ありません**：信頼できる LAN 内でのみ運用し、インターネットに公開しないでください

完全なチェックリストは Web UI の「機能対照」ページにあります。データは
[`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json)（基準：MAA v6.17.5 デスクトップ版）です。

## 構成

```text
ブラウザ ──▶ maa-web (nginx) ──▶ maa-server (Node.js)
                                    ├── ランタイム管理（DL/検証/展開）
                                    ├── REST + WebSocket（ログ・タスク・状態）
                                    └── runner ──koffi FFI──▶ libMaaCore.so ──ADB──▶ 端末
```

- `apps/maa-server`：API サービス。ローカル開発時はフロントの静的配信も担当
- `apps/maa-web`：[windows-ui](https://github.com/virtualvivek/windows-ui)（MIT）コンポーネントのみで構成した静的フロント
- `docker/`：`Dockerfile.server`（adb と libatomic1 を含む）、`Dockerfile.web`

## クイックスタート（開発・検証のみ）

```bash
git clone https://github.com/Kasbuky-sudo/maa-docker-web.git
cd maa-docker-web
# deploy/ の docker-compose.yml と .env を使用
docker compose up -d
```

`http://<ホスト>:8080` を開きます。初回起動時に約 220MB のランタイムをダウンロードします（Runtime ページから手動実行も可）。

イメージ（マルチアーキ、main から自動ビルド）：

```text
ghcr.io/kasbuky-sudo/maa-server
ghcr.io/kasbuky-sudo/maa-web
```

## ロードマップ

- [x] M1：ランタイムのコンテナ化 + 基本 API + マルチアーキイメージ
- [x] M2：windows-ui コンポーネントでフロントを再構築 + カタログ駆動 UI
- [x] M3：MaaCore FFI 実行パイプライン（koffi）、コンテナ内スモーク検証済み
- [ ] M4：接続設定の補完 + **実機でのエンドツーエンド検証**
- [ ] M5：12 タスクの実装完了 + キュー全体の操作
- [ ] M6：スケジューラ、外部通知、マルチデバイス、認証

## ドキュメント

- [アーキテクチャ](docs/architecture.md) ・ [デプロイ](docs/deployment.md) ・ [API](docs/api.md) ・ [開発](docs/development.md) ・ [リリース](docs/release.md)
- [サードパーティ表記](NOTICE)

## ライセンス

本リポジトリのコードは [MIT](LICENSE) で公開されています。MAA 本体は AGPL-3.0 であり、本リポジトリは
そのバイナリ・リソースを含みません。ランタイムは公式リリースから取得し、その利用は MAA のライセンスに従います。
詳細は [NOTICE](NOTICE) を参照してください。本プロジェクトは MaaAssistantArknights チームとは無関係です。
