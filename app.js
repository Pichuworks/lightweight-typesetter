(() => {
  'use strict';

  const APP_VERSION = '4.0.0';
  const STORAGE_KEY = 'light-typesetter-state-v4';
  const MAX_SAVED_TEXT = 1_000_000;

  const state = {
    rawText: '',
    formattedBlocks: [],
    useRawBreaks: false,
    fileName: '未命名文本',
    template: 'comfort',
    font: 'serif',
    size: 'medium',
    spacing: 'standard',
    theme: 'ivory'
  };

  const els = {
    inputView: document.getElementById('inputView'),
    previewView: document.getElementById('previewView'),
    sourceText: document.getElementById('sourceText'),
    uploadButton: document.getElementById('uploadButton'),
    fileInput: document.getElementById('fileInput'),
    fileStatus: document.getElementById('fileStatus'),
    clearButton: document.getElementById('clearButton'),
    formatButton: document.getElementById('formatButton'),
    backButton: document.getElementById('backButton'),
    restoreButton: document.getElementById('restoreButton'),
    documentName: document.getElementById('documentName'),
    documentMeta: document.getElementById('documentMeta'),
    paper: document.getElementById('paper'),
    sheetBackdrop: document.getElementById('sheetBackdrop'),
    printButton: document.getElementById('printButton'),
    imageButton: document.getElementById('imageButton'),
    copyButton: document.getElementById('copyButton'),
    imageDialog: document.getElementById('imageDialog'),
    imageOutput: document.getElementById('imageOutput'),
    closeImageDialog: document.getElementById('closeImageDialog'),
    toast: document.getElementById('toast')
  };

  let toastTimer = null;
  let saveTimer = null;
  let currentImageUrl = null;

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 1800);
  }

  function switchView(view) {
    els.inputView.classList.toggle('view-active', view === 'input');
    els.previewView.classList.toggle('view-active', view === 'preview');
  }

  function normalizeText(text) {
    return text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00A0\u3000]+/g, ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/^\s+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function compactForHeading(text) {
    return text
      .trim()
      .replace(/[\u3000\t ]+/g, '')
      .replace(/^[#＃]+|[#＃]+$/g, '')
      .replace(/[：:—–-]+$/u, '');
  }

  function stripHeadingDecoration(text) {
    return text
      .trim()
      .replace(/^[\s　]*[【\[《〈「『（(]*[\s　]*/u, '')
      .replace(/[\s　]*[】\]》〉」』）)]*[\s　]*$/u, '')
      .replace(/^[#＃*=~～·•—─_\-\s]+|[#＃*=~～·•—─_\-\s]+$/gu, '')
      .trim();
  }

  function isHeading(line) {
    const original = String(line || '').trim();
    if (!original) return false;

    const visibleLength = [...original.replace(/\s/g, '')].length;
    if (visibleLength > 80) return false;

    const undecorated = stripHeadingDecoration(original);
    const compact = compactForHeading(undecorated);

    // 中文章节：允许“第 12 章 标题”“第十二回：标题”“卷一 风雪夜”等常见写法。
    const chineseChapter = /^第\s*[零〇一二三四五六七八九十百千万两0-9０-９]+\s*[章节卷部篇回幕集辑册季期](?:\s*[：:、.．·—–\-丨|｜]?\s*.{0,48})?$/u;
    const volumeChapter = /^(?:卷|篇|部|册|幕)\s*[零〇一二三四五六七八九十百千万两0-9０-９]+(?:\s*[：:、.．·—–\-丨|｜]?\s*.{0,48})?$/u;
    const namedHeading = /^(?:正文|序章|序言|前言|引言|楔子|引子|开篇|后记|跋|尾声|终章|终篇|番外(?:篇|章)?|附录|目录|卷首语|卷尾语|上篇|中篇|下篇)(?:\s*[：:、.．·—–\-丨|｜]?\s*.{0,48})?$/u;
    const englishHeading = /^(?:chapter|chap\.?|part|book|volume|section)\s*(?:no\.?\s*)?[0-9ivxlcm０-９]+(?:\s*[：:、.．·—–\-丨|｜]?\s*.{0,48})?$/iu;
    const numericHeading = /^(?:[零〇一二三四五六七八九十百千万两]+|[0-9０-９]{1,4})\s*[、.．：:]\s*\S.{0,40}$/u;

    if (chineseChapter.test(undecorated)
      || volumeChapter.test(undecorated)
      || namedHeading.test(undecorated)
      || englishHeading.test(undecorated)
      || numericHeading.test(undecorated)) return true;

    // 独占一行的书名号、方括号标题。
    if (/^(?:【[^】]{1,48}】|\[[^\]]{1,48}\]|《[^》]{1,48}》)$/u.test(original)) return true;

    // 带装饰符的短行，例如“—— 第一章 雨夜 ——”“### 第三节”。
    if (undecorated !== original && visibleLength <= 60) {
      return chineseChapter.test(undecorated)
        || volumeChapter.test(undecorated)
        || namedHeading.test(undecorated)
        || englishHeading.test(undecorated);
    }

    return false;
  }


  function hasSentencePunctuation(text) {
    return /[。！？!?；;：:“”「」『』]/u.test(text.trim());
  }

  function isLikelyImplicitHeading(lines, index) {
    const line = (lines[index] || '').trim();
    if (!line || isHeading(line) || isDivider(line)) return false;

    const length = charLength(line);
    if (length < 2 || length > 28) return false;
    if (hasSentencePunctuation(line)) return false;
    if (/^[“「『（(【《]/u.test(line)) return false;
    if (/^[—-]/u.test(line)) return false;

    const previous = index > 0 ? (lines[index - 1] || '').trim() : '';
    const next = index + 1 < lines.length ? (lines[index + 1] || '').trim() : '';
    const previousNonEmptyIndex = (() => {
      for (let i = index - 1; i >= 0; i -= 1) if ((lines[i] || '').trim()) return i;
      return -1;
    })();
    const nextNonEmptyIndex = (() => {
      for (let i = index + 1; i < lines.length; i += 1) if ((lines[i] || '').trim()) return i;
      return -1;
    })();
    const nextNonEmpty = nextNonEmptyIndex >= 0 ? lines[nextNonEmptyIndex].trim() : '';

    // 文档开头允许连续两行短标题，例如“雨停时分 / 一份关于旧城的记录”。
    const nonEmptyBefore = lines.slice(0, index).filter(item => item.trim()).length;
    if (nonEmptyBefore <= 1) {
      if (nextNonEmpty && charLength(nextNonEmpty) <= 36 && !endsSentence(nextNonEmpty)) return true;
      if (nextNonEmpty && charLength(nextNonEmpty) >= Math.max(14, length * 1.5)) return true;
    }

    // 正文中的无标记标题：自身被空行隔开，下一段明显更长。
    const blankBefore = index === 0 || !previous;
    const blankAfter = index === lines.length - 1 || !next;
    const isolated = blankBefore && blankAfter;
    if (isolated && nextNonEmpty) {
      const nextLength = charLength(nextNonEmpty);
      if (nextLength >= Math.max(12, length * 1.45)) return true;
      if (previousNonEmptyIndex >= 0) {
        const previousNonEmpty = lines[previousNonEmptyIndex].trim();
        if (endsSentence(previousNonEmpty) && nextLength > length) return true;
      }
    }

    return false;
  }

  function isDivider(line) {
    return /^(?:[*＊·•—─\-_=~～]{3,}|[◇◆※☆★]+)$/u.test(line.trim());
  }

  function endsSentence(line) {
    return /[。！？!?…」』”’）》】〕〉：:；;]$/u.test(line.trim());
  }

  function startsParagraphLike(line) {
    return /^(?:[“「『（(【《]|[-—]|\d+[、.．：:]|[零〇一二三四五六七八九十百千万两]+[、.．：:])/u.test(line.trim());
  }

  function charLength(text) {
    return [...text.trim()].length;
  }

  function median(numbers) {
    if (!numbers.length) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // 固定宽度 TXT 的折行通常具有两个特征：多数行长度接近，且多数行末没有句末标点。
  // 普通小说 TXT 往往“一行一段”，行长差异明显，因此默认保留行边界。
  function detectHardWrap(lines) {
    const candidates = lines
      .map(line => line.trim())
      .filter(line => line && !isHeading(line) && !isDivider(line));

    if (candidates.length < 8) return false;

    const lengths = candidates.map(charLength);
    const center = median(lengths);
    if (center < 16 || center > 80) return false;

    const nearWidthRatio = lengths.filter(length => Math.abs(length - center) <= Math.max(3, center * 0.18)).length / lengths.length;
    const unfinishedRatio = candidates.filter(line => !endsSentence(line)).length / candidates.length;
    const shortLineRatio = lengths.filter(length => length < center * 0.55).length / lengths.length;

    return nearWidthRatio >= 0.62 && unfinishedRatio >= 0.55 && shortLineRatio <= 0.22;
  }

  function appendJoinedText(buffer, line) {
    if (!buffer) return line;
    const needsSpace = /[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(line);
    return buffer + (needsSpace ? ' ' : '') + line;
  }

  function joinWrappedLines(lines) {
    const blocks = [];
    let buffer = '';

    const flush = () => {
      const text = buffer.trim();
      if (text) blocks.push({ type: 'paragraph', text });
      buffer = '';
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) {
        flush();
        continue;
      }

      if (isHeading(line) || isLikelyImplicitHeading(lines, index)) {
        flush();
        blocks.push({ type: 'heading', text: line });
        continue;
      }

      if (isDivider(line)) {
        flush();
        blocks.push({ type: 'divider', text: line });
        continue;
      }

      buffer = appendJoinedText(buffer, line);

      const next = (lines[index + 1] || '').trim();
      const nextStartsNewBlock = !next || isHeading(next) || isDivider(next);
      const likelyNewParagraph = endsSentence(line)
        || (startsParagraphLike(next) && charLength(buffer) >= 12)
        || (next && charLength(next) < 8 && endsSentence(next));

      if (nextStartsNewBlock || likelyNewParagraph) flush();
    }

    flush();
    return blocks;
  }

  function parseText(rawText, preserveEveryLine = false) {
    const normalized = normalizeText(rawText);
    if (!normalized) return [];

    const lines = normalized.split('\n');
    const shouldJoinWrappedLines = !preserveEveryLine && detectHardWrap(lines);
    if (shouldJoinWrappedLines) return joinWrappedLines(lines);

    const blocks = [];

    // 默认把每个非空行作为一个自然段。空行只承担分隔作用，不需要生成空段。
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;

      if (isHeading(line) || isLikelyImplicitHeading(lines, index)) {
        blocks.push({ type: 'heading', text: line });
      } else if (isDivider(line)) {
        blocks.push({ type: 'divider', text: line });
      } else {
        blocks.push({ type: 'paragraph', text: line });
      }
    }

    return blocks;
  }

  function renderPreview() {
    const blocks = state.useRawBreaks
      ? parseText(state.rawText, true)
      : state.formattedBlocks;

    els.paper.replaceChildren();

    if (!blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '这里会显示排版后的文本。';
      els.paper.appendChild(empty);
    } else {
      const fragment = document.createDocumentFragment();
      blocks.forEach(block => {
        const element = document.createElement('p');
        element.className = block.type;
        element.textContent = block.text;
        fragment.appendChild(element);
      });
      els.paper.appendChild(fragment);
    }

    els.paper.className = [
      'paper',
      `template-${state.template}`,
      `theme-${state.theme}`,
      `font-${state.font}`,
      `size-${state.size}`,
      `spacing-${state.spacing}`
    ].join(' ');

    const count = [...state.rawText.replace(/\s/g, '')].length;
    els.documentName.textContent = state.fileName;
    els.documentMeta.textContent = `${count.toLocaleString('zh-CN')} 字 · v${APP_VERSION}`;
    els.restoreButton.textContent = state.useRawBreaks ? '自动整理' : '原始换行';
    syncControls();
  }

  function syncControls() {
    document.querySelectorAll('[data-template]').forEach(button => {
      button.classList.toggle('is-selected', button.dataset.template === state.template);
    });

    document.querySelectorAll('[data-setting]').forEach(group => {
      const key = group.dataset.setting;
      group.querySelectorAll('[data-value]').forEach(button => {
        button.classList.toggle('is-selected', button.dataset.value === state[key]);
      });
    });
  }

  function saveState() {
    try {
      const textToSave = state.rawText.length <= MAX_SAVED_TEXT ? state.rawText : '';
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...state,
        rawText: textToSave,
        formattedBlocks: textToSave ? state.formattedBlocks : []
      }));
    } catch (error) {
      console.warn('本地草稿保存不可用：', error);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 300);
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;

      Object.assign(state, {
        rawText: typeof saved.rawText === 'string' ? saved.rawText : '',
        formattedBlocks: Array.isArray(saved.formattedBlocks) ? saved.formattedBlocks : [],
        useRawBreaks: Boolean(saved.useRawBreaks),
        fileName: saved.fileName || '未命名文本',
        template: saved.template || 'comfort',
        font: saved.font || 'serif',
        size: saved.size || 'medium',
        spacing: saved.spacing || 'standard',
        theme: saved.theme || 'ivory'
      });

      els.sourceText.value = state.rawText;
      if (state.rawText && !state.formattedBlocks.length) {
        state.formattedBlocks = parseText(state.rawText);
      }
    } catch (error) {
      console.warn('无法读取本地草稿：', error);
    }
  }

  function openSheet(id) {
    closeSheets();
    const sheet = document.getElementById(id);
    if (!sheet) return;
    els.sheetBackdrop.hidden = false;
    requestAnimationFrame(() => {
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    });
  }

  function closeSheets() {
    document.querySelectorAll('.bottom-sheet.is-open').forEach(sheet => {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
    });
    els.sheetBackdrop.hidden = true;
  }

  async function decodeTextFile(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      try {
        return new TextDecoder('gb18030').decode(bytes);
      } catch (error) {
        return new TextDecoder().decode(bytes);
      }
    }
  }

  function getFormattedPlainText() {
    const blocks = state.useRawBreaks ? parseText(state.rawText, true) : state.formattedBlocks;
    return blocks.map(block => block.text).join('\n\n');
  }

  function getComputedDesign() {
    const style = getComputedStyle(els.paper);
    const width = Math.max(1, els.paper.clientWidth);
    return {
      background: style.backgroundColor,
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      width,
      paddingX: parseFloat(style.paddingLeft),
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom)
    };
  }

  function splitTextByWidth(ctx, text, maxWidth, firstLineIndent = 0) {
    const lines = [];
    let current = '';

    for (const char of [...text]) {
      const candidate = current + char;
      const availableWidth = lines.length === 0 ? maxWidth - firstLineIndent : maxWidth;
      if (current && ctx.measureText(candidate).width > availableWidth) {
        lines.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }

    if (current) lines.push(current);
    return lines;
  }

  async function buildLongImage() {
    await document.fonts?.ready;
    const blocks = state.useRawBreaks ? parseText(state.rawText, true) : state.formattedBlocks;
    if (!blocks.length) throw new Error('没有可导出的文本');

    const design = getComputedDesign();
    const scale = 2;
    const canvasWidth = design.width;
    const contentWidth = canvasWidth - design.paddingX * 2;
    const metrics = [];
    let totalHeight = design.paddingTop + design.paddingBottom;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    if (!measureCtx) throw new Error('当前浏览器不支持图片导出');

    for (const block of blocks) {
      const isHeadingBlock = block.type === 'heading';
      const fontSize = isHeadingBlock ? design.fontSize * 1.35 : design.fontSize;
      const fontWeight = isHeadingBlock ? 700 : 400;
      const lineHeight = isHeadingBlock ? design.lineHeight * 1.12 : design.lineHeight;
      const firstLineIndent = (state.template === 'book' || state.template === 'compact')
        && block.type === 'paragraph'
        ? design.fontSize * 2
        : 0;
      measureCtx.font = `${fontWeight} ${fontSize}px ${design.fontFamily}`;

      const lines = splitTextByWidth(measureCtx, block.text, contentWidth, firstLineIndent);
      const marginTop = block.type === 'divider'
        ? design.lineHeight * 1.2
        : isHeadingBlock
          ? design.lineHeight * 1.4
          : design.lineHeight * (state.template === 'article' ? .7 : .35);
      const marginBottom = isHeadingBlock ? design.lineHeight * .6 : 0;
      const height = lines.length * lineHeight + marginTop + marginBottom;

      metrics.push({ block, lines, fontSize, fontWeight, lineHeight, firstLineIndent, marginTop, marginBottom, height });
      totalHeight += height;
    }

    const maxCanvasHeight = 15000;
    if (totalHeight * scale > maxCanvasHeight) {
      throw new Error('文本过长，长图高度超过浏览器限制，请改用 PDF 导出');
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(canvasWidth * scale);
    canvas.height = Math.ceil(totalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持图片导出');

    ctx.scale(scale, scale);
    ctx.fillStyle = design.background;
    ctx.fillRect(0, 0, canvasWidth, totalHeight);
    ctx.textBaseline = 'top';

    let y = design.paddingTop;
    for (const item of metrics) {
      y += item.marginTop;
      ctx.fillStyle = design.color;
      ctx.font = `${item.fontWeight} ${item.fontSize}px ${design.fontFamily}`;
      ctx.textAlign = item.block.type === 'divider' || (state.template === 'book' && item.block.type === 'heading') ? 'center' : 'left';
      const x = ctx.textAlign === 'center' ? canvasWidth / 2 : design.paddingX;

      item.lines.forEach((line, index) => {
        const lineX = ctx.textAlign === 'left' && index === 0 ? x + item.firstLineIndent : x;
        ctx.fillText(line, lineX, y);
        y += item.lineHeight;
      });
      y += item.marginBottom;
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('图片生成失败'));
          return;
        }
        resolve(blob);
      }, 'image/png', 0.95);
    });
  }

  els.uploadButton.addEventListener('click', () => els.fileInput.click());

  els.fileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      els.fileStatus.textContent = `正在读取：${file.name}`;
      const text = await decodeTextFile(file);
      els.sourceText.value = text;
      state.rawText = text;
      state.formattedBlocks = [];
      state.useRawBreaks = false;
      state.fileName = file.name.replace(/\.txt$/i, '') || '未命名文本';
      els.fileStatus.textContent = `已读取 ${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
      saveState();
    } catch (error) {
      console.error(error);
      els.fileStatus.textContent = '文件读取失败，请确认它是纯文本文件。';
    } finally {
      event.target.value = '';
    }
  });

  els.sourceText.addEventListener('input', () => {
    state.rawText = els.sourceText.value;
    state.formattedBlocks = [];
    state.useRawBreaks = false;
    state.fileName = '未命名文本';
    els.fileStatus.textContent = '';
    scheduleSave();
  });

  els.clearButton.addEventListener('click', () => {
    els.sourceText.value = '';
    state.rawText = '';
    state.formattedBlocks = [];
    state.fileName = '未命名文本';
    els.fileStatus.textContent = '';
    saveState();
  });

  els.formatButton.addEventListener('click', () => {
    const text = els.sourceText.value;
    if (!text.trim()) {
      showToast('先粘贴或上传一段文本');
      els.sourceText.focus();
      return;
    }

    state.rawText = text;
    state.formattedBlocks = parseText(text);
    state.useRawBreaks = false;
    renderPreview();
    saveState();
    switchView('preview');
    document.getElementById('previewScroller').scrollTop = 0;
  });

  els.backButton.addEventListener('click', () => switchView('input'));

  els.restoreButton.addEventListener('click', () => {
    state.useRawBreaks = !state.useRawBreaks;
    renderPreview();
    saveState();
  });

  document.querySelectorAll('[data-sheet]').forEach(button => {
    button.addEventListener('click', () => openSheet(button.dataset.sheet));
  });

  els.sheetBackdrop.addEventListener('click', closeSheets);
  document.querySelectorAll('.sheet-close').forEach(button => button.addEventListener('click', closeSheets));

  document.querySelectorAll('[data-template]').forEach(button => {
    button.addEventListener('click', () => {
      state.template = button.dataset.template;
      renderPreview();
      saveState();
    });
  });

  document.querySelectorAll('[data-setting] [data-value]').forEach(button => {
    button.addEventListener('click', () => {
      const group = button.closest('[data-setting]');
      state[group.dataset.setting] = button.dataset.value;
      renderPreview();
      saveState();
    });
  });

  els.printButton.addEventListener('click', () => {
    closeSheets();
    setTimeout(() => window.print(), 100);
  });

  els.copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getFormattedPlainText());
      closeSheets();
      showToast('已复制整理后的文本');
    } catch (error) {
      console.error(error);
      showToast('复制失败，请检查浏览器权限');
    }
  });

  els.imageButton.addEventListener('click', async () => {
    const originalText = els.imageButton.querySelector('strong').textContent;
    try {
      els.imageButton.disabled = true;
      els.imageButton.querySelector('strong').textContent = '正在生成长图…';
      const blob = await buildLongImage();
      if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
      currentImageUrl = URL.createObjectURL(blob);
      els.imageOutput.replaceChildren();
      const image = new Image();
      image.alt = `${state.fileName} 长图`;
      image.src = currentImageUrl;
      els.imageOutput.appendChild(image);
      closeSheets();
      els.imageDialog.showModal();
    } catch (error) {
      console.error(error);
      showToast(error.message || '长图生成失败');
    } finally {
      els.imageButton.disabled = false;
      els.imageButton.querySelector('strong').textContent = originalText;
    }
  });

  function clearImagePreview() {
    if (currentImageUrl) {
      URL.revokeObjectURL(currentImageUrl);
      currentImageUrl = null;
    }
    els.imageOutput.replaceChildren();
  }

  function closeImagePreview() {
    if (els.imageDialog.open) els.imageDialog.close();
    else clearImagePreview();
  }

  els.closeImageDialog.addEventListener('click', closeImagePreview);
  els.imageDialog.addEventListener('close', clearImagePreview);
  els.imageDialog.addEventListener('click', event => {
    if (event.target === els.imageDialog) closeImagePreview();
  });

  window.addEventListener('beforeunload', saveState);

  loadState();
  renderPreview();
})();
