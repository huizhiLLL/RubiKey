# RubiKey

RubiKey 是一个基于 Electron、React 和 TypeScript 的 Windows 桌面工具，使 GAN 智能魔方的转动触发键鼠操作。

## 当前能力

- 连接兼容的 GAN 蓝牙魔方
- 识别 GAN `v2 / v3 / v4` 协议设备
- 识别 12 个基础单步动作
  - `U / U'`
  - `R / R'`
  - `F / F'`
  - `D / D'`
  - `L / L'`
  - `B / B'`
- 管理多套 Profile 映射方案
- 编辑 Profile 名称、切换激活方案、新增和删除方案
- 为每个 move 配置键盘或鼠标动作
  - 键盘：`A-Z`
  - 鼠标：左键 / 右键
  - 行为：`tap` / `hold`
- 提供托盘常驻、启停切换与紧急停止
- 查看最近转动、执行回响与连接诊断

## 当前状态

- 当前版本已经打通核心主链路：
  - `GAN 智能魔方 -> 转动识别 -> Profile 规则查找 -> 主进程宏执行 -> Windows 输入`
- 当前属于“可运行的桌面原型 / 早期可用版本”
- 已通过 `typecheck` 与 `build`
- 目前未包含自动化测试

## 技术栈

- Electron
- React
- Vite
- TypeScript
- `@nut-tree/nut-js`

## 本地开发

```bash
npm install
npm run dev
```

## 校验与构建

```bash
npm run typecheck
npm run build
```

说明：

- 当前仓库内已确认 `typecheck` 和 `build` 可通过
- 这不等同于已经完成自动化测试、设备兼容矩阵验证或打包验收

## 项目结构

```text
app/main      Electron 主进程、托盘、快捷键、宏执行、配置存储
app/renderer  React 界面
app/shared    共享类型、动作协议、Profile 模型
app/cube      GAN 魔方协议与驱动
```

## 运行说明

- 配置保存在 Electron `userData` 目录下的 `profiles.json`
- 默认全局快捷键：
  - `Ctrl/Cmd + Shift + F11`：启动或暂停系统
  - `Ctrl/Cmd + Shift + F12`：紧急停止
- 当前激活的 Profile 会在系统启动后自动生效
- 当前实现以 Windows 宏控制为主要目标
- 更完整的当前状态总结与优化方向见 `../docs/smartcube-windows-macro-tool-prd-architecture.md`
