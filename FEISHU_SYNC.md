# CSV/Excel 手动同步说明

现在这个项目不再需要飞书开放平台应用，也不需要 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`。

同步方式改为：

1. 从飞书表格导出 Excel 或 CSV。
2. 上传到 GitHub 仓库的 `data/` 文件夹。
3. 在 GitHub Actions 手动运行同步任务。
4. 同步任务生成 `dashboard-data.json`。
5. 看板每 60 秒自动读取 `dashboard-data.json`。

## 网站内更新与下载

打开看板后，右上角有：

- `更新 Excel / Upload`：可以直接选择 `.xlsx`、`.csv` 或 `dashboard-data.json`，网页会立即刷新当前看板数据。
- `下载数据 / Download`：下载当前看板使用的 `dashboard-data.json`。
- `重置布局 / Layout`：恢复默认看板位置。

注意：网页内上传会更新当前浏览器里的看板。如果你要让 GitHub Pages 上的公开看板也更新，请把下载出来的 `dashboard-data.json` 上传回 GitHub 仓库根目录。

主看板里的卡片可以拖动换位置，位置会保存在当前浏览器里。

## 上传文件位置

请把导出的文件放在：

```text
data/
```

推荐文件名：

```text
data/May 2026.xlsx
```

或：

```text
data/total-production.csv
```

如果是 Excel，脚本会自动读取工作表：

- `总产量`
- `每小时产量`

如果是 CSV，脚本默认 CSV 内容是 `总产量` 表；如果还有停机数据，可以另外上传：

```text
data/downtime.csv
```

## GitHub 操作步骤

1. 打开 GitHub 仓库。
2. 进入 `data` 文件夹。
3. 点 `Add file` -> `Upload files`。
4. 上传从飞书导出的 `.xlsx` 或 `.csv`。
5. 点 `Commit changes`。
6. 进入仓库上方 `Actions`。
7. 点 `Build Dashboard Data From File`。
8. 点 `Run workflow`。
9. `source_file` 可以留空；如果要指定文件，可以填：

```text
data/May 2026.xlsx
```

10. `month` 填看板月份，例如：

```text
2026-05
```

运行成功后，仓库会自动生成或更新：

```text
dashboard-data.json
```

GitHub Pages 上的看板会读取这个文件。

## 数据映射

脚本会从 `总产量` 表里识别这些列：

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

当前产量与正品率口径：

```text
总产出 = Good 正品 + Reject 废品 + Flakes 边料 + Purging 机头料 + Loss 无形损耗
正品率 = Good 正品 / 总产出
```

白班 / 早班会进入：

```text
08:00-20:00
```

晚班会进入：

```text
20:00-次日08:00
```

停机数据会识别：

- 停机换款
- 生产异常停机
- 设备异常停机
- 规划维保停机

如果停机表里的单位是小时，脚本会自动换算成分钟。

## 本地测试

如果你想在电脑上先测试，可以运行：

```powershell
node scripts/build-dashboard-data.mjs "C:\Users\USER\Downloads\May 2026.xlsx"
```

成功后会生成：

```text
dashboard-data.json
```
