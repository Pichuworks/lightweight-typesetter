(() => {
  'use strict';

  const APP_VERSION = '4.6.0';
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
    theme: 'ivory',
    punctuation: 'original'
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
      .replace(/<\/?h[1-6](?:\s[^>]*)?>/giu, '\n')
      .replace(/<\/?(?:p|div|span|strong|em|body|html)(?:\s[^>]*)?>/giu, '')
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/\u3000/g, ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/^[ \t]+$/gm, '')
      .trim();
  }

  function splitEmbeddedHeadings(lines) {
    const embeddedHeading = /([【\[]\s*(?:判断题|单选题|多选题|填空题|问答题)\s*[】\]])/gu;
    const result = [];

    lines.forEach(line => {
      const parts = line.split(embeddedHeading);
      parts.forEach(part => {
        const text = part.trim();
        if (text) result.push(text);
      });
      if (!line.trim()) result.push('');
    });

    return result;
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
    const collapsed = undecorated.replace(/\s+/gu, '');

    // 中文章节：允许“第 12 章 标题”“第十二回：标题”“卷一 风雪夜”等常见写法。
    const chineseChapter = /^第\s*[零〇一二三四五六七八九十百千万两0-9０-９]+\s*[章节卷部篇回幕集辑册季期](?:(?:\s+[：:、.．·—–\-丨|｜]?\s*|\s*[：:、.．·—–\-丨|｜]\s*)\S.{0,47})?$/u;
    const volumeChapter = /^(?:卷|篇|部|册|幕)\s*[零〇一二三四五六七八九十百千万两0-9０-９]+(?:(?:\s+[：:、.．·—–\-丨|｜]?\s*|\s*[：:、.．·—–\-丨|｜]\s*)\S.{0,47})?$/u;
    const namedHeading = /^(?:正文|序章|序言|前言|引言|楔子|引子|开篇|后记|跋|尾声|终章|终篇|番外(?:篇|章)?|附录|目录|卷首语|卷尾语|上篇|中篇|下篇|常见问题解答|服务条款(?:与相关条件)?|单选题|多选题|判断题|填空题|问答题)(?:(?:\s+[：:、.．·—–\-丨|｜]?\s*|\s*[：:、.．·—–\-丨|｜]\s*)\S.{0,47})?$/u;
    const englishHeading = /^(?:chapter|chap\.?|part|book|volume|section)\s*(?:no\.?\s*)?[0-9ivxlcm０-９]+(?:(?:\s+[：:、.．·—–\-丨|｜]?\s*|\s*[：:、.．·—–\-丨|｜]\s*)\S.{0,47})?$/iu;
    const numericHeading = /^(?:[零〇一二三四五六七八九十百千万两]+|[0-9０-９]{1,4})\s*[、.．：:]\s*[^。！？!?；;]{1,40}$/u;
    const parenthesizedHeading = /^[（(](?:[零〇一二三四五六七八九十百千万两]+|[0-9０-９]{1,4})[）)]\s*\S.{0,40}$/u;
    const spacedLargeChapter = /^第[零〇一二三四五六七八九十百千万两0-9０-９]+大章(?:[：:、.．·—–\-丨|｜]?.{1,48})?$/u;

    if (chineseChapter.test(undecorated)
      || volumeChapter.test(undecorated)
      || namedHeading.test(undecorated)
      || englishHeading.test(undecorated)
      || numericHeading.test(undecorated)
      || parenthesizedHeading.test(original)
      || spacedLargeChapter.test(collapsed)) return true;

    // 独占一行的书名号、方括号标题。
    if (/^(?:【[^】]{1,48}】|\[[^\]]{1,48}\]|《[^》]{1,48}》)$/u.test(original)) return true;

    // 常见纯文本装饰标题。
    if (/^(?:★\s*\S.{0,58}\s*★|◆\s*\S.{0,58}|·\s*\S.{0,58}\s*·|>>\s*\S.{0,58}|<<\s*\S.{0,58}\s*>>|§\s*\S.{0,58}|---\s*\S.{0,58}\s*---)$/u.test(original)) return true;

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
    return /[。！？!?；;.]/u.test(text.trim());
  }

  function cleanHeadingText(text) {
    const trimmed = text.trim();
    const spacedHanCount = (trimmed.match(/[\p{Script=Han}]\s+(?=[\p{Script=Han}])/gu) || []).length;
    if (spacedHanCount >= 3) {
      return trimmed.replace(/\s+/gu, '').replace(/:/gu, '：');
    }
    return trimmed.replace(/[\t ]+/gu, ' ').replace(/\s*([：:])\s*/gu, '$1').trim();
  }

  function normalizeTypography(text) {
    let result = text.replace(/\t+/gu, ' ').replace(/ {2,}/gu, ' ');

    // 只转换包含中文的成对符号，避免破坏英文缩写、代码和文件名。
    result = result
      .replace(/"([^"\n]*\p{Script=Han}[^"\n]*)"/gu, '“$1”')
      .replace(/'([^'\n]*\p{Script=Han}[^'\n]*)'/gu, '‘$1’')
      .replace(/\(([^()\n]*\p{Script=Han}[^()\n]*)\)/gu, '（$1）')
      .replace(/\[([^\]\n]*\p{Script=Han}[^\]\n]*)\]/gu, '【$1】');

    // 半角标点仅在左侧明确为中文时转换；数字时间、网址和英文标点保持原样。
    result = result
      .replace(/([\p{Script=Han}”’）》】])\s*,\s*/gu, '$1，')
      .replace(/([\p{Script=Han}”’）》】])\s*;\s*/gu, '$1；')
      .replace(/([\p{Script=Han}”’）》】])\s*:\s*(?!\/\/)/gu, '$1：')
      .replace(/([\p{Script=Han}”’）》】])\s*\.\s*(?=[\p{Script=Han}“‘（【《]|$)/gu, '$1。')
      .replace(/([\p{Script=Han}”’）》】])\s*([!?]+)\s*/gu, (_, previous, marks) => {
        const converted = [...marks].map(mark => mark === '!' ? '！' : '？').join('');
        return previous + converted;
      })
      .replace(/\s+([（【《“‘])/gu, '$1');

    return result.trim();
  }

  function getHeadingLevel(line, index, analysis) {
    const original = line.trim();
    const originalCompact = original.replace(/\s+/gu, '');
    const compact = stripHeadingDecoration(original).replace(/\s+/gu, '');
    const number = '[零〇一二三四五六七八九十百千万两0-9０-９]+';

    if (new RegExp(`^第${number}(?:大章|卷)`, 'u').test(compact)
      || new RegExp(`^(?:卷|篇|部|册|幕)${number}`, 'u').test(compact)
      || /^(?:book|volume|part)[0-9ivxlcm０-９]+/iu.test(compact)) return '1';

    if (new RegExp(`^第${number}(?:章|回|篇|部|幕|集|辑|册|季|期)`, 'u').test(compact)
      || /^(?:chapter|chap\.?)[0-9ivxlcm０-９]+/iu.test(compact)
      || /^(?:正文|序章|序言|前言|引言|楔子|引子|开篇|后记|跋|尾声|终章|终篇|番外|附录|目录|常见问题解答|服务条款|单选题|多选题|判断题|填空题|问答题)/u.test(compact)) return '2';

    if (/^(?:section)[0-9ivxlcm０-９]+/iu.test(compact)
      || new RegExp(`^${number}[、.．：:]`, 'u').test(compact)
      || new RegExp(`^${number}点${number}`, 'u').test(compact)) return '3';

    if (new RegExp(`^[（(]${number}[）)]`, 'u').test(originalCompact)) return '4';

    if (/^(?:★|<<|§|---)/u.test(original)) return '2';
    if (/^(?:◆|·|>>)/u.test(original)) return '3';

    const firstGroup = analysis.groups[0] || [];
    const firstPosition = firstGroup.indexOf(index);
    if (firstPosition === 0) return 'title';
    if (firstPosition > 0) return 'subtitle';

    const nextLine = analysis.lines?.[index + 1]?.trim() || '';
    if (/^={3,}$/u.test(nextLine)) return '1';
    if (/^-{3,}$/u.test(nextLine)) return '2';

    if (/^(?:【.*】|\[.*\]|《.*》)$/u.test(original)) return '3';
    return '2';
  }

  function getLineGroups(lines) {
    const groups = [];
    let current = [];

    lines.forEach((line, index) => {
      if (line.trim()) {
        current.push(index);
      } else if (current.length) {
        groups.push(current);
        current = [];
      }
    });

    if (current.length) groups.push(current);
    return groups;
  }

  function isChatDocument(lines) {
    const nonEmpty = lines.map(line => line.trim()).filter(Boolean);
    const timestampLines = nonEmpty.filter(line => /^(?:\[?\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\]?\s*)?\d{1,2}:\d{2}(?::\d{2})?\s+\S+/u.test(line));
    return timestampLines.length >= 2;
  }

  function isPoetryGroup(lines, group) {
    if (group.length < 3) return false;
    const texts = group.map(index => lines[index].trim());
    const lengths = texts.map(charLength);
    return median(lengths) >= 3
      && texts.every(text => charLength(text) <= 20 && !hasSentencePunctuation(text));
  }

  function findNextNonEmptyIndex(lines, index) {
    for (let i = index + 1; i < lines.length; i += 1) {
      if (lines[i].trim()) return i;
    }
    return -1;
  }

  function hasLaterProse(lines, index, lookahead = 5) {
    let seen = 0;
    for (let i = index + 1; i < lines.length && seen < lookahead; i += 1) {
      const text = lines[i].trim();
      if (!text) continue;
      seen += 1;
      if (hasSentencePunctuation(text) || charLength(text) >= 16) return true;
    }
    return false;
  }

  function isLikelyImplicitHeading(lines, index, analysis = null) {
    const line = (lines[index] || '').trim();
    if (!line || isHeading(line) || isDivider(line)) return false;

    const length = charLength(line);
    if (length < 2 || length > 48) return false;
    if (hasSentencePunctuation(line)) return false;
    if (/[：:]$/u.test(line)) return false;
    if (/^[“「『（(【《]/u.test(line)) return false;
    if (/^[—-]/u.test(line)) return false;

    const groups = analysis?.groups || getLineGroups(lines);
    const chat = analysis?.chat ?? isChatDocument(lines);
    const poetryGroups = analysis?.poetryGroups || [];
    const hasPoetry = poetryGroups.length > 0;
    if (chat) return false;

    const previous = index > 0 ? lines[index - 1].trim() : '';
    const next = index + 1 < lines.length ? lines[index + 1].trim() : '';
    const nextNonEmptyIndex = findNextNonEmptyIndex(lines, index);
    const nextNonEmpty = nextNonEmptyIndex >= 0 ? lines[nextNonEmptyIndex].trim() : '';
    const blankBefore = index === 0 || !previous;
    const blankAfter = index === lines.length - 1 || !next;
    const isolated = blankBefore && blankAfter;

    if (isDivider(next) && /^(?:={3,}|-{3,})$/u.test(next.replace(/\s+/gu, ''))) return true;

    if (hasPoetry && isolated && nextNonEmptyIndex >= 0) {
      const nextGroup = groups.find(group => group[0] === nextNonEmptyIndex);
      if (nextGroup && (isPoetryGroup(lines, nextGroup) || nextGroup.length >= 2)) return true;
    }

    const firstGroup = groups[0] || [];
    if (firstGroup.includes(index) && firstGroup.length <= 2 && hasLaterProse(lines, index)) {
      return true;
    }

    if (blankBefore && next && hasSentencePunctuation(next) && charLength(next) >= Math.max(10, length * 0.8)) {
      return true;
    }

    if (!blankBefore && blankAfter && endsSentence(previous) && hasLaterProse(lines, index)) {
      return true;
    }

    if (isolated && nextNonEmpty) {
      const nextLength = charLength(nextNonEmpty);
      if (hasSentencePunctuation(nextNonEmpty)) return true;
      if (nextLength >= Math.max(12, length * 1.6)) return true;
    }

    return false;
  }

  function isDivider(line) {
    const compact = line.trim().replace(/\s+/gu, '');
    return /^(?:[*＊·•—─\-_=~～]{3,}|\.{3,}|[◇◆※☆★]+)$/u.test(compact);
  }

  function endsSentence(line) {
    return /[。！？!?…」』”’）》】〕〉：:；;.]$/u.test(line.trim());
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

  // 硬换行是局部属性：目录、正文和诗歌可能同时出现在一份文件里。
  function isHardWrappedGroup(lines, group) {
    const texts = group.map(index => lines[index].trim());
    if (texts.length < 2 || texts.some(text => isHeading(text) || isDivider(text))) return false;

    const lengths = texts.map(charLength);
    const singleCharacterRatio = lengths.filter(length => length <= 2).length / lengths.length;
    if (texts.length >= 4 && singleCharacterRatio >= 0.8 && endsSentence(texts.join(''))) {
      return true;
    }

    if (texts.length === 2) {
      return lengths[0] >= 10
        && !endsSentence(texts[0])
        && lengths[1] <= Math.max(4, lengths[0] * 0.48);
    }

    const mainTexts = texts.slice(0, -1);
    const mainLengths = lengths.slice(0, -1);
    const center = median(mainLengths);
    if (center < 8 || center > 100) return false;

    const tolerance = Math.max(3, center * 0.22);
    const nearWidthRatio = mainLengths.filter(length => Math.abs(length - center) <= tolerance).length / mainLengths.length;
    const unfinishedRatio = mainTexts.filter(text => !endsSentence(text)).length / mainTexts.length;
    const lastLooksLikeTail = lengths[lengths.length - 1] <= center * 0.7 || endsSentence(texts[texts.length - 1]);

    return nearWidthRatio >= 0.66 && unfinishedRatio >= 0.66 && lastLooksLikeTail;
  }

  function detectHardWrap(lines) {
    if (isChatDocument(lines)) return false;
    return getLineGroups(lines).some(group => !isPoetryGroup(lines, group) && isHardWrappedGroup(lines, group));
  }

  function appendJoinedText(buffer, line) {
    if (!buffer) return line;
    const needsSpace = /[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(line);
    return buffer + (needsSpace ? ' ' : '') + line;
  }

  function formatBlockText(text, optimizePunctuation) {
    return optimizePunctuation ? normalizeTypography(text) : text.trim();
  }

  function splitLetteredList(line, optimizePunctuation) {
    const marker = /(?:^|\s)([甲乙丙丁戊己庚辛壬癸])\s*([.．、])\s*/gu;
    const matches = [...line.matchAll(marker)];
    if (!matches.length || matches[0].index !== 0) return null;

    return matches.map((match, index) => {
      const start = match.index;
      const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
      return { type: 'list-item', text: formatBlockText(line.slice(start, end), optimizePunctuation) };
    });
  }

  function splitQuestionAndOptions(line, optimizePunctuation) {
    if (!/^[0-9０-９]+[.．、]/u.test(line)) return null;
    const optionMarker = /\s+([A-HＡ-Ｈ])([.．、])\s*/gu;
    const matches = [...line.matchAll(optionMarker)];
    if (matches.length < 2) return null;

    const result = [{
      type: 'question',
      text: formatBlockText(line.slice(0, matches[0].index), optimizePunctuation)
    }];

    matches.forEach((match, index) => {
      const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
      const contentStart = match.index + match[0].length;
      const optionText = `${match[1]}${match[2]} ${line.slice(contentStart, end).trim()}`;
      result.push({ type: 'option', text: formatBlockText(optionText, optimizePunctuation) });
    });
    return result;
  }

  function splitInlineHeadingAndBody(line, optimizePunctuation) {
    const match = line.match(/^((?:[零〇一二三四五六七八九十百千万两0-9０-９]\s*)+点(?:\s*[零〇一二三四五六七八九十百千万两0-9０-９])+(?:\s+)(?:简介|概述|说明|安装步骤|常见错误代码))\s+(.{8,})$/u);
    if (!match) return null;
    return [
      { type: 'heading', level: '3', text: formatBlockText(cleanHeadingText(match[1]), optimizePunctuation) },
      { type: 'paragraph', text: formatBlockText(match[2], optimizePunctuation) }
    ];
  }

  function parseStructuredLine(line, optimizePunctuation) {
    const inlineHeading = splitInlineHeadingAndBody(line, optimizePunctuation);
    if (inlineHeading) return inlineHeading;

    const answer = line.match(/^【答案】/u);
    if (answer) return [{ type: 'answer', text: formatBlockText(line, optimizePunctuation) }];

    const questionAndOptions = splitQuestionAndOptions(line, optimizePunctuation);
    if (questionAndOptions) return questionAndOptions;

    const letteredList = splitLetteredList(line, optimizePunctuation);
    if (letteredList) return letteredList;

    if (/^(?:第[零〇一二三四五六七八九十百千万两0-9０-９]+(?:步|条))[.．、：:]/u.test(line)) {
      return [{ type: 'list-item', text: formatBlockText(line, optimizePunctuation) }];
    }

    if (/^(?:问题[零〇一二三四五六七八九十百千万两0-9０-９]+)[：:]/u.test(line)) {
      return [{ type: 'question', text: formatBlockText(line, optimizePunctuation) }];
    }

    if (/^(?:警告|注意)[：:]/u.test(line)) {
      return [{ type: 'callout', text: formatBlockText(line, optimizePunctuation) }];
    }

    return [{ type: 'paragraph', text: formatBlockText(line, optimizePunctuation) }];
  }

  function blankLinesBefore(lines, index) {
    let count = 0;
    for (let i = index - 1; i >= 0 && !lines[i].trim(); i -= 1) count += 1;
    return Math.min(2, count);
  }

  function parseText(rawText, preserveEveryLine = false, optimizePunctuation = false) {
    const normalized = normalizeText(rawText);
    if (!normalized) return [];

    const lines = splitEmbeddedHeadings(normalized.split('\n'));
    const blocks = [];
    const groups = getLineGroups(lines);
    const poetryGroups = groups.filter(group => isPoetryGroup(lines, group));
    const chat = isChatDocument(lines);
    const analysis = { lines, groups, poetryGroups, chat };

    for (const group of groups) {
      const gapBefore = blankLinesBefore(lines, group[0]);
      let emittedInGroup = false;
      const pushBlocks = newBlocks => {
        if (!newBlocks.length) return;
        if (!emittedInGroup && gapBefore) newBlocks[0].gapBefore = gapBefore;
        blocks.push(...newBlocks);
        emittedInGroup = true;
      };
      const poetryGroup = poetryGroups.includes(group);
      if (!preserveEveryLine && !poetryGroup && !chat && isHardWrappedGroup(lines, group)) {
        const text = group.reduce((buffer, index) => appendJoinedText(buffer, lines[index].trim()), '');
        pushBlocks([{ type: 'paragraph', text: formatBlockText(text, optimizePunctuation) }]);
        continue;
      }

      for (const index of group) {
        const line = lines[index].trim();
        if (isDivider(line)) {
          pushBlocks([{ type: 'divider', text: line }]);
        } else if (isHeading(line) || isLikelyImplicitHeading(lines, index, analysis)) {
          const headingText = cleanHeadingText(line);
          pushBlocks([{ type: 'heading', level: getHeadingLevel(line, index, analysis), text: formatBlockText(headingText, optimizePunctuation) }]);
        } else {
          pushBlocks(parseStructuredLine(line, optimizePunctuation));
        }
      }
    }

    return blocks;
  }

  function appendRichText(element, text) {
    const emphasisPattern = /(【(?:重要|注意|务必)】|\[(?:重要|注意|务必)\]|!!重要!!|★重要★)/gu;
    const emphasisToken = /^(?:【(?:重要|注意|务必)】|\[(?:重要|注意|务必)\]|!!重要!!|★重要★)$/u;
    const parts = text.split(emphasisPattern);
    parts.forEach(part => {
      if (!part) return;
      if (emphasisToken.test(part)) {
        const strong = document.createElement('strong');
        strong.className = 'inline-emphasis';
        strong.textContent = part;
        element.appendChild(strong);
      } else {
        element.appendChild(document.createTextNode(part));
      }
    });
  }

  function renderPreview() {
    const blocks = state.useRawBreaks
      ? parseText(state.rawText, true, state.punctuation === 'smart')
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
        const classes = [block.type];
        if (block.type === 'heading' && block.level) classes.push(`heading-${block.level}`);
        if (block.gapBefore) classes.push(`gap-before-${block.gapBefore}`);
        element.className = classes.join(' ');
        appendRichText(element, block.text);
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
        theme: saved.theme || 'ivory',
        punctuation: saved.punctuation === 'smart' ? 'smart' : 'original'
      });

      els.sourceText.value = state.rawText;
      if (state.rawText) state.formattedBlocks = parseText(state.rawText, false, state.punctuation === 'smart');
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
    const blocks = state.useRawBreaks ? parseText(state.rawText, true, state.punctuation === 'smart') : state.formattedBlocks;
    return blocks.reduce((output, block, index) => {
      if (index === 0) return block.text;
      const previous = blocks[index - 1];
      const compactPair = ['option', 'list-item'].includes(block.type)
        || ['option', 'list-item'].includes(previous.type);
      return `${output}${compactPair ? '\n' : '\n\n'}${block.text}`;
    }, '');
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
    const blocks = state.useRawBreaks ? parseText(state.rawText, true, state.punctuation === 'smart') : state.formattedBlocks;
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
      const isEmphasizedBlock = ['question', 'callout'].includes(block.type);
      const headingScale = {
        title: 1.9,
        subtitle: 1.08,
        1: 1.55,
        2: 1.34,
        3: 1.16,
        4: 1.05
      };
      const fontSize = isHeadingBlock ? design.fontSize * (headingScale[block.level] || 1.34) : design.fontSize;
      const fontWeight = block.level === 'subtitle' ? 500 : isHeadingBlock ? 700 : isEmphasizedBlock ? 650 : 400;
      const lineHeight = isHeadingBlock ? design.lineHeight * 1.12 : design.lineHeight;
      const leftIndent = ['option', 'list-item', 'answer'].includes(block.type) ? design.fontSize * 1.4 : 0;
      const firstLineIndent = (state.template === 'book' || state.template === 'compact')
        && block.type === 'paragraph'
        ? design.fontSize * 2
        : 0;
      measureCtx.font = `${fontWeight} ${fontSize}px ${design.fontFamily}`;

      const lines = splitTextByWidth(measureCtx, block.text, contentWidth - leftIndent, firstLineIndent);
      const marginTop = block.type === 'divider'
        ? design.lineHeight * 1.2
        : isHeadingBlock
          ? design.lineHeight * (block.level === 'title' ? .2 : block.level === '1' ? 1.8 : 1.4)
          : design.lineHeight * (['question', 'callout'].includes(block.type) ? .8 : state.template === 'article' ? .7 : .35);
      const marginBottom = isHeadingBlock
        ? design.lineHeight * (block.level === 'title' ? 1.4 : block.level === 'subtitle' ? 1.5 : .6)
        : 0;
      const centered = block.type === 'divider'
        || (isHeadingBlock && (state.template === 'book' || ['title', 'subtitle', '1'].includes(block.level)));
      const height = lines.length * lineHeight + marginTop + marginBottom;

      metrics.push({ block, lines, fontSize, fontWeight, lineHeight, firstLineIndent, leftIndent, marginTop, marginBottom, centered, height });
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
      ctx.textAlign = item.centered ? 'center' : 'left';
      const x = ctx.textAlign === 'center' ? canvasWidth / 2 : design.paddingX + item.leftIndent;

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
    state.formattedBlocks = parseText(text, false, state.punctuation === 'smart');
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
      if (group.dataset.setting === 'punctuation' && state.rawText) {
        state.formattedBlocks = parseText(state.rawText, false, state.punctuation === 'smart');
      }
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
