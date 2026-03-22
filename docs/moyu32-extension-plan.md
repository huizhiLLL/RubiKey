# Moyu32 型号扩展落地方案

本文描述 RubiKey 将智能魔方支持范围从单一 GAN 扩展到 Moyu32 / 魔域新协议时的第一阶段实施方案。

目标不是一次做满，而是先让 Moyu32 跑通现有映射主链路。

---

## 1. 第一阶段目标

第一阶段的目标是：

- 保持现有 GAN 功能不回退
- 将连接层从单品牌驱动重构为统一工厂
- 新增 Moyu32 新协议驱动
- 让 Moyu32 可以输出 RubiKey 当前支持的 12 个基础动作
- 让 Moyu32 进入现有 `move -> Profile -> 宏执行` 链路

第一阶段不要求：

- 完整 facelet 同步
- 电量与硬件信息完整展示
- 历史 move 补偿
- 丢包恢复
- 多品牌同时连接

---

## 2. 总体架构

推荐结构为：

`cube/core -> cube/gan -> cube/moyu32 -> renderer`

其中：

- `cube/core`
  - 统一类型
  - 统一 BLE 连接工厂
  - 通用 MAC 处理
  - 通用加解密工具
- `cube/gan`
  - 现有 GAN 驱动与解析器
- `cube/moyu32`
  - Moyu32 新协议驱动与解析器
- `renderer`
  - 通过统一工厂连接设备，不直接依赖单一品牌驱动

这一结构参考了 cstimer 的：

- 工厂层
- 品牌驱动层
- 上层业务消费层

但会保持 RubiKey 当前更轻量的目标，不引入 csTimer 那套完整 facelet / reconstruction 业务。

---

## 3. 统一接入层设计

建议新增统一接口：

- `SmartCubeDriver`
- `CubeConnectionOptions`
- `CubeDebugEntry`
- `CubeDeviceInfo`
- `CubeModelRegistration`

统一驱动至少需要输出：

- `connect(options)`
- `disconnect()`
- `isConnected()`
- `setMoveListener(listener)`
- `setDebugListener(listener)`
- `getDeviceInfo()`

统一工厂负责：

- 注册品牌模型
- 汇总 `filters`
- 汇总 `optionalServices`
- 汇总 `optionalManufacturerData`
- 调用 `requestDevice()`
- 根据设备名前缀路由到具体驱动

这一步是整个型号扩展里最关键的基础工程。

---

## 4. MAC 策略

本项目继续沿用当前已确认的 MAC 优先级，不改产品交互习惯：

1. 优先使用首页输入框中的 MAC
2. 如果输入框为空，再尝试自动从 advertisement 获取
3. 如果自动获取失败，再提示用户手动输入

建议把这套逻辑抽到 `cube/core/mac.ts`，避免 GAN 和 Moyu32 各自重复实现。

同时建议逐步把 `rubikey.gan.mac` 这种品牌命名的本地存储键升级为更中性的设备映射结构，例如：

- 设备名 -> MAC
- 品牌 + 设备名 -> MAC

第一阶段如果想降低改动范围，也可以先继续沿用单一输入框值，只把文案改成“设备 MAC”。

---

## 5. Moyu32 第一阶段协议范围

参考 cstimer 的 `moyu32cube.js`，第一阶段建议只覆盖这些内容：

- 设备名前缀识别
  - `WCU_MY3`
- Service UUID
  - `0783b03e-7735-b5a0-1760-a305d2795cb0`
- Read characteristic
  - `...cb1`
- Write characteristic
  - `...cb2`
- 初始化请求
  - `161`
  - `163`
  - `164`
- move 消息
  - `165`

Moyu32 与 GAN Gen2/3 使用相近的加密方式，因此可以复用同一套 AES ECB + IV 异或通用工具，但 key/iv 种子需要独立配置。

---

## 6. 数据输出边界

Rubikey 当前上层真正需要的是：

- move
- 本地时间
- 可选设备时间
- 诊断日志
- 当前品牌 / 协议 / 设备名 / MAC

所以 Moyu32 第一阶段的驱动输出只要满足：

- 能解析 `165` 中的 move
- 能把 move 转成现有 `MoveToken`
- 能正常触发 UI 日志与宏执行

就已经足以构成第一阶段闭环。

需要注意：

- cstimer 中 `165` 可能出现多步缓存
- RubiKey 当前只接受 12 个基础动作
- 如果解析到 `U2 / R2` 这类双转，第一阶段不应直接扩展产品模型

建议第一阶段做法：

- 只消费可映射到当前 12 动作的 move
- 对不可消费的 move 写 debug 日志，但不上抛到业务层

---

## 7. UI 与文案调整

为了让多品牌接入不显得别扭，第一阶段需要同步收口这些文案：

- “连接 GAN” -> “连接智能魔方”
- “GAN MAC” -> “设备 MAC”
- 诊断页摘要中的品牌描述改为通用表达
- 关于页把支持范围更新为：
  - GAN
  - Moyu32 新协议（第一阶段）

同时建议在诊断信息中增加：

- `brand`
- `protocol`
- `deviceName`

这样后续排查多品牌问题会轻松很多。

---

## 8. 实施顺序

推荐按以下顺序实施：

1. 新增 `cube/core`
2. 把现有 GAN 驱动适配到统一接口
3. 让 renderer 改为依赖统一工厂
4. 新增 Moyu32 驱动与解析器
5. 改 UI 文案与诊断展示
6. 跑 `typecheck` / `build`

这样做可以尽量保证：

- 每一步都能独立验证
- GAN 不会因为 Moyu32 接入而被一起拖坏

---

## 9. 风险与注意点

### 9.1 MAC 自动获取不稳定

Moyu32 的 advertisement 获取依赖浏览器与绑定状态，自动获取可能失败，因此手动输入兜底必须保留。

### 9.2 不要在第一阶段追求完整状态同步

如果一开始同时做：

- facelet
- 电量
- 硬件信息
- 丢包补偿

会显著拉高复杂度，并拖慢主链路落地。

### 9.3 不要继续在 GAN 驱动里硬塞品牌分支

否则当前的单品牌实现会演变成“假多品牌、真耦合”结构，后续再接 QiYi 会再次重构。

---

## 10. 第一阶段完成标志

以下条件同时满足时，可认为 Moyu32 第一阶段完成：

- UI 中可发起“连接智能魔方”
- 连接到 `WCU_MY3*` 设备后可以完成初始化
- Moyu32 转动能够出现在“最近转动”
- 对应映射能够触发执行回响与宏执行
- 连接诊断中能看见品牌 / 协议 / 设备名 / MAC
- 现有 GAN 功能未回退
