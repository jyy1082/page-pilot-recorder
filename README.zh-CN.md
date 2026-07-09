# page-pilot-recorder

**中文** · [English](./README.md)

录制页面上真实的用户操作，转换成 [page-pilot](https://github.com/jyy1082/page-pilot) 的 `run()` 能直接吃的步骤数组——录一遍，直接能回放，不用手写选择器。

这是一个配套工具，不是播放引擎的一部分。它只监听真实的（`isTrusted`）DOM 事件，自己从不派发任何事件——跟 page-pilot 正好相反：page-pilot 只派发合成事件、从不监听真实事件。

## Demo

**[打开在线 demo](https://jyy1082.github.io/page-pilot-recorder/demo.html)** —— 在示例表单上正常操作（打字、选国家、勾选框），点 Stop，看看同一套操作序列用 page-pilot 的光标动画自动回放一遍——完全靠录制下来的内容，没有额外手写代码。

## 安装

```bash
npm install page-pilot-recorder
```

或者直接把 `page-pilot-recorder.js` 复制到你的项目里。

## 用法

```js
import { PagePilotRecorder } from 'page-pilot-recorder'

const recorder = new PagePilotRecorder()
recorder.start()

// ...正常操作页面：点击、打字、选择、勾选...

const steps = recorder.stop()
console.log(JSON.stringify(steps, null, 2))
```

输出是一个普通数组，可以直接交给 page-pilot：

```js
import { PagePilot } from 'page-pilot'

const cursor = new PagePilot()
await cursor.run(steps) // recorder.stop() 给你的那个数组，原封不动
```

### 带悬浮控制面板（默认开启）

```js
const recorder = new PagePilotRecorder({ ui: true }) // 默认值
recorder.start()
// 屏幕角落会出现一个"● 0 steps [Stop] [Copy]"的小面板；
// 点 Stop 停止录制，点 Copy 把 JSON 复制到剪贴板
```

### 实时查看每一步被录制下来的内容

```js
const recorder = new PagePilotRecorder({
  onStep: (step) => console.log('录到了:', step),
})
```

## 能录到什么

| 操作 | 生成的步骤 |
|---|---|
| 点击 | `{ type: 'click', target }` |
| 打字（缓冲到失焦才生成，不是逐字符记录） | `{ type: 'type', target, text }` |
| 原生 `<select>`（单选或多选） | `{ type: 'select', target, value }` |
| 复选框/单选框 | `{ type: 'check', target, checked }` |
| 非字符类按键（Enter、Escape、Tab、方向键等），以及任何带修饰键的组合（Ctrl+A、Cmd+S 等） | `{ type: 'pressKey', target, key, options }` |
| 滚动窗口或某个容器，防抖到停下来才记录 | `{ type: 'scroll', target, options }`（滚到边缘时用 `{ to: 'top' \| 'bottom' }`，否则用 `{ amount }`） |

## 不会录到什么（有意为之）

- **`waitFor()` 步骤**——录制器没法知道页面上哪部分是异步加载的，这个需要你自己在生成的脚本里手动加上（用法参考 page-pilot 的 `waitFor()`）。
- **`hover`/`unhover`、`dragTo`**——真实的悬停和拖拽手势跟"鼠标不小心划过去"很难可靠区分，容易产生大量误判，v1 先不做这块，需要自己手动加。
- **`chooseOption`**——自定义下拉菜单会被录成两条独立的 `click` 步骤（点开菜单、点选项），回放起来完全没问题，只是没有用上更语义化的 `chooseOption()` 写法。

录制出来的是一个起点，不是一份可以直接上生产的成品脚本——用之前review一下，尤其是标了 `fragile: true` 的那些步骤（见下文）。

## 选择器生成策略

每个录制步骤的 `target`，是按下面这个顺序依次尝试，谁能生成一个**唯一匹配这个元素**的选择器就用谁：

1. `id`
2. `data-testid` / `data-cy` / `data-test` / `data-qa`
3. `aria-label`
4. `name` 属性
5. 非工具类的 class 名（会过滤掉 Tailwind 那种工具类，比如 `p-2`、`hover:bg-blue-500`，以及压缩后的单字母 class 等）
6. 实在不行，兜底用 `nth-of-type` 结构路径，如果附近有带 `id` 的祖先元素，会从那里开始算

如果某个步骤走到了第 6 级兜底方案，会带上 `fragile: true` 标记——这些是页面结构稍微一变就最容易失效的。看到这个标记，通常更值得做的是给那个元素加一个 `data-testid` 再重新录一遍，而不是就这么把结构路径原样用到生产环境里。

```js
import { generateSelector } from 'page-pilot-recorder'

const { selector, fragile } = generateSelector(document.querySelector('.some-el'))
```

## API

| 方法 | 说明 |
|---|---|
| `new PagePilotRecorder(options?)` | 创建一个录制器，配置项见下文 |
| `start()` | 开始监听操作，返回 `this` |
| `stop()` | 停止监听，返回录制到的步骤数组 |
| `clear()` | 清空已录制的内容，但不停止录制 |
| `destroyUi()` | 移除悬浮控制面板（如果有显示的话） |
| `recorder.steps` | 目前为止录到的步骤（`stop()` 也会返回同样的内容） |

### 配置项

```js
new PagePilotRecorder({
  ui: true,               // 显示悬浮的开始/停止/复制面板
  scrollSettleDelay: 250, // 滚动停下来多久之后才记一条滚动步骤（毫秒）
  onStep: (step) => {},   // 每录到一步就会调用一次
})
```

## 协议

MIT
