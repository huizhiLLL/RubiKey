# csTimer 智能魔方蓝牙连接逻辑梳理

本文整理 `cstimer/` 源码中智能魔方蓝牙连接相关实现，重点说明整体架构、连接流程、数据流，以及各品牌设备驱动在这套架构中的位置。

## 1. 总体分层

csTimer 的智能魔方蓝牙能力不是集中写在一个文件里，而是分成了 3 层：

1. 统一 BLE 设备工厂层  
   位置：`cstimer/src/js/hardware/bluetooth.js`

2. 设备协议适配层  
   位置：`cstimer/src/js/hardware/*.js`

3. 业务编排层  
   位置：`cstimer/src/js/tools/bluetoothutil.js` 与 `cstimer/src/js/timer/giiker.js`

这 3 层分别负责：

- 工厂层：扫描设备、建立连接、根据设备名前缀选择驱动、统一断开逻辑
- 适配层：按品牌协议解析蓝牙数据，恢复魔方状态、移动序列和时间戳
- 业务层：把“硬件状态”转换成 csTimer 内部可用的“已打乱/开始/复原完成/成绩入库”等业务行为

可以把它概括为：

`WebBluetooth 扫描 -> 设备驱动匹配 -> 协议解析 -> 状态归一化 -> 计时器业务状态机`

---

## 2. 统一 BLE 工厂层

核心文件是 `cstimer/src/js/hardware/bluetooth.js`。

### 2.1 工厂对象

`BtDeviceGroupFactory()` 负责创建一个“设备组控制器”。源码里基于它实例化了两个对象：

- `GiikerCube`
- `BluetoothTimer`

其中：

- `GiikerCube` 面向智能魔方
- `BluetoothTimer` 面向蓝牙计时器

两者共用同一套 BLE 管理抽象，只是注册进去的驱动不同。

### 2.2 注册机制

工厂里维护一个 `cubeModels` 映射表，结构本质上是：

`{ 设备名前缀: 驱动对象 }`

驱动通过 `regCubeModel(cubeModel)` 注册，典型信息包括：

- `prefix`：设备名前缀，可能是字符串或数组
- `init(device)`：建立连接并初始化驱动
- `clear(isHardwareEvent)`：清理通知、释放资源
- `opservs`：扫描时声明的 optional services
- `cics`：需要的 manufacturer data company id
- `getBatteryLevel()`：读取电量

所以这里本质上是一个“按名字路由到具体协议驱动”的插件机制。

### 2.3 连接流程

`init(reconnect)` 是统一连接入口：

1. 调用 `giikerutil.chkAvail()` 检查浏览器 WebBluetooth 能力
2. 汇总所有已注册驱动的 `prefix / opservs / cics`
3. 调用 `navigator.bluetooth.requestDevice(...)`
4. 让用户选择设备
5. 根据 `device.name` 的前缀匹配对应驱动
6. 调用该驱动的 `init(device)`

也就是说，BLE 扫描阶段还不知道是哪种协议，真正选型是拿到设备名以后做前缀匹配。

### 2.4 Advertisement 支持

`waitForAdvs()` 和 `waitUntilDeviceAvailable()` 利用了 `watchAdvertisements()`：

- `waitForAdvs()`：等待一帧 advertisement，并取回 `manufacturerData`
- `waitUntilDeviceAvailable()`：重连时等待设备再次发广播

这一步对 GAN、魔域 32、QiYi 这类需要从广播包中推导 MAC 或厂家数据的设备很重要。

### 2.5 回调约定

工厂层暴露了两个回调：

- `setCallback(func)`：魔方状态数据回调
- `setEventCallback(func)`：硬件事件回调，如断开连接

设备驱动最后都要把解析后的结果回推到这两个统一出口，而不是直接碰业务层。

---

## 3. 设备协议适配层

这一层位于 `cstimer/src/js/hardware/`，每个品牌一个文件。它们的共同目标是：

- 连接特定 service / characteristic
- 订阅通知或轮询特征值
- 解析原始 BLE 数据
- 恢复为标准状态：
  - `facelet`
  - `prevMoves`
  - `[deviceTs, localTs]`
  - `deviceName`

最后统一调用：

`GiikerCube.callback(facelet, prevMoves, timestamps, deviceName)`

### 3.1 已注册的智能魔方驱动

当前源码中挂到 `GiikerCube` 的主要驱动有：

- `giikercube.js`
- `gocube.js`
- `gancube.js`
- `moyucube.js`
- `moyu32cube.js`
- `qiyicube.js`

它们分别通过 `GiikerCube.regCubeModel(...)` 注册。

---

## 4. 各设备驱动逻辑

### 4.1 Giiker / Mi Smart

文件：`cstimer/src/js/hardware/giikercube.js`

特点：

- 早期智能魔方协议
- 直接连接固定 service / characteristic
- 订阅通知后读取状态
- `parseState()` 将原始 20 字节数据还原成角块、棱块和面状态

实现上它会：

1. `device.gatt.connect()`
2. 获取数据 service 与 characteristic
3. `startNotifications()`
4. 在 `characteristicvaluechanged` 中调用 `parseState()`
5. 从数据中提取：
   - 当前 facelet
   - 最近几步 move
   - 设备名

还支持通过读写 service 获取电量。

### 4.2 GoCube / Rubik's Connected

文件：`cstimer/src/js/hardware/gocube.js`

特点：

- 消息是帧式协议
- 用消息类型区分 move、state、battery 等
- move 数据一来就直接推进当前 `CubieCube`

`parseData()` 会根据 `msgType` 区分：

- `1`：move
- `2`：cube state
- `5`：battery

这里的状态推进方式比较直接：收到一步 move，就用 `CubieCube.moveCube` 计算下一状态，然后立刻触发统一 callback。

### 4.3 Moyu 旧协议

文件：`cstimer/src/js/hardware/moyucube.js`

特点：

- 使用 turn/gyro/read 多个 characteristic
- turn 事件里包含面转动信息
- 通过面转动累计判断是否跨过半圈，从而识别成标准魔方步

它不是直接下发完整 facelet，而是更接近“转动传感器事件流”。

### 4.4 Moyu 32 协议

文件：`cstimer/src/js/hardware/moyu32cube.js`

这是比较完整的一版。

关键流程：

1. 先通过 `GiikerCube.waitForAdvs()` 取 advertisement
2. 从 manufacturer data 里尝试拿到设备蓝牙 MAC
3. 如果自动获取失败，再通过 `giikerutil.reqMacAddr()` 让用户输入
4. 根据 MAC 派生 AES key/iv
5. 建立 GATT 连接并订阅读特征
6. 主动发请求读取：
   - cube info
   - cube status
   - battery

`parseData()` 区分多种消息：

- `161`：硬件信息
- `163`：初始面状态
- `164`：电量
- `165`：move

`updateMoveTimes()` 的作用很关键，它会：

- 处理设备 move counter
- 利用设备侧时间偏移恢复每一步的设备时间
- 再对齐到本地时间

这说明作者并不满足于“只拿到 move 顺序”，而是希望把每一步的时间也尽量拟合准确，用于后续 reconstruction。

### 4.5 QiYi / Tornado V4 智能版

文件：`cstimer/src/js/hardware/qiyicube.js`

关键点：

- 也依赖 advertisement 拿 MAC
- 连接后先 `sendHello(mac)` 做握手
- 数据整体做 AES 解密
- 带 CRC 校验

`parseCubeData()` 里有两个核心 opcode：

- `0x2`：hello / 初始状态
- `0x3`：状态变化

在状态变化消息中，它不仅取当前 move，还会检查历史 move 区段，尽量补全漏掉的步骤，再统一回调给上层。

### 4.6 GAN 多协议驱动

文件：`cstimer/src/js/hardware/gancube.js`

这是整套蓝牙魔方代码里最复杂、也最工程化的一部分。

#### 4.6.1 多版本协议自动分流

`init(device)` 建立连接后不会假设协议固定，而是先枚举 services，然后按优先级判断：

- v2 service
- v3 service
- v4 service
- 否则回退到 v1

对应初始化函数：

- `v1init()`
- `v2init()`
- `v3init()`
- `v4init()`

这意味着同一个品牌的不同代设备，在上层看来仍是同一个驱动入口，但内部做了协议分派。

#### 4.6.2 密钥与 MAC

GAN 多代协议都涉及密钥派生。

常见路径是：

1. 尝试从 advertisement 中取设备 MAC
2. 如果失败，则调用 `giikerutil.reqMacAddr()` 提示用户输入
3. 基于 MAC 和固件版本生成 key/iv
4. 用 AES 对数据做解密和编码

这也是为什么 `bluetoothutil.js` 里专门有 MAC 缓存逻辑。

#### 4.6.3 初始状态与 move 流

GAN 驱动同时维护：

- `latestFacelet`
- `prevCubie`
- `curCubie`
- `moveCnt / prevMoveCnt`
- `deviceTime / deviceTimeOffset`
- `moveBuffer`

其中：

- `initCubeState()`：建立初始状态，触发第一次 callback
- `updateMoveTimes()`：把 move counter、时间偏移和本地时间整合起来

#### 4.6.4 v2 / v3 / v4 解析

对应解析函数：

- `parseV2Data()`
- `parseV3Data()`
- `parseV4Data()`

它们都会从协议帧里提取：

- 初始 facelet
- move 序列
- move counter
- battery
- hardware info

#### 4.6.5 丢包恢复

GAN v3/v4 还额外做了丢包补偿，这是非常重要的工程细节。

核心机制包括：

- `moveBuffer`：FIFO 缓冲尚未确认顺序的 move
- `requestMoveHistory(...)`：向设备主动请求历史 move
- `injectLostMoveToBuffer(...)`：把找回的 move 插回缓冲区
- `evictMoveBuffer(...)`：按 move counter 递增顺序把 move 正式出队并推进 cube state

这套逻辑的目的是处理蓝牙通知丢失、不按时到达、状态包超前等问题，尽量保证上层拿到的是连续 move 流。

这是整个智能魔方连接方案里最体现“工程成熟度”的部分。

---

## 5. 中间层：bluetoothutil.js

文件：`cstimer/src/js/tools/bluetoothutil.js`

这一层不再关心“设备是哪家”，而是关心：

- 当前魔方处于什么状态
- 以哪个状态作为 solved 基准
- 当前 scramble 是否完成
- move 时间戳如何拟合
- reconstruction 如何生成
- UI 上如何展示连接状态、电量、二维展开图、raw/pretty 解法链接

它本质上是“设备驱动与 timer 业务之间的统一状态归一化层”。

### 5.1 初始化

`init()` 做的事包括：

1. 清理旧状态
2. 读取持久化的 `giiSolved` 作为 solved 基准
3. 调用 `GiikerCube.setCallback(giikerCallback)`
4. 调用 `GiikerCube.setEventCallback(giikerEvtCallback)`
5. 如果尚未连接，则调用 `GiikerCube.init()`

也就是说，真正把驱动层和上层业务层接起来的，就是这里注册的 callback。

### 5.2 统一状态回调

`giikerCallback(facelet, prevMoves, lastTs, hardware)` 是整个链路的核心枢纽之一。

它主要做这些事：

- 更新当前设备名和 UI
- 把设备原始状态 `curRawState` 转成相对于 solved 基准的 `curState`
- 维护 move 时间序列 `moveTsList`
- 维护二维展开图
- 更新斜率和电量显示
- 触发 scramble hint 检查
- 再把归一化后的状态交给业务层 callback

这里有一个重要概念：`solvedStateInv`

它允许“把当前物理状态定义为 solved”，这样后续来自设备的真实状态可以转换成 csTimer 认为的逻辑状态。这是为了兼容：

- 初始朝向不同
- 设备与软件 solved 基准不一致
- 需要手动重标定 solved 的场景

### 5.3 已打乱 / 已复原基准控制

`markSolved()`  
把当前状态标记为 solved 基准。

`markScrambled(virtual)`  
把当前状态标记为“打乱完成，进入 solve 视角”。如果是虚拟模式，可能会使用 scramble 目标状态而不是当前真实状态。

`reSync()`  
取消“虚拟 hack”状态，回到真实同步状态。

### 5.4 时间拟合与重建

`tsLinearFit()`、`tsApplyFixes()`、`tsLinearFix()` 负责：

- 用设备时间与本地时间做线性拟合
- 修正丢失 move 的时间戳
- 生成更可靠的逐步时间序列

这部分最终服务于：

- raw moves 导出
- pretty reconstruction
- 成绩入库时的细分步骤时间

### 5.5 MAC 管理

`reqMacAddr(...)` 统一处理：

- 自动获取的 MAC
- 用户手动输入的 MAC
- 错误 key 的重输
- 以 `deviceName -> MAC` 的形式持久化缓存到 `giiMacMap`

这个抽象让 GAN、QiYi、Moyu32 这些需要 MAC 派生密钥的协议可以复用统一逻辑。

---

## 6. 计时业务编排层：timer/giiker.js

文件：`cstimer/src/js/timer/giiker.js`

这一层负责把“魔方状态流”编排成“计时器状态机”。

### 6.1 连接入口

`startConnect()` 会弹出蓝牙连接对话框，并调用 `giikerutil.init()`。

`timer.giiker.setEnable(input)` 控制当前输入源是否切到智能魔方模式：

- `input == 'g'`：启用智能魔方输入
- 否则停止并断开

### 6.2 核心回调

`giikerCallback(facelet, prevMoves, lastTs)` 是 timer 视角下的主回调。

它的编排逻辑大致是：

1. 收到当前面状态和最近 moves
2. 如果启用了 VRC，同步更新虚拟魔方显示
3. 根据当前 `timer.status()` 决定处于哪个业务阶段

主要业务阶段包括：

- `-1`：空闲，等待开始
- `-2 / -3`：已打乱，等待正式开解或 inspection
- `>=1`：正在 solve，多阶段进度中

### 6.3 自动起跑

在空闲状态下，如果当前状态满足条件，系统会尝试触发 `markScrambled(now)`。

触发方式支持几种策略：

- 根据 scramble 是否已完成
- 延迟若干秒后自动开始
- 根据特定 move 模式开始，例如某些预设起手

所以这里不仅是“连接蓝牙后显示状态”，而是直接让智能魔方参与计时开始判定。

### 6.4 solve 过程

进入 solve 后，它会：

- 记录 inspection 时间
- 初始化多阶段数据结构
- 根据 CFOP 等方法更新阶段进度
- 累积 `rawMoves`

### 6.5 solve 结束

当 `isGiiSolved(currentFacelet)` 返回真时：

1. 判定 solve 结束
2. 生成 pretty reconstruction
3. 调用 `giikerutil.reSync()`
4. 用 `tsLinearFix(rawMoves.flat())` 对时间做拟合
5. 把结果通过 `kernel.pushSignal('time', ...)` 推入 csTimer 成绩系统

如果不是普通模式，还可能在结束后自动切下一条 scramble。

所以真正“成绩写入 csTimer”的动作是在这里发生的，而不是在驱动层。

---

## 7. scramble / hint / UI 配合

智能魔方蓝牙逻辑还和其他模块有配合：

- `scrHinter`  
  负责判断当前状态在 scramble 上执行到了哪一步，并在 UI 中高亮提示

- `kernel.regListener(...)`  
  监听 scramble、property、timestd 等信号，让蓝牙状态与 csTimer 全局状态同步

- `tools.regTool('giikerutil', ...)`  
  把连接面板注册成工具项

因此，这套逻辑不是孤立的“硬件接入”，而是已经嵌进了 csTimer 的 scramble、训练、重建和计时 UI 体系。

---

## 8. 完整时序

从用户点击连接到成绩入库，大致时序如下：

1. 用户切换输入源到智能魔方
2. `timer/giiker.js` 调用 `startConnect()`
3. `giikerutil.init()` 注册统一回调
4. `GiikerCube.init()` 调用 BLE 工厂层
5. 工厂层 `requestDevice()`，用户选择设备
6. 根据设备名前缀匹配驱动
7. 驱动建立 GATT 连接、订阅 characteristic
8. 驱动解析协议帧，还原 `facelet + prevMoves + timestamps`
9. 调用 `GiikerCube.callback(...)`
10. `bluetoothutil.giikerCallback()` 统一状态、时间与 solved 基准
11. `timer/giiker.js` 的回调根据当前状态机决定：
    - 是否已打乱
    - 是否开始计时
    - 是否完成 solve
12. solve 完成后生成 reconstruction，并通过 `kernel.pushSignal('time', ...)` 入库

---

## 9. 架构评价

从代码组织上看，这套实现有几个明显特点：

- 分层清晰  
  BLE 连接、协议解析、状态归一化、计时业务是分开的

- 扩展性不错  
  新增品牌通常只需要增加一个新的 driver，并注册到 `GiikerCube`

- 工程现实感很强  
  处理了浏览器兼容性、advertisement、MAC 输入、AES 解密、丢包恢复、时间拟合等问题

- GAN 支持尤其成熟  
  多代协议兼容、move history 补偿、FIFO 缓冲、丢包恢复都比较完整

但也有一些特点需要注意：

- 驱动层和业务层都比较依赖全局对象，如 `kernel`、`mathlib`、`cubeutil`
- 回调链是函数式拼接，不是显式类型化接口，阅读门槛较高
- 某些协议的解析逻辑较长，尤其 `gancube.js`，维护成本不低

---

## 10. 一句话总结

csTimer 的智能魔方蓝牙方案，本质上是：

“用统一 BLE 工厂管理连接，用多品牌协议驱动解析状态，用 `bluetoothutil` 统一魔方状态与时间语义，再由 `timer/giiker.js` 把这些状态编排成自动计时与成绩记录流程。”

其中最核心的代码主干是：

- `cstimer/src/js/hardware/bluetooth.js`
- `cstimer/src/js/hardware/gancube.js`
- `cstimer/src/js/hardware/moyu32cube.js`
- `cstimer/src/js/hardware/qiyicube.js`
- `cstimer/src/js/hardware/giikercube.js`
- `cstimer/src/js/hardware/gocube.js`
- `cstimer/src/js/tools/bluetoothutil.js`
- `cstimer/src/js/timer/giiker.js`
