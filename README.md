# RubiKey

RubiKey 是一个基于 Electron 的 Windows 整活小工具，把智能魔方的转动映射成键鼠操作

核心链路：

`智能魔方 -> 蓝牙连接 -> 转动解析 -> 规则匹配 -> 键鼠执行`

## 特点

- 支持 Windows 11，支持托盘常驻、运行开关和紧急停止
- 魔方转动映射为键鼠操作
- 自定义多套映射方案管理
- 支持多步宏、录制宏、顺序执行/同时触发
- 提供最近转动、执行回响和连接诊断视图
- 对部分支持陀螺仪的 Moyu32 设备提供鼠标移动控制

## 当前支持

### 设备与协议

- GAN 智能魔方 `v2 / v3 / v4`
- Moyu32 / 魔域新协议

### 转动

- `U / U'`
- `R / R'`
- `F / F'`
- `D / D'`
- `L / L'`
- `B / B'`

### 操作

- 键盘：`A-Z`、`0-9`、方向键、`Shift / Ctrl / Alt / Space / Enter / Tab / Esc / Backspace`
- 鼠标：左键 / 右键
- 行为：`tap` / `hold`

## 界面

- 首页：连接状态、设备信息、运行控制、MAC 输入、陀螺仪设置
- 方案映射：Profile 切换、规则编辑、宏配置
- 最近转动：查看魔方输入
- 执行回响：查看触发结果
- 连接诊断：查看连接摘要与通信日志
- 关于：项目相关信息

## 说明

- 部分设备连接仍可能需要手动输入 MAC 作为兜底
- 陀螺仪功能仅对支持对应数据流的设备生效

## 致谢

- [csTimer](https://github.com/cs0x7f/cstimer)：智能魔方蓝牙连接层的重要参考
- [weilong-v10-ai-protocol](https://github.com/lukeburong/weilong-v10-ai-protocol)：魔域 v10ai 陀螺仪解析参考
- [Visionary](https://space.bilibili.com/674586122)：配合测试了早期版本功能
