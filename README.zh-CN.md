# page-pilot-recorder

**中文** · [English](./README.md)

**版本 0.3.2** · 完整版本历史见 [CHANGELOG.md](./CHANGELOG.md)

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
| 打开一个自定义下拉菜单，并选中里面的一个选项 | `{ type: 'chooseOption', target, option, options: { waitAfterOpen } }`——自动合并，见下文 |
| 一次拖拽手势（按下、移动超过阈值、松开） | `{ type: 'dragTo', target, destination }`——`destination` 如果松开时鼠标下面有元素就是选择器，否则就是一个原始的 `{ x, y }` 坐标点 |

任何步骤都可能额外带上：
- **`frame`**——如果这次操作发生在一个同源 iframe 里面（是一个 iframe 选择器，多层嵌套的话是数组），这样 page-pilot 才知道该去哪个文档里找。详见下面的"iframe 支持"。
- **`gapBefore`**（毫秒）——如果这一步之前停顿了很久，提醒你这里可能是在等什么东西加载。详见下面的"等待提示"。
- **`fragile: true`**——如果选择器退到了结构路径兜底方案。详见下面的"选择器生成策略"。

### 自定义下拉菜单识别（chooseOption）

如果一次点击"揭示"了什么东西（`MutationObserver` 监测到 DOM 变化——不管是某个原本隐藏的菜单的 `style`/`class`/`hidden` 属性变了，还是直接插入了全新的节点），紧接着又点了刚出现的这块内容里面的东西，这两次点击会自动合并成一条 `chooseOption` 步骤，而不是两条独立的 `click`——前提是这中间没有夹杂别的操作，并且第二次点击是在 `chooseOptionMergeWindow`（默认 4000ms）这个时间窗口内发生的。两次真实点击之间的间隔会被记录成 `options.waitAfterOpen`，这样回放的时候节奏跟当时真实操作的一致。

这是个启发式判断，不是绝对准确——如果你更想要"永远拆成两条 click，自己决定要不要合并"，把 `mergeChooseOption` 设成 `false` 就行。

### 拖拽识别（dragTo）

`mousedown` 之后移动超过一定距离（`dragThreshold`，默认 10px）再 `mouseup`，就算作一次拖拽而不是点击——浏览器本身在指针移动这么多之后就不会再触发 `click` 事件了，所以不用担心同一个手势被重复记录。如果松开鼠标的时候页面上有一段非空的文字被选中了，说明这更可能是在选文字而不是拖拽 UI 元素，这种情况完全不会被录下来（文字选中这种交互没法"回放"）。把 `recordDragTo` 设成 `false` 可以完全关闭这个功能。

### 等待提示（gapBefore）

如果某一步之前停顿超过了 `waitHintThreshold`（默认 1200ms），这一步会带上 `gapBefore`（毫秒）字段，并触发 `onWaitHint(gapMs, step)`。**这不是**自动生成的 `waitFor()` 步骤——录制器没法知道该等哪个选择器——只是提醒你"这里停顿了一下，可能当时在等什么东西异步加载"，生成的脚本这个位置也许该手动加一条 `waitFor()`。

```js
const recorder = new PagePilotRecorder({
  onWaitHint: (gapMs, step) => console.log(`这一步之前停顿了 ${gapMs}ms`, step),
})
```

### iframe 支持

**同源** iframe 里的操作会跟别的操作一样被正常录下来，只是会多带一个 `frame` 字段，告诉 page-pilot 该去哪个文档里找这个选择器：

```json
{ "type": "click", "target": "#confirm-btn", "frame": "#payment-iframe" }
```

如果是多层嵌套的 iframe，`frame` 会是个数组（从最外层到最内层）。page-pilot 那边完全"开箱即用"——录制出来的步骤直接丢给 `run()` 就行，不需要手动调整。**跨域的 iframe 完全没法监听**——这是浏览器安全机制层面的硬限制（任何自动化工具不借助服务端配合都进不去跨域 iframe），不是这个库能想办法绕过的。把 `recordIframes` 设成 `false` 可以完全关闭 iframe 遍历。

## 不会录到什么（有意为之）

- **密码框**——`<input type="password">` 永远不会被录制，连一条带真实值的 `type` 步骤都不会有。这是硬性排除，不是可以配置的选项——生成的自动化脚本里没有任何正当理由应该包含别人打的密码。
- **你自己写的录制控制按钮**——如果你不用内置的悬浮面板，而是自己写了 Start/Stop/Replay 这些按钮，记得给它们加上 `data-ppr-ignore`，不然点"Stop"这个动作本身也会被当成这次录制的最后一步录进去：
  ```html
  <button id="stop-btn" data-ppr-ignore>Stop</button>
  ```

- **`waitFor()` 步骤本身**——上面"等待提示"那部分是目前能做到的最接近自动化的辅助，具体要等什么还是得你自己决定。
- **`hover`/`unhover`**——真实的悬停手势跟"鼠标不小心划过去"很难可靠区分，容易产生大量误判，需要自己手动加。

录制出来的是一个起点，不是一份可以直接上生产的成品脚本——用之前review一下，尤其是标了 `fragile: true` 的那些步骤（见下文）。

## 选择器生成策略

每个录制步骤的 `target`，是按下面这个顺序依次尝试，谁能生成一个**唯一匹配这个元素**的选择器就用谁：

1. `id`
2. `data-testid` / `data-cy` / `data-test` / `data-qa`
3. 其他任意 `data-*` 属性（比如自定义下拉选项上的 `data-value`）——这类属性通常是应用自己的逻辑要读取的，即使不是专门为测试而加，也往往很稳定
4. `aria-label`
5. `name` 属性
6. 非工具类的 class 名（会过滤掉 Tailwind 那种工具类，比如 `p-2`、`hover:bg-blue-500`，以及压缩后的单字母 class 等）
7. 实在不行，兜底用 `nth-of-type` 结构路径，如果附近有带 `id` 的祖先元素，会从那里开始算

如果某个步骤走到了第 7 级兜底方案，会带上 `fragile: true` 标记——这些是页面结构稍微一变就最容易失效的。看到这个标记，通常更值得做的是给那个元素加一个 `data-testid` 再重新录一遍，而不是就这么把结构路径原样用到生产环境里。

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
  mergeChooseOption: true, // 把"打开菜单点击"+"选项点击"识别合并成一条 chooseOption
  chooseOptionMergeWindow: 4000, // 两次点击之间超过多久就不再合并（毫秒）
  recordDragTo: true,     // 把 mousedown-移动-mouseup 这种手势识别成 dragTo 步骤
  dragThreshold: 10,      // 移动超过多少像素才算拖拽而不是点击
  waitHintThreshold: 1200, // 停顿超过多久，就给这一步加上 gapBefore 提示（毫秒）
  recordIframes: true,    // 是否也录制同源 iframe 里的操作
  onStep: (step) => {},   // 每录到一步就会调用一次
  onWaitHint: (gapMs, step) => {}, // 检测到长时间停顿时调用
})
```

## 测试

```bash
npm install
npm test
```

跑的是**真实浏览器**的回归测试（Playwright + Chromium），不是模拟的——这个区别在这个项目上特别重要。之前几个最早的 bug（输入框在 `start()` 之前就已经聚焦时打字全丢、焦点转移到 `<select>` 时没有可观察到的 `focusout` 导致打字丢失、点击录制器自己的 Stop 按钮被自我录制），**全部**在 jsdom 测试套件里 100% 通过——jsdom 的合成事件派发没法精确复现真实浏览器的焦点时机，所以测不出来。`test/browser-test.mjs` 会真的开一个 Chromium 实例，用真人操作的方式跟测试页面交互（`page.fill()`、`page.click()`、`page.selectOption()`、`keyboard.press()`），这正是当初真正暴露出这些 bug 的方式。

如果你的环境访问不了 `cdn.playwright.dev`（`npx playwright install` 会失败，一些沙盒/CI 环境会拦截这个域名），测试脚本换了一种方式拿可用的 Chromium——用 `@sparticuz/chromium` 这个包，它把浏览器二进制文件直接打包进了 npm 包本身（而不是走单独的下载步骤），然后让 Playwright 直接指向这个可执行文件。

## 协议

MIT
