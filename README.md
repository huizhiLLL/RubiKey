# RubiKey

RubiKey 是一个基于 Electron、React 和 TypeScript 的桌面工具，用 GAN 智能魔方的转动来触发 Windows 键盘或鼠标动作。

## 当前能力

- 连接兼容的 GAN 蓝牙魔方
- 将转动动作映射到键盘或鼠标事件
- 管理多套映射方案
- 提供托盘常驻、启停切换与紧急停止
- 查看最近转动、执行回显与连接诊断

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

## 项目结构

```text
app/main      Electron 主进程与本地存储
app/renderer  React 界面
app/shared    共享类型、动作协议、映射模型
app/cube      GAN 魔方协议与驱动
```

## 运行说明

- 配置保存在 Electron `userData` 目录下的 `profiles.json`
- 默认全局快捷键：
  - `Ctrl/Cmd + Shift + F11`：启用或暂停映射
  - `Ctrl/Cmd + Shift + F12`：紧急停止
- 当前描述与实现都以 Windows 宏控制为主要目标

## 状态

当前版本为早期开发态，适合继续迭代连接稳定性、映射体验与打包发布流程。
