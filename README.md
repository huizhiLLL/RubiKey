<div align="center">
  <img src=".github/assets/rubikey-logo.svg" alt="RubiKey logo" width="128" height="128" />

  <h1>RubiKey</h1>

  <p>
    一个基于 Electron 的 Windows 智能魔方键鼠映射工具。
  </p>

  <p>
    <img alt="Electron" src="https://img.shields.io/badge/Electron-36-47848F?style=for-the-badge&logo=electron&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=20232A" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="Windows" src="https://img.shields.io/badge/Windows-11-0078D4?style=for-the-badge&logo=windows&logoColor=white" />
  </p>
</div>

核心链路：

> **智能魔方 → 蓝牙连接 → 数据解析 → 规则匹配 → 键鼠执行**

## 功能

- **自动连接智能魔方并提供转动映射层**
- **支持多套映射方案管理**，可自由切换、导入和导出
- **支持多步宏**，可按顺序执行或同时触发
- **提供托盘常驻、运行开关和紧急停止**

## 支持

- **GAN 智能**：`v2 / v3 / v4`
- **魔域 智能**：`Moyu32`
> 由于作者没有奇艺智能所以无法测试并兼容（苦鲁西）

可识别的基础转动：

- `U / U'`
- `R / R'`
- `F / F'`
- `D / D'`
- `L / L'`
- `B / B'`

可映射的键鼠行为：

- `A-Z`
- `0-9`
- 方向键
- `Shift / Ctrl / Alt / Space / Enter / Tab / Esc / Backspace`
- 左键
- 右键

## 说明

软件预设了一套面向 **机械动力三阶魔方** 的方案，
也就是这个视频里演示所使用的方案：

[什么叫“用智能魔方在 MC 里玩魔方”?](https://www.bilibili.com/video/BV1ZaQmB4EsG/)

除了预设方案之外，可以发挥自己的想象力和创造力，整更好玩的活

## 注意

- 部分设备连接时需要 **手动输入 MAC 地址**
- **陀螺仪鼠标** 仅兼容支持陀螺仪的魔域智能
- 建议使用 **Windows 11**
- 支持 **托盘常驻、运行开关和紧急停止**

## 致谢

- [csTimer](https://github.com/cs0x7f/cstimer)：智能魔方蓝牙连接层的重要参考
- [weilong-v10-ai-protocol](https://github.com/lukeburong/weilong-v10-ai-protocol)：魔域 v10ai 陀螺仪解析参考
- [Visionary](https://space.bilibili.com/674586122)：配合测试了早期版本功能
- [codex](https://github.com/codex)：开发伙伴（恩情！）
