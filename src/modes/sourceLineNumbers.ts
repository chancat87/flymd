type EditorMode = 'edit' | 'preview'

type Metrics = {
  contentWidth: number
  paddingTop: number
  paddingBottom: number
  lineHeight: number
}

type LinePatch = {
  startLine: number
  oldLineCount: number
  newLines: string[]
}

type InputPatchHint = {
  startLine: number
  oldLineCount: number
  startLinePos: number
  endLinePos: number
}

function px(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(String(value || ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function getFlymd(): any {
  return window as any
}

function getEditorMode(): EditorMode {
  try {
    return (getFlymd().flymdGetMode?.() ?? 'edit') as EditorMode
  } catch {
    return 'edit'
  }
}

function isWysiwygMode(): boolean {
  try {
    return !!getFlymd().flymdGetWysiwygEnabled?.()
  } catch {
    return false
  }
}

function splitLines(text: string): string[] {
  return String(text || '').split('\n')
}

function buildLineStarts(lines: string[]): number[] {
  const starts = new Array<number>(lines.length)
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos
    pos += lines[i].length + 1
  }
  return starts
}

function rebuildLineStartsFrom(lines: string[], lineStarts: number[], startLine: number): void {
  if (!lines.length) {
    lineStarts.length = 0
    return
  }
  let pos = 0
  if (startLine > 0) {
    const prev = startLine - 1
    pos = lineStarts[prev] + lines[prev].length + 1
  }
  for (let i = startLine; i < lines.length; i++) {
    lineStarts[i] = pos
    pos += lines[i].length + 1
  }
  lineStarts.length = lines.length
}

function findLineByPos(lineStarts: number[], pos: number, textLength: number): number {
  if (!lineStarts.length) return 0
  const safePos = Math.max(0, Math.min(pos >>> 0, textLength))
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= safePos) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(hi, lineStarts.length - 1))
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix
  let i = 0
  while (i < limit && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++
  return i
}

function createLinePatch(
  prevText: string,
  nextText: string,
  prevLines: string[],
  prevLineStarts: number[],
): LinePatch | null {
  if (prevText === nextText) return null
  const prefix = commonPrefixLength(prevText, nextText)
  const suffix = commonSuffixLength(prevText, nextText, prefix)
  const oldChangeStart = prefix
  const oldChangeEnd = prevText.length - suffix
  const newChangeEnd = nextText.length - suffix
  const startLine = findLineByPos(prevLineStarts, oldChangeStart, prevText.length)
  const endLine = findLineByPos(prevLineStarts, Math.max(oldChangeStart, oldChangeEnd), prevText.length)
  const startLinePos = prevLineStarts[startLine] ?? 0
  const endLinePos = (prevLineStarts[endLine] ?? 0) + (prevLines[endLine]?.length ?? 0)
  const prefixFragment = prevText.slice(startLinePos, oldChangeStart)
  const suffixFragment = prevText.slice(oldChangeEnd, endLinePos)
  const replacement = prefixFragment + nextText.slice(oldChangeStart, newChangeEnd) + suffixFragment
  return {
    startLine,
    oldLineCount: Math.max(1, endLine - startLine + 1),
    newLines: splitLines(replacement),
  }
}

function createInputPatchHint(
  lines: string[],
  lineStarts: number[],
  textLength: number,
  startPos: number,
  endPos: number,
): InputPatchHint | null {
  if (!lines.length || !lineStarts.length) return null
  const safeStart = Math.max(0, Math.min(startPos >>> 0, textLength))
  const safeEnd = Math.max(safeStart, Math.min(endPos >>> 0, textLength))
  const startLine = findLineByPos(lineStarts, safeStart, textLength)
  const endLine = findLineByPos(lineStarts, safeEnd, textLength)
  return {
    startLine,
    oldLineCount: Math.max(1, endLine - startLine + 1),
    startLinePos: lineStarts[startLine] ?? 0,
    endLinePos: (lineStarts[endLine] ?? 0) + (lines[endLine]?.length ?? 0),
  }
}

function createLinePatchFromHint(prevText: string, nextText: string, hint: InputPatchHint): LinePatch | null {
  const tailLength = Math.max(0, prevText.length - hint.endLinePos)
  const nextEndLinePos = Math.max(hint.startLinePos, nextText.length - tailLength)
  if (nextEndLinePos < hint.startLinePos) return null
  return {
    startLine: hint.startLine,
    oldLineCount: hint.oldLineCount,
    newLines: splitLines(nextText.slice(hint.startLinePos, nextEndLinePos)),
  }
}

function readMetrics(editor: HTMLTextAreaElement): Metrics {
  const style = window.getComputedStyle(editor)
  const paddingLeft = px(style.paddingLeft)
  const paddingRight = px(style.paddingRight)
  let lineHeight = px(style.lineHeight)
  if (!lineHeight) {
    const fontSize = px(style.fontSize, 16)
    lineHeight = fontSize * 1.7
  }
  return {
    contentWidth: Math.max(0, editor.clientWidth - paddingLeft - paddingRight),
    paddingTop: px(style.paddingTop),
    paddingBottom: px(style.paddingBottom),
    lineHeight,
  }
}

function applyMeasureStyle(
  shell: HTMLDivElement,
  editor: HTMLTextAreaElement,
  gutter: HTMLDivElement,
  measure: HTMLDivElement,
  metrics: Metrics,
): string {
  const style = window.getComputedStyle(editor)
  const shared: Array<[string, string]> = [
    ['fontFamily', style.fontFamily],
    ['fontSize', style.fontSize],
    ['fontWeight', style.fontWeight],
    ['fontStyle', style.fontStyle],
    ['lineHeight', style.lineHeight],
    ['letterSpacing', style.letterSpacing],
    ['tabSize', (style as any).tabSize || '4'],
  ]
  for (const [key, value] of shared) {
    try {
      ;(gutter.style as any)[key] = value
      ;(measure.style as any)[key] = value
    } catch {}
  }
  shell.style.setProperty('--editor-line-height', `${metrics.lineHeight}px`)
  gutter.style.paddingTop = `${metrics.paddingTop}px`
  gutter.style.paddingBottom = `${metrics.paddingBottom}px`
  measure.style.width = `${metrics.contentWidth}px`
  return [
    editor.clientWidth,
    metrics.contentWidth,
    metrics.paddingTop,
    metrics.paddingBottom,
    metrics.lineHeight,
    style.fontFamily,
    style.fontSize,
    style.letterSpacing,
    style.fontWeight,
    style.fontStyle,
    (style as any).tabSize || '4',
  ].join('|')
}

function createRow(): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'editor-line-number'
  return row
}

function setRowHeight(row: HTMLDivElement, height: number): void {
  row.style.height = `${height}px`
}

function measureLineHeight(
  probe: HTMLDivElement,
  metrics: Metrics,
  lineText: string,
): number {
  probe.textContent = lineText || '\u200b'
  return Math.max(metrics.lineHeight, probe.offsetHeight || 0)
}

function syncScroll(editor: HTMLTextAreaElement, lineNumbers: HTMLDivElement): void {
  lineNumbers.style.transform = `translateY(${-editor.scrollTop}px)`
}

function setActiveRow(rowEls: HTMLDivElement[], nextRow: number, prevRow: number): number {
  const maxRow = rowEls.length
  const safeRow = Math.max(1, Math.min(nextRow, maxRow || 1))
  if (prevRow > 0 && prevRow <= maxRow && prevRow !== safeRow) {
    rowEls[prevRow - 1].classList.remove('active')
  }
  if (safeRow > 0 && safeRow <= maxRow) {
    rowEls[safeRow - 1].classList.add('active')
  }
  return safeRow
}

function hookEditorTextMutations(editor: HTMLTextAreaElement, onTextChanged: () => void): void {
  try {
    const valueDesc =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (valueDesc?.get && valueDesc?.set) {
      const readValue = () => String(valueDesc.get!.call(editor) || '')
      const writeValue = (next: string) => valueDesc.set!.call(editor, next)
      Object.defineProperty(editor, 'value', {
        configurable: true,
        enumerable: valueDesc.enumerable ?? true,
        get() {
          return readValue()
        },
        set(next: string) {
          const prev = readValue()
          writeValue(next)
          if (readValue() !== prev) onTextChanged()
        },
      })
    }
  } catch {}

  try {
    const originalSetRangeText = editor.setRangeText.bind(editor)
    ;(editor as any).setRangeText = (...args: any[]) => {
      const prev = String(editor.value || '')
      const result = originalSetRangeText(...args)
      if (String(editor.value || '') !== prev) onTextChanged()
      return result
    }
  } catch {}
}

function installLineNumbers(): void {
  try {
    const container = document.querySelector('.container') as HTMLDivElement | null
    const editor = document.getElementById('editor') as HTMLTextAreaElement | null
    if (!container || !editor) return
    const flymd = getFlymd()
    if (flymd.__flymdSourceLineNumbersInit) return
    flymd.__flymdSourceLineNumbersInit = true

    const shell = document.createElement('div')
    shell.className = 'editor-shell'

    const gutter = document.createElement('div')
    gutter.className = 'editor-gutter'
    gutter.setAttribute('aria-hidden', 'true')

    const lineNumbers = document.createElement('div')
    lineNumbers.className = 'editor-line-numbers'
    gutter.appendChild(lineNumbers)

    const surface = document.createElement('div')
    surface.className = 'editor-surface'

    const measure = document.createElement('div')
    measure.className = 'editor-line-measure'
    measure.setAttribute('aria-hidden', 'true')

    const measureProbe = document.createElement('div')
    measureProbe.className = 'editor-line-measure-row'
    measure.appendChild(measureProbe)

    const parent = editor.parentElement
    if (!parent) return
    parent.insertBefore(shell, editor)
    shell.appendChild(gutter)
    shell.appendChild(surface)
    surface.appendChild(editor)
    surface.appendChild(measure)

    let lastText = ''
    let lastMetricsKey = ''
    let activeRow = 0
    let rowEls: HTMLDivElement[] = []
    let lines: string[] = ['']
    let lineStarts: number[] = [0]
    let rowHeights: number[] = [0]
    let currentMetrics: Metrics | null = null
    let needsTextRefresh = true
    let needsLayoutRefresh = true
    let raf = 0
    let lastGutterWidth = ''
    let pendingInputPatch: InputPatchHint | null = null

    flymd.flymdGetSourceEditorPositionInfo = (pos: number) => {
      try {
        const textLength = lastText.length >>> 0
        const safePos = Math.max(0, Math.min(pos >>> 0, textLength))
        const lineIndex = findLineByPos(lineStarts, safePos, textLength)
        const lineStart = lineStarts[lineIndex] ?? 0
        return {
          row: lineIndex + 1,
          col: Math.max(1, safePos - lineStart + 1),
          chars: textLength,
        }
      } catch {
        return null
      }
    }

    flymd.flymdGetSourceEditorLineText = (lineNumber: number) => {
      try {
        const idx = Math.max(1, Math.floor(Number(lineNumber) || 1)) - 1
        return lines[idx] ?? ''
      } catch {
        return ''
      }
    }

    flymd.flymdGetSourceEditorLinesSnapshot = () => {
      try {
        return {
          lines,
          lineStarts,
          chars: lastText.length >>> 0,
        }
      } catch {
        return null
      }
    }

    const syncGutterWidth = () => {
      const digits = Math.max(2, String(Math.max(1, lines.length)).length)
      const widthPx = Math.max(48, 20 + digits * 10)
      const next = `${widthPx}px`
      if (next === lastGutterWidth) return false
      lastGutterWidth = next
      shell.style.setProperty('--editor-line-gutter-width', next)
      return true
    }

    const buildAllRows = (metrics: Metrics, text: string) => {
      lines = splitLines(text)
      lineStarts = buildLineStarts(lines)
      rowHeights = new Array<number>(lines.length).fill(metrics.lineHeight)
      rowEls = new Array<HTMLDivElement>(lines.length)
      const frag = document.createDocumentFragment()
      for (let i = 0; i < lines.length; i++) {
        const row = createRow()
        setRowHeight(row, metrics.lineHeight)
        rowEls[i] = row
        frag.appendChild(row)
      }
      lineNumbers.replaceChildren(frag)
      lastText = text
      activeRow = 0
    }

    const remeasureRange = (startLine: number, count: number, metrics: Metrics) => {
      const safeStart = Math.max(0, Math.min(startLine, lines.length))
      const safeEnd = Math.max(safeStart, Math.min(lines.length, safeStart + Math.max(0, count)))
      for (let i = safeStart; i < safeEnd; i++) {
        const height = measureLineHeight(measureProbe, metrics, lines[i] || '')
        rowHeights[i] = height
        if (rowEls[i]) setRowHeight(rowEls[i], height)
      }
    }

    const remeasureAll = (metrics: Metrics) => {
      remeasureRange(0, lines.length, metrics)
    }

    const applyTextPatch = (text: string, metrics: Metrics, hint: InputPatchHint | null) => {
      if (!rowEls.length) {
        buildAllRows(metrics, text)
        remeasureAll(metrics)
        return
      }
      const patch = (hint ? createLinePatchFromHint(lastText, text, hint) : null)
        || createLinePatch(lastText, text, lines, lineStarts)
      if (!patch) return

      const startLine = patch.startLine
      const oldLineCount = patch.oldLineCount
      const newLines = patch.newLines
      const newLineCount = newLines.length
      const sharedCount = Math.min(oldLineCount, newLineCount)
      const nextSibling = rowEls[startLine + oldLineCount] ?? null
      const reusedRows = rowEls.slice(startLine, startLine + sharedCount)
      const newRows = [...reusedRows]

      if (newLineCount > oldLineCount) {
        const frag = document.createDocumentFragment()
        for (let i = 0; i < newLineCount - oldLineCount; i++) {
          const row = createRow()
          newRows.push(row)
          frag.appendChild(row)
        }
        lineNumbers.insertBefore(frag, nextSibling)
      }

      if (oldLineCount > newLineCount) {
        const obsolete = rowEls.slice(startLine + newLineCount, startLine + oldLineCount)
        for (const row of obsolete) {
          try { row.remove() } catch {}
        }
      }

      for (const row of newRows) {
        row.classList.remove('active')
      }

      lines.splice(startLine, oldLineCount, ...newLines)
      rowEls.splice(startLine, oldLineCount, ...newRows)
      rowHeights.splice(startLine, oldLineCount, ...new Array<number>(newLineCount).fill(metrics.lineHeight))
      rebuildLineStartsFrom(lines, lineStarts, startLine)
      remeasureRange(startLine, newLineCount, metrics)
      lastText = text
      activeRow = 0
    }

    const flush = () => {
      raf = 0
      if (!editor.isConnected) return

      const mode = getEditorMode()
      const wysiwyg = isWysiwygMode()
      const stickyNote = document.body.classList.contains('sticky-note-mode')
      shell.classList.toggle('line-numbers-disabled', mode !== 'edit' || wysiwyg || stickyNote)

      const text = String(editor.value || '')

      if (!currentMetrics) {
        currentMetrics = readMetrics(editor)
        buildAllRows(currentMetrics, text)
      }

      const textChanged = needsTextRefresh || text !== lastText
      if (textChanged && currentMetrics) {
        applyTextPatch(text, currentMetrics, pendingInputPatch)
        pendingInputPatch = null
      }

      const gutterWidthChanged = syncGutterWidth()
      const shouldRefreshLayout = needsLayoutRefresh || gutterWidthChanged || !lastMetricsKey
      if (shouldRefreshLayout) {
        currentMetrics = readMetrics(editor)
        lastMetricsKey = applyMeasureStyle(shell, editor, gutter, measure, currentMetrics)
        remeasureAll(currentMetrics)
      }

      syncScroll(editor, lineNumbers)
      const nextRow = findLineByPos(lineStarts, editor.selectionStart >>> 0, text.length) + 1
      activeRow = setActiveRow(rowEls, nextRow, activeRow)
      needsTextRefresh = false
      needsLayoutRefresh = false
    }

    const schedule = (kind: 'text' | 'layout' | 'selection' = 'selection') => {
      if (kind === 'text') needsTextRefresh = true
      if (kind === 'layout') needsLayoutRefresh = true
      if (raf) return
      raf = window.requestAnimationFrame(flush)
    }

    const scheduleExternalTextRefresh = () => {
      pendingInputPatch = null
      schedule('text')
    }

    const flushNowIfNeeded = () => {
      const liveText = String(editor.value || '')
      if (!currentMetrics) {
        currentMetrics = readMetrics(editor)
        buildAllRows(currentMetrics, liveText)
        return
      }
      if (!raf && !needsLayoutRefresh && !needsTextRefresh && liveText === lastText) return
      if (raf) {
        try { window.cancelAnimationFrame(raf) } catch {}
        raf = 0
      }
      flush()
    }

    const captureInputPatchHint = () => {
      try {
        flushNowIfNeeded()
        pendingInputPatch = createInputPatchHint(
          lines,
          lineStarts,
          lastText.length,
          editor.selectionStart >>> 0,
          editor.selectionEnd >>> 0,
        )
      } catch {
        pendingInputPatch = null
      }
    }

    hookEditorTextMutations(editor, () => scheduleExternalTextRefresh())

    editor.addEventListener('beforeinput', () => captureInputPatchHint(), { passive: true } as any)
    editor.addEventListener('input', () => schedule('text'))
    editor.addEventListener('scroll', () => schedule('selection'))
    editor.addEventListener('click', () => schedule('selection'))
    editor.addEventListener('keyup', () => schedule('selection'))
    editor.addEventListener('mouseup', () => schedule('selection'))
    editor.addEventListener('select', () => schedule('selection'))
    editor.addEventListener('focus', () => schedule('selection'))
    editor.addEventListener('cut', () => schedule('text'))
    editor.addEventListener('paste', () => schedule('text'))
    window.addEventListener('resize', () => schedule('layout'))
    window.addEventListener('flymd:mode:changed', () => schedule('layout'))
    window.addEventListener('flymd:theme:changed', () => schedule('layout'))
    window.addEventListener('flymd:localeChanged', () => schedule('layout'))
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === editor) schedule('selection')
    })

    try {
      const ro = new ResizeObserver(() => schedule('layout'))
      ro.observe(surface)
      ro.observe(editor)
    } catch {}

    try {
      if (!flymd.__lineNumbersPatchedOpenFile && typeof flymd.flymdOpenFile === 'function') {
        flymd.__lineNumbersPatchedOpenFile = true
        const original = flymd.flymdOpenFile
        flymd.flymdOpenFile = async (...args: any[]) => {
          const result = await original.apply(flymd, args)
          scheduleExternalTextRefresh()
          return result
        }
      }
    } catch {}

    try {
      if (!flymd.__lineNumbersPatchedNewFile && typeof flymd.flymdNewFile === 'function') {
        flymd.__lineNumbersPatchedNewFile = true
        const original = flymd.flymdNewFile
        flymd.flymdNewFile = async (...args: any[]) => {
          const result = await original.apply(flymd, args)
          scheduleExternalTextRefresh()
          return result
        }
      }
    } catch {}

    schedule('layout')
  } catch {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(installLineNumbers, 800)
  })
} else {
  setTimeout(installLineNumbers, 800)
}

export {}
