# RubiKey

RubiKey 是一个基于 Electron 和 React 的 Windows 整活小工具，使智能魔方的转动触发键鼠操作。

## 功能

- 自动连接兼容多品牌/协议的智能魔方
  - GAN 智能 `v2`、`v3`、`v4` 协议
  - 魔域智能 `Moyu32`协议
- 识别 12 个基础转动
  - `U / U'`
  - `R / R'`
  - `F / F'`
  - `D / D'`
  - `L / L'`
  - `B / B'`
- 自定义多套映射方案
- 为每个 move 配置键鼠操作
  - 键盘：`A-Z`
  - 鼠标：左键 / 右键
  - 行为：`单击` / `长按`
- 提供托盘常驻、启停切换与紧急停止
- 查看最近转动、执行回响与连接诊断

## 如何实现？

- 智能魔方 -> 蓝牙连接 -> move 解析 -> Profile 查找 -> 主进程宏执行 -> Windows 输入
- 模拟电脑操作核心使用 `@nut-tree/nut-js`


## 致谢

- [cstimer](https://github.com/cs0x7f/cstimer)：参考了智能魔方连接层的核心实现
- [Visionary](https://space.bilibili.com/674586122)：配合测试了首版软件功能
