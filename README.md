# 日程管理

一款离线优先的 Windows 个人日程应用。使用 Electron、React、TypeScript 和 Node 内置 SQLite 构建，所有数据仅保存在本机。

## 已实现功能

- 月历、选中日期侧栏和快速新增
- 全部任务、待安排、优先级和可选目标关联
- 每天、工作日、每周、每月重复事项
- Windows 系统通知和应用内提醒中心
- 独立目标、关联任务与自动进度
- 按实际完成日期分组和筛选的历史时间线
- 深浅色主题、本地 JSON 备份与安全恢复

## 本地开发

```powershell
npm install
npm run dev
```

验证与构建：

```powershell
npm run typecheck
npm test
npm run build
npm run dist
```

生产构建输出到 `out/`，Windows 安装包输出到 `release/`。

## 数据位置

正式应用的 SQLite 数据库位于 Electron 的 `userData` 目录，通常为：

```text
%APPDATA%\日程管理\schedule-manager.sqlite
```

恢复外部备份前，应用会先在同一 `userData` 目录的 `backups/` 下创建恢复前备份。

## 说明

- 应用无需账户与网络连接。
- 系统通知只在应用运行期间触发；关闭期间错过的提醒会在下次打开后进入提醒中心。
- 当前安装包未进行商业代码签名，Windows 可能显示来源确认提示。
