# 飞书数据同步说明 / Feishu Sync Guide

这个看板会每 60 秒尝试读取 `dashboard-data.json`。飞书同步脚本负责读取飞书表格，并生成这个文件。读取失败时，看板会继续使用手动录入数据。

## GitHub Pages 自动同步

1. 在飞书开放平台创建自建应用。
2. 给应用开通电子表格只读权限，例如 `sheets:spreadsheet:readonly`。
3. 发布应用版本，并把这个应用加入目标表格的协作者，至少给读取权限。
4. 在 GitHub 仓库进入 `Settings` -> `Secrets and variables` -> `Actions`。
5. 新增两个 Repository secrets：
   - `FEISHU_APP_ID`
   - `FEISHU_APP_SECRET`
6. 打开 `Actions`，运行 `Sync Feishu Dashboard Data`。

同步成功后，仓库会生成或更新 `dashboard-data.json`，GitHub Pages 上的看板会自动读取。

## 当前默认映射

当前脚本默认读取这个飞书表：

- Spreadsheet Token: `JkdYsFb6KhX1MXtwSlAcYbMOnfd`
- Sheet ID: `31FeWT`
- Range: `31FeWT!A1:AB130`

脚本会从 `总产量` 表头中自动寻找这些列：

- `Date` / `日期`
- `Shift` / `班次`
- `成品`
- `不良品`
- `不合格品Kg`
- `合格品卷材`
- `不合格品卷材`
- `产量`
- `PO No.`
- `Customer`
- `Metal` / `Material`

白班 / 早班会进入 `08:00-20:00`，晚班会进入 `20:00-次日08:00`。

## 停机数据

如果同一个飞书文件里有名为 `每小时产量` 的工作表，脚本会自动读取它。脚本会自动识别：

- 停机换款
- 生产异常停机
- 设备异常停机
- 规划维保停机

如果停机表里的单位是小时，脚本会自动换算成分钟。

如果你的停机表名称不同，可以在 `.github/workflows/sync-feishu.yml` 里增加：

```yaml
FEISHU_DOWNTIME_SHEET_TITLE: 你的停机表名称
```

## 本地测试

在项目目录里运行：

```powershell
$env:FEISHU_APP_ID="你的 App ID"
$env:FEISHU_APP_SECRET="你的 App Secret"
$env:DASHBOARD_MONTH="2026-05"
node scripts/sync-feishu.mjs
```

成功后会生成 `dashboard-data.json`。
