import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = resolve(process.argv[2] ?? 'release/win-unpacked/日程管理.exe')
const screenshotPath = resolve(process.argv[3] ?? 'release/render-smoke.png')
const port = 9387
const userDataDirectory = mkdtempSync(join(tmpdir(), 'schedule-manager-render-'))
const child = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDirectory}`,
  '--disable-gpu'
], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }, windowsHide: true })

let processLog = ''
child.stderr.on('data', (chunk) => { processLog += chunk.toString() })

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await delay(250)
  }
  throw new Error('无法连接打包应用的渲染页面')
}

async function inspect() {
  const page = await findPage()
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolveMessage, rejectMessage } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectMessage(new Error(message.error.message))
    else resolveMessage(message.result)
  })
  const send = (method, params = {}) => new Promise((resolveMessage, rejectMessage) => {
    const id = nextId++
    pending.set(id, { resolveMessage, rejectMessage })
    socket.send(JSON.stringify({ id, method, params }))
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await delay(1500)
  const evaluation = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hasAppShell: Boolean(document.querySelector('.app-shell')),
      title: document.title,
      text: document.body.innerText.slice(0, 300),
      bodyChildren: document.body.children.length
    })`,
    returnByValue: true
  })
  const state = JSON.parse(evaluation.result.value)
  const pageChecks = []
  for (const [navigationLabel, expectedText] of [['全部任务', '任务是具体行动'], ['目标', '目标描述想达成的结果']]) {
    const navigation = await send('Runtime.evaluate', {
      expression: `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) => entry.innerText.trim().startsWith(${JSON.stringify(navigationLabel)}))
        if (!button) return false
        button.click()
        return true
      })()`,
      returnByValue: true
    })
    await delay(250)
    const pageResult = await send('Runtime.evaluate', {
      expression: `document.body.innerText.includes(${JSON.stringify(expectedText)})`,
      returnByValue: true
    })
    pageChecks.push({ navigationLabel, opened: Boolean(navigation.result.value && pageResult.result.value) })
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  socket.close()
  if (!state.hasAppShell || pageChecks.some((check) => !check.opened)) throw new Error(`应用页面没有完整渲染：${JSON.stringify({ state, pageChecks })}`)
  return { ...state, pageChecks }
}

try {
  const state = await inspect()
  console.log(JSON.stringify({ success: true, screenshotPath, state }, null, 2))
} catch (error) {
  console.error(processLog)
  console.error(error)
  process.exitCode = 1
} finally {
  child.kill()
  await delay(500)
  if (userDataDirectory.startsWith(tmpdir())) rmSync(userDataDirectory, { recursive: true, force: true })
}
