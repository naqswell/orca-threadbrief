import { Lexer } from './vendor/marked.mjs'

const tags = { paragraph: 'p', blockquote: 'blockquote', strong: 'strong', em: 'em', del: 'del', list_item: 'li' }

function child(parent, tag) {
  const element = document.createElement(tag)
  parent.append(element)
  return element
}

function webUrl(href) {
  if (!/^https?:\/\//i.test(href) || /[\s\\\p{Cc}]/u.test(href)) return null
  try {
    const url = new URL(href)
    return url.username || url.password ? null : url.href
  } catch { return null }
}

function appendTokens(parent, tokens, openLink) {
  for (const t of tokens) {
    switch (t.type) {
      case 'space': case 'def': break
      case 'br': case 'hr': child(parent, t.type); break
      case 'heading': appendTokens(child(parent, `h${Math.min(6, t.depth + 2)}`), t.tokens, openLink); break
      case 'list': {
        const list = child(parent, t.ordered ? 'ol' : 'ul')
        if (t.ordered && t.start !== 1) list.start = t.start
        appendTokens(list, t.items, openLink)
        break
      }
      case 'checkbox': {
        const check = child(parent, 'input')
        check.type = 'checkbox'; check.checked = t.checked; check.disabled = true
        parent.append(' ')
        break
      }
      case 'table': {
        const scroll = child(parent, 'div')
        scroll.className = 'table-scroll'
        const table = child(scroll, 'table')
        const addRow = (group, cells) => {
          const row = child(group, 'tr')
          for (const cell of cells) {
            const element = child(row, cell.header ? 'th' : 'td')
            if (cell.header) element.scope = 'col'
            if (cell.align) element.style.textAlign = cell.align
            appendTokens(element, cell.tokens, openLink)
          }
        }
        addRow(child(table, 'thead'), t.header)
        const body = child(table, 'tbody')
        for (const row of t.rows) addRow(body, row)
        break
      }
      case 'code': child(child(parent, 'pre'), 'code').textContent = t.text; break
      case 'codespan': child(parent, 'code').textContent = t.text; break
      case 'link': {
        const href = webUrl(t.href)
        const label = child(parent, href ? 'button' : 'span')
        label.title = href || t.href
        if (href) {
          label.type = 'button'
          label.className = 'prose-link'
          label.addEventListener('click', () => openLink(label, href))
        }
        appendTokens(label, t.tokens, openLink)
        break
      }
      case 'image': parent.append(t.text || 'Image'); break
      default:
        if (Object.hasOwn(tags, t.type)) appendTokens(child(parent, tags[t.type]), t.tokens, openLink)
        else if (t.type === 'text' && t.tokens) appendTokens(parent, t.tokens, openLink)
        else parent.append(t.text ?? t.raw)
    }
  }
}

export function renderMarkdown(parent, text, openLink, inline = false) {
  parent.classList.add('prose')
  const options = { gfm: true, breaks: true }
  appendTokens(parent, inline ? Lexer.lexInline(text, options) : Lexer.lex(text, options), openLink)
}
