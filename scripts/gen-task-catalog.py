#!/usr/bin/env python3
"""Generate apps/maa-server/src/{maa-task-spec.json,task-catalog.json} from the official
MAA integration-protocol document.

Source of truth: MaaAssistantArknights v6.17.5 docs/zh-cn/protocol/integration.md
(download it next to this script, or pass a path as argv[1]).

  python3 scripts/gen-task-catalog.py [path/to/integration.md]

The spec is the machine-readable field list per task type (used by the runner to
build AsstAppendTask params). The catalog is the UI description (labels, control
types, grouping) for the tasks the desktop client exposes.
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_SPEC = ROOT / "apps" / "maa-server" / "src" / "maa-task-spec.json"
OUT_CATALOG = ROOT / "apps" / "maa-server" / "src" / "task-catalog.json"
DEFAULT_DOC = ROOT.parent / ".workbuddy" / "integration-zh.md"

# ---- tasks shown in the web queue (MAA desktop task list order) ----
TASKS = [
    ("StartUp", "开始唤醒", "启动客户端并处理登录，为后续自动化做准备。"),
    ("Fight", "理智作战", "代理作战，自动消耗理智清体力。"),
    ("Infrast", "基建换班", "自动计算干员效率并换班。"),
    ("Award", "领取奖励", "领取日常/周常奖励、邮件与月卡。"),
    ("Mall", "信用收支", "访问好友、收信用并在信用商店购物。"),
    ("Recruit", "自动公招", "自动识别公招标签并完成招募。"),
    ("Roguelike", "自动肉鸽", "自动集成战略模式。"),
    ("Reclamation", "生息演算", "自动生息演算（沙中之火）。"),
    ("Depot", "仓库识别", "识别仓库材料并导出数据。"),
    ("OperBox", "干员识别", "识别当前账号干员列表。"),
    ("SwitchTheme", "更换主题", "切换游戏主界面主题。"),
    ("Custom", "自定任务", "执行 interface.json 中定义的自定义任务。"),
]

# ---- Chinese labels (hand-mapped for the common fields; the rest fall back to
# ---- a short phrase derived from MAA's own Chinese description) ----
LABELS = {
    # StartUp
    "client_type": "客户端类型", "start_game_enabled": "启动客户端", "account_name": "切换账号",
    # Fight
    "stage": "关卡选择", "medicine": "使用理智药", "medicine_expire_days": "理智药过期天数",
    "expiring_medicine": "使用快过期理智药", "stone": "碎石次数", "times": "刷图次数",
    "series": "代理倍率", "drops": "掉落识别", "report_to_penguin": "上传企鹅物流",
    "penguin_id": "企鹅物流 ID", "report_to_yituliu": "上传一图流", "yituliu_id": "一图流 ID",
    "server": "服务器", "DrGrandet": "博朗台模式",
    # Recruit
    "refresh": "自动刷新 3 星标签", "select": "招募标签等级", "confirm": "自动确认等级",
    "first_tags": "首选标签", "extra_tags_mode": "多选 Tag 策略", "set_time": "自动设置招募时间",
    "expedite": "使用加急许可", "expedite_times": "加急次数", "skip_robot": "识别到机器人时跳过",
    "preserve_tags": "保留指定词条", "recruitment_time": "招募时间（分钟）",
    # Infrast
    "mode": "基建模式", "facility": "换班设施", "drones": "无人机用途", "threshold": "心情阈值",
    "replenish": "源石碎片自动补货", "dorm_notstationed_enabled": "宿舍不放入已进驻干员",
    "dorm_trust_enabled": "宿舍空余位置蹭信赖", "fiammetta_targets": "菲亚梅塔恢复目标",
    "fiammetta_recovery_enabled": "启用菲亚梅塔恢复", "use_pinus_sylvestris": "红松骑士团跨设施组合",
    "use_perception_information": "感知信息跨设施组合", "use_worldly_plight": "人间烟火跨设施组合",
    "use_abyssal_hunter": "深海猎人跨设施组合", "reception_message_board": "会客室信息板收取信用",
    "reception_clue_exchange": "进行线索交流", "reception_send_clue": "赠送线索",
    "filename": "排班文件", "plan_index": "计划序号", "continue_training": "专精完成后继续尝试",
    # Mall
    "visit_friends": "访问好友", "shopping": "信用商店自动购物", "buy_first": "优先购买（分号分隔）",
    "blacklist": "黑名单（分号分隔）", "force_shopping_if_credit_full": "信用溢出时无视黑名单",
    "only_buy_discount": "只购买打折商品", "reserve_max_credit": "信用点低于 300 时停止购买",
    "credit_fight": "借助战刷信用点", "formation_index": "使用编队",
    # Award
    "award": "领取每日/每周任务奖励", "mail": "领取所有邮件奖励", "recruit": "进行每日免费单抽",
    "orundum": "领取幸运墙合成玉", "mining": "领取限时开采许可", "specialaccess": "领取赠送月卡",
    # SwitchTheme
    "themes": "主题名称",
    # Roguelike
    "theme": "肉鸽主题", "difficulty": "难度", "squad": "开局分队", "roles": "开局职业组",
    "core_char": "开局干员", "use_support": "使用助战", "use_nonfriend_support": "允许非好友助战",
    "starts_count": "开始探索次数", "stop_at_final_boss": "第五层 BOSS 前暂停",
    "stop_at_max_level": "满级后自动停止", "investments_count": "投资多少个源石锭后停止",
    "investment_with_more_score": "投资模式启用购物/招募/进二层",
    "start_with_elite_two": "凹开局干员直升精二", "only_start_with_elite_two": "只凹直升精二，不作战",
    "first_floor_foldartal": "凹第一层远见密文板", "start_foldartal_list": "开局密文板列表",
    "collectible_mode_start_list": "刷开局期望奖励", "use_foldartal": "使用密文板",
    "check_collapsal_paradigms": "识别坍缩范式", "double_check_collapsal_paradigms": "二次确认坍缩范式",
    "expected_collapsal_paradigms": "期望的坍缩范式列表", "monthly_squad_auto_iterate": "月度小队自动切换",
    "monthly_squad_check_comms": "月度小队通讯", "deep_exploration_auto_iterate": "深入调查自动切换",
    "collectible_mode_shopping": "刷开局模式启用购物", "collectible_mode_squad": "刷开局使用分队",
    "start_with_seed": "启用刷钱种子（美愿）", "blackflow_strategy": "黑流树海策略",
    "blackflow_cultivation_target": "培养目标", "find_playTime_target": "目标襁褓动物",
    # Reclamation
    "tools_to_craft": "支援道具", "clear_store": "任务完成后购买商店", "increment_mode": "荧光棒增加方式",
    "num_craft_batches": "单次最大组装轮数",
    # Custom / Depot / OperBox
    "task_names": "任务名", "params": "任务参数（JSON）",
    # shared
    "enable": "是否启用本任务",
}

# ---- enum values MAA documents as lists/bits rather than inline 选项：----
FORCED_CHOICES = {
    ("Infrast", "facility"): [("Mfg", "制造站"), ("Trade", "贸易站"), ("Power", "发电站"),
                              ("Control", "控制中枢"), ("Reception", "会客室"), ("Office", "办公室"), ("Dorm", "宿舍")],
    ("Infrast", "mode"): [("0", "常规模式（自动计算效率）"), ("10000", "自定义配置（排班文件）")],
    ("Recruit", "select"): [("3", "3 星"), ("4", "4 星"), ("5", "5 星"), ("6", "6 星")],
    ("Recruit", "confirm"): [("1", "1 星"), ("2", "2 星"), ("3", "3 星"), ("4", "4 星"), ("5", "5 星"), ("6", "6 星")],
    ("Roguelike", "mode"): [("0", "刷等级，尽可能稳定打更多层"), ("1", "刷源石锭，投资满后退出"), ("4", "刷开局，拿开局干员后退出")],
    ("Roguelike", "difficulty"): [("0", "默认"), ("1", "难度 1"), ("2", "难度 2"), ("3", "难度 3"),
                                  ("4", "难度 4"), ("5", "难度 5"), ("6", "难度 6"), ("7", "难度 7"),
                                  ("8", "难度 8"), ("9", "难度 9"), ("10", "难度 10"), ("11", "难度 11"),
                                  ("12", "难度 12"), ("13", "难度 13"), ("14", "难度 14"), ("15", "难度 15")],
    ("Reclamation", "mode"): [("0", "不开启"), ("1", "自动计算最优路径")],
    ("Reclamation", "increment_mode"): [("0", "逐个放置"), ("1", "连续放置")],
    ("Fight", "series"): [("-1", "不切换（禁用）"), ("0", "自动切换最大可用倍率"), ("1", "1 倍"), ("2", "2 倍"),
                          ("3", "3 倍"), ("4", "4 倍"), ("5", "5 倍"), ("6", "6 倍"), ("7", "7 倍"),
                          ("8", "8 倍"), ("9", "9 倍"), ("10", "10 倍")],
    ("Infrast", "threshold"): [("0.1", "10%"), ("0.2", "20%"), ("0.3", "30%（推荐）"),
                               ("0.4", "40%"), ("0.5", "50%")],
    ("Infrast", "drones"): [("_NotUse", "不使用无人机"), ("Money", "贸易站-龙门币"),
                            ("SyntheticJade", "贸易站-合成玉"), ("CombatRecord", "制造站-作战记录"),
                            ("PureGold", "制造站-赤金")],
    ("Roguelike", "theme"): [("Phantom", "傀影与猩红孤钻"), ("Mizuki", "水月与深蓝之树"), ("Sami", "探索者的银凇止境"),
                             ("Sarkaz", "萨卡兹的无终奇想"), ("JieYuan", "界园肉鸽"), ("BlackFlow", "黑流树海")],
}

# numeric fields that want select-style choices or specific ranges
NUM_RANGE = {("Fight", "series"): (-1, 10), ("Mall", "reserve_max_credit"): (0, 99999),
             ("Infrast", "plan_index"): (0, 999), ("Recruit", "expedite_times"): (0, 999)}

ADVANCED_PAT = re.compile(
    r"^(penguin_id|yituliu_id|server|filename|plan_index|params|expiring_medicine|DrGrandet|"
    r"extra_tags_mode|set_time|fiammetta_targets|use_pinus_sylvestris|use_perception_information|"
    r"use_worldly_plight|use_abyssal_hunter|collectible_mode_|monthly_squad_|deep_exploration_|"
    r"start_foldartal_list|first_floor_foldartal|expected_collapsal_paradigms|double_check_collapsal_paradigms|"
    r"start_with_seed|blackflow_|find_playTime_target|reserve_max_credit|force_shopping_if_credit_full|"
    r"credit_fight|formation_index|report_to_|drops)$"
)

# same field name can mean different things per task — override per task
TASK_LABELS = {
    ("Recruit", "times"): "最大招募次数",
    ("Recruit", "refresh"): "自动刷新 3 星标签",
    ("Recruit", "select"): "招募标签等级(Tag 级别)",
    ("Roguelike", "mode"): "策略",
    ("Roguelike", "theme"): "肉鸽主题",
    ("Roguelike", "investment_enabled"): "投资源石锭",
    ("Roguelike", "stops_when_investment_full"): "投资满后自动退出",
    ("Roguelike", "refresh_trader_with_dice"): "刷新商店（指路鳞）",
    ("Roguelike", "only_start_with_elite_two"): "只凹直升精二，不进行作战",
    ("Roguelike", "start_with_seed"): "启用刷钱种子（美愿）",
    ("Roguelike", "collectible_mode_shopping"): "刷开局模式启用购物",
    ("Roguelike", "collectible_mode_squad"): "刷开局使用分队",
    ("Reclamation", "theme"): "生息演算主题",
    ("Reclamation", "mode"): "模式",
    ("Reclamation", "increment_mode"): "荧光棒增加方式",
    ("Fight", "series"): "代理倍率",
    ("Fight", "drops"): "掉落识别",
    ("Infrast", "mode"): "基建模式",
    ("Mall", "shopping"): "信用商店自动购物",
    ("Custom", "task_names"): "任务名（interface.json）",
    ("Custom", "params"): "任务参数（JSON）",
    ("SwitchTheme", "themes"): "主题名称",
}

# a few enum value labels (MAA wording from its own UI)
VALUE_LABELS = {
    "_NotUse": "不使用无人机", "Money": "贸易站-龙门币", "SyntheticJade": "贸易站-合成玉",
    "CombatRecord": "制造站-作战记录", "PureGold": "制造站-赤金",
    "Official": "官服", "Bilibili": "Bilibili服", "txwy": "繁中服",
    "YoStarEN": "国际服 (EN)", "YoStarJP": "日服", "YoStarKR": "韩服",
}


def derive_label(field: dict) -> str:
    """Fallback label from MAA's own Chinese description (first clause)."""
    desc = (field.get("desc") or "").strip()
    desc = re.sub(r"^[。，、\s]+", "", desc)
    head = re.split(r"[。；，：,;:]", desc, maxsplit=1)[0].strip()
    if not head:
        return field["name"]
    return head[:16]


def control_for(field: dict) -> dict:
    t = field["type"]
    choices = field.get("choices") or []
    if t == "boolean":
        return {"type": "switch"}
    if t == "number":
        return {"type": "counter", "min": 0, "max": 100000}
    if t == "string" and choices:
        return {"type": "select"}
    if t in ("array", "object"):
        return {"type": "multi" if choices else "json"}
    if t == "string":
        return {"type": "text"}
    return {"type": "json"}


def coerce_default(field: dict):
    raw = field.get("default")
    t = field["type"]
    if raw is None:
        return {"boolean": False, "number": 0, "string": "", "array": [], "object": {}}.get(t)
    raw = raw.strip().replace("\\", "")   # docs escape some enum values (\_NotUse)
    if t == "boolean":
        return raw.lower() == "true"
    if t == "number":
        try:
            return float(raw) if "." in raw else int(raw)
        except ValueError:
            return 0
    if t in ("array", "object"):
        try:
            return json.loads(raw)
        except Exception:
            return [] if t == "array" else {}
    return raw


def main() -> int:
    doc = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DOC
    if not doc.exists():
        print(f"::error::integration doc not found: {doc}", file=sys.stderr)
        return 1
    s = io.open(doc, encoding="utf-8").read()
    seg = s[s.find("任务类型一览"):]

    starts = []
    for m in re.finditer(r"\n- `(\w+)`[ \t]*\n[ \t]*([^\n]*)", seg):
        if m.group(1).startswith("Asst"):
            continue
        starts.append((m.group(1), m.group(2).strip(), m.start()))

    spec = {}
    for idx, (name, label, pos) in enumerate(starts):
        end = starts[idx + 1][2] if idx + 1 < len(starts) else len(seg)
        block = seg[pos:end]
        fields = []
        for fm in re.finditer(
            r"\n[ \t]*:{3,4} field (?!group)(\w+)[ \t]*\n(.*?)(?=\n[ \t]*:{3,4} (?!info|field-group)|\Z)",
            block, re.S,
        ):
            fname, body = fm.group(1), fm.group(2)
            t = re.search(r"@type (\w+)", body)
            d = re.search(r"@default ([^\n]+)", body)
            opts = re.search(r"选项：([^\n]+)", body)
            desc = re.sub(r"@\w+[^\n]*\n", "", body)
            desc = re.sub(r":::\s*info.*?:::", " ", desc, flags=re.S)
            # markdown -> plain text for the UI
            desc = desc.replace("<br>", " ").replace("**", "").replace("`", "")
            desc = desc.replace("(br)", " ").replace("<br/>", " ")
            desc = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", desc)   # markdown links -> text
            desc = re.split(r"选项：", desc)[0].strip()   # the select renders choices already
            desc = re.sub(r"\s+", " ", desc).strip()
            desc = re.sub(r"\s+", " ", desc).strip()
            fields.append({
                "name": fname,
                "type": t.group(1) if t else "unknown",
                "default": d.group(1).strip().strip("`") if d else None,
                "required": "@required" in body,
                "choices": [c.strip().strip("`") for c in re.split(r"[|｜]、?", opts.group(1)) if c.strip()] if opts else [],
                "desc": desc[:240],
            })
        spec[name] = {"label": label, "fields": fields}

    spec_out = {
        "_source": "MaaAssistantArknights v6.17.5 docs/zh-cn/protocol/integration.md (AsstAppendTask 任务类型一览)",
        "_generated_by": "scripts/gen-task-catalog.py",
        "tasks": spec,
    }
    OUT_SPEC.write_text(json.dumps(spec_out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT_SPEC.relative_to(ROOT)}: {len(spec)} task types, {sum(len(v['fields']) for v in spec.values())} fields")

    catalog = {
        "_source": "generated from maa-task-spec.json (MAA v6.17.5 integration protocol)",
        "name": "MAA for NAS 任务目录",
        "upstream": "MaaAssistantArknights v6.17.5 集成协议 + 桌面端任务列表",
        "clients": [{"value": k, "label": v} for k, v in VALUE_LABELS.items() if k in ("Official", "Bilibili", "txwy", "YoStarEN", "YoStarJP", "YoStarKR")],
        "tasks": [],
    }
    for task_type, name, descr in TASKS:
        tspec = spec.get(task_type)
        if not tspec:
            print(f"::warning::task type {task_type} not found in spec", file=sys.stderr)
            continue
        options = []
        for f in tspec["fields"]:
            if f["name"] == "enable":
                continue
            forced = FORCED_CHOICES.get((task_type, f["name"]))
            ctl = {"type": "select"} if forced else control_for(f)
            opt = {
                "id": f["name"],
                "type": ctl["type"],
                "label": TASK_LABELS.get((task_type, f["name"])) or LABELS.get(f["name"]) or derive_label(f),
                "default": coerce_default(f),
                "help": f["desc"],
                "group": "advanced" if ADVANCED_PAT.match(f["name"]) else "basic",
                "protocol": {"type": f["type"], "required": f["required"]},
            }
            if forced:
                opt["choices"] = [{"value": v, "label": l} for v, l in forced]
                # numeric enums stay numeric in the saved config
                raw = f.get("default")
                if raw is not None and re.fullmatch(r"-?\d+(\.\d+)?", raw.strip()):
                    opt["default"] = float(raw) if "." in raw else int(raw)
            elif f["choices"]:
                opt["choices"] = [{"value": c, "label": VALUE_LABELS.get(c, c)} for c in f["choices"]]
            if ctl["type"] == "counter":
                lo, hi = NUM_RANGE.get((task_type, f["name"]), (ctl["min"], ctl["max"]))
                opt["min"], opt["max"] = lo, hi
                if f["type"] == "number" and f.get("default") and "." in str(f["default"]):
                    opt["step"] = 0.05
            options.append(opt)
        catalog["tasks"].append({
            "id": task_type.lower(),
            "name": name,
            "taskType": task_type,
            "description": descr,
            "options": options,
        })
    OUT_CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(len(t["options"]) for t in catalog["tasks"])
    basic = sum(1 for t in catalog["tasks"] for o in t["options"] if o["group"] == "basic")
    print(f"wrote {OUT_CATALOG.relative_to(ROOT)}: {len(catalog['tasks'])} tasks, {total} options ({basic} basic / {total - basic} advanced)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
